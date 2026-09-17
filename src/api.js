/**
 * 파워넷 ESG 데이터 입력플랫폼 — API (Cloudflare Worker)
 *
 * W0 범위: 배포 파이프라인 · 인증 · D1 · R2 가 모두 살아있는지 확인한다 (G0 게이트).
 *
 * ── 개인정보 취급 규칙 (R84 / R85) ──────────────────────────────────────────
 * Cloudflare Access 가 붙여주는 이메일은 이 파일의 resolveRoles() 안에서만 쓰이고
 * 즉시 버려진다. 응답 본문, 로그, D1, R2 어디에도 이메일이 남지 않는다.
 * 밖으로 나가는 것은 역할코드(HQ_HR, SY_OWNER ...)뿐이다.
 * 이메일 ↔ 역할 매핑은 ROLE_MAP 시크릿에만 존재하며 DB에 없다.
 *
 * ── 보안 전제 ───────────────────────────────────────────────────────────────
 * Cf-Access-Authenticated-User-Email 헤더는 Cloudflare Access 가 붙인다.
 * Access 를 통과하지 않는 경로가 열려 있으면 이 헤더를 위조할 수 있다.
 * 따라서 반드시:
 *   1) 커스텀 도메인에 Access Application 을 걸 것
 *   2) *.workers.dev 라우트를 비활성화할 것  (SETUP.md 4단계)
 * REQUIRE_ACCESS 를 "false" 로 두면 인증 없이 열리므로, 최초 배포 확인 직후
 * 반드시 "true" 로 되돌린다.
 */

const ACCESS_EMAIL_HEADER = 'Cf-Access-Authenticated-User-Email';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: JSON_HEADERS });
}

/**
 * Access 헤더에서 역할코드를 해석한다.
 * 이메일은 이 함수 안에서만 존재하고 반환값에 담지 않는다. (R84 / R85)
 */
function resolveRoles(request, env) {
  const raw = request.headers.get(ACCESS_EMAIL_HEADER);
  if (!raw) {
    return { authenticated: false, roles: [], mapping: 'no-identity' };
  }
  let map;
  try {
    map = JSON.parse(env.ROLE_MAP || '{}');
  } catch {
    return { authenticated: true, roles: [], mapping: 'role-map-invalid-json' };
  }
  const roles = map[raw.trim().toLowerCase()];
  if (!Array.isArray(roles) || roles.length === 0) {
    return { authenticated: true, roles: [], mapping: 'identity-not-mapped' };
  }
  return { authenticated: true, roles, mapping: 'ok' };
}

/** D1 연결과 기준정보 적재 상태 */
async function checkDatabase(env) {
  try {
    const counts = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM entity)            AS entities,
              (SELECT COUNT(*) FROM site)              AS sites,
              (SELECT COUNT(*) FROM role)              AS roles,
              (SELECT COUNT(*) FROM metric)            AS metrics,
              (SELECT COUNT(*) FROM metric_assignment) AS assignments,
              (SELECT COUNT(*) FROM factor)            AS factors,
              (SELECT COUNT(*) FROM entry)             AS entries`
    ).first();

    const perEntity = await env.DB.prepare(
      `SELECT entity_code, COUNT(*) AS n
         FROM v_expected_entry
        WHERE period_type = 'monthly'
        GROUP BY entity_code
        ORDER BY entity_code`
    ).all();

    const missingBackup = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM metric_assignment WHERE backup_role IS NULL`
    ).first();

    return {
      status: counts.metrics > 0 && counts.assignments > 0 ? 'ok' : 'warn',
      counts,
      monthly_per_entity: perEntity.results,
      missing_backup: missingBackup.n,
      hint: counts.metrics === 0
        ? 'schema.sql 은 적용됐지만 seed.sql 이 적용되지 않았습니다. SETUP.md 3단계를 실행하세요.'
        : null,
    };
  } catch (err) {
    return {
      status: 'fail',
      error: String(err && err.message ? err.message : err),
      hint: 'D1 데이터베이스가 없거나 스키마가 적용되지 않았습니다. SETUP.md 2~3단계를 실행하세요.',
    };
  }
}

/** R2 버킷 연결 상태 (증빙 파일 저장소) */
async function checkStorage(env) {
  try {
    const listed = await env.EVIDENCE.list({ limit: 1 });
    return { status: 'ok', objects_sampled: listed.objects.length };
  } catch (err) {
    return {
      status: 'fail',
      error: String(err && err.message ? err.message : err),
      hint: 'R2 버킷이 없습니다. SETUP.md 2단계의 버킷 생성 명령을 실행하세요.',
    };
  }
}

/** 배출계수 등록 상태 — W3(산정 로직) 전까지는 비어 있는 것이 정상이다 */
async function checkFactors(env) {
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n, COALESCE(MAX(version), '') AS latest FROM factor`
    ).first();
    if (row.n === 0) {
      return {
        status: 'warn',
        registered: 0,
        hint: '배출계수가 아직 등록되지 않았습니다. 정상입니다 — 실제 고시값 확인(EP8 B4) 후 등록하며, '
            + '입력·검증 화면은 계수 없이 동작합니다. 산정 로직(W3, 10/6~10) 전까지 확보하면 됩니다.',
      };
    }
    return { status: 'ok', registered: row.n, latest_version: row.latest };
  } catch (err) {
    return { status: 'fail', error: String(err && err.message ? err.message : err) };
  }
}

/** 인증 상태 — 이메일은 응답에 담지 않는다 */
function checkAccess(request, env) {
  const identity = resolveRoles(request, env);
  const required = String(env.REQUIRE_ACCESS ?? 'true') !== 'false';

  if (!identity.authenticated) {
    return {
      status: required ? 'fail' : 'warn',
      authenticated: false,
      require_access: required,
      hint: required
        ? 'Cloudflare Access 를 통과하지 않은 요청입니다. SETUP.md 4단계에서 Access Application 을 설정하세요.'
        : 'REQUIRE_ACCESS 가 false 입니다. 최초 배포 확인용이며, Access 설정 후 반드시 true 로 되돌리세요.',
    };
  }
  if (identity.mapping === 'role-map-invalid-json') {
    return {
      status: 'fail', authenticated: true, roles: [],
      hint: 'ROLE_MAP 시크릿이 올바른 JSON 이 아닙니다. SETUP.md 5단계를 다시 실행하세요.',
    };
  }
  if (identity.mapping === 'identity-not-mapped') {
    return {
      status: 'warn', authenticated: true, roles: [],
      hint: '로그인은 됐지만 이 계정에 역할이 매핑되지 않았습니다. ROLE_MAP 에 역할코드를 추가하세요 (SETUP.md 5단계).',
    };
  }
  return { status: 'ok', authenticated: true, roles: identity.roles, require_access: required };
}

/** GET /api/health — 인증 없이도 응답한다. 민감 정보를 담지 않는다 */
async function handleHealth(request, env) {
  const [database, storage, factors] = await Promise.all([
    checkDatabase(env), checkStorage(env), checkFactors(env),
  ]);
  const access = checkAccess(request, env);

  const checks = { access, database, storage, factors };
  const worst = ['fail', 'warn', 'ok'].find((s) =>
    Object.values(checks).some((c) => c.status === s)
  );

  return json({
    app: env.APP_NAME || 'POWERNET ESG',
    stage: 'W0 — 배포 파이프라인 확인 (G0)',
    overall: worst,
    checked_at: new Date().toISOString(),
    checks,
  });
}

/** GET /api/me — 내 역할과 담당 항목. 인증 필요. 이메일을 반환하지 않는다 */
async function handleMe(request, env) {
  const identity = resolveRoles(request, env);
  const required = String(env.REQUIRE_ACCESS ?? 'true') !== 'false';

  if (!identity.authenticated && required) {
    return json({ error: 'unauthenticated', hint: 'Cloudflare Access 로그인이 필요합니다.' }, 401);
  }
  if (identity.roles.length === 0) {
    return json({ roles: [], assignments: [], hint: '이 계정에 역할이 매핑되지 않았습니다.' }, 200);
  }

  const placeholders = identity.roles.map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `SELECT r.code        AS role_code,
            r.label_ko    AS role_label,
            r.entity_code AS entity_code,
            r.scope       AS scope,
            r.locale      AS locale,
            (SELECT COUNT(*) FROM metric_assignment a
              WHERE a.owner_role = r.code AND a.is_applicable = 1)  AS owned_metrics,
            (SELECT COUNT(*) FROM metric_assignment a
              WHERE a.backup_role = r.code AND a.is_applicable = 1) AS backup_metrics
       FROM role r
      WHERE r.code IN (${placeholders}) AND r.is_active = 1
      ORDER BY r.code`
  ).bind(...identity.roles).all();

  return json({ roles: identity.roles, assignments: rows.results });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      try {
        if (url.pathname === '/api/health') return await handleHealth(request, env);
        if (url.pathname === '/api/me')     return await handleMe(request, env);
        return json({ error: 'not_found', path: url.pathname }, 404);
      } catch (err) {
        // 오류 메시지를 그대로 내려준다. 비개발자가 AI 에게 붙여넣을 수 있어야 한다 (EP8 원칙 6)
        return json({ error: 'internal_error', message: String(err && err.message ? err.message : err) }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  },
};
