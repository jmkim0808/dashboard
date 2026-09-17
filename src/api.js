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

import {
  loadSheet, saveEntry, submitSheet, uploadEvidence, fetchEvidence,
  inputScope, isValidPeriod,
} from './entry.js';
import {
  reviewScope, loadBoard, loadQueue, approveEntries, returnEntry,
  closePeriod, reopenPeriod,
} from './review.js';
import { computeMonth, computeYear, saveMonthResult, latestFactorVersion } from './calc.js';

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

/**
 * 기준정보(마스터) 접근 권한.
 * 조회·수정 모두 본사 권한자(admin / approver / manager)로 제한한다.
 * 입력 담당자(entry)와 경영진(executive)은 이 화면에 접근하지 않는다.
 */
const MASTER_SCOPES = new Set(['admin', 'approver', 'manager']);

/**
 * 화면에서 수정할 수 있는 지표 필드 (화이트리스트).
 *
 * evidence_policy 를 의도적으로 제외한다. 이 값을 화면에서 'required' 로 바꿀 수 있으면
 * 인사·안전 지표에 급여대장을 첨부할 경로가 열린다. 개인정보 보호 설계(R86)는
 * 화면에서 뚫을 수 없어야 한다.
 *
 * 산정 로직의 근간(category / is_calculated / calc_kind / numerator_codes /
 * denominator_codes / multiplier / factor_type / ghg_scope)도 제외한다.
 * 이것들은 운영 변경이 아니라 설계 변경이므로 schema/seed 로만 바꾼다.
 * R73(마스터 변경은 전부 화면에서)이 대상으로 삼는 것은 반복적인 운영 변경
 * — 배출계수 개정, 환율 갱신, 항목명·단위·담당자 변경 — 이다.
 */
const METRIC_EDITABLE = new Set([
  'name_ko', 'name_zh', 'name_vi', 'unit_standard', 'period_type', 'aggregation',
  'definition_ko', 'help_ko', 'help_zh', 'help_vi',
  'disclosure_level', 'gri_code', 'kssb_code', 'sort_order', 'active_to',
]);

const ENUM_VALUES = {
  period_type: ['monthly', 'quarterly', 'annual'],
  aggregation: ['sum', 'avg', 'eop'],
  disclosure_level: ['internal', 'customer', 'public'],
};

/**
 * 마스터 API 공통 권한 확인.
 * 통과하면 { roles }, 막히면 { error: Response } 를 돌려준다.
 */
async function authorizeMaster(request, env) {
  const identity = resolveRoles(request, env);
  const required = String(env.REQUIRE_ACCESS ?? 'true') !== 'false';

  if (!identity.authenticated) {
    // REQUIRE_ACCESS=false 는 최초 배포 확인용이다. 이때만 로컬 확인을 허용하고,
    // 헬스체크 화면이 이 상태를 "주의"로 표시한다. 운영에서는 항상 true 여야 한다.
    if (required) {
      return { error: json({ error: 'unauthenticated', hint: 'Cloudflare Access 로그인이 필요합니다.' }, 401) };
    }
    return { roles: [], scopes: new Set(['admin']), unauthenticated_local: true };
  }
  if (identity.roles.length === 0) {
    return { error: json({ error: 'no_role', hint: '이 계정에 역할이 매핑되지 않았습니다. ROLE_MAP 을 확인하세요.' }, 403) };
  }

  const ph = identity.roles.map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `SELECT code, scope, entity_code FROM role WHERE code IN (${ph}) AND is_active = 1`
  ).bind(...identity.roles).all();

  const scopes = new Set(rows.results.map((r) => r.scope));
  const allowed = [...scopes].some((s) => MASTER_SCOPES.has(s));
  if (!allowed) {
    return { error: json({
      error: 'forbidden',
      hint: '기준정보 관리 권한이 없습니다. 이 화면은 본사 총괄·승인자만 사용합니다.',
    }, 403) };
  }
  return { roles: rows.results, scopes, actor: rows.results[0].code };
}

/** Access 헤더 → 역할 행. 인증되지 않았거나 매핑이 없으면 빈 배열 */
async function loadRoleRows(request, env) {
  const identity = resolveRoles(request, env);
  if (identity.roles.length === 0) return { identity, rows: [] };
  const ph = identity.roles.map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `SELECT code, scope, entity_code, label_ko, locale FROM role
      WHERE code IN (${ph}) AND is_active = 1 ORDER BY code`
  ).bind(...identity.roles).all();
  return { identity, rows: rows.results };
}

/**
 * 입력 API 공통 권한 확인.
 * REQUIRE_ACCESS=false 일 때만 로컬 확인용으로 본사 총괄 역할을 가정한다.
 */
async function authorizeInput(request, env) {
  const { identity, rows } = await loadRoleRows(request, env);
  const required = String(env.REQUIRE_ACCESS ?? 'true') !== 'false';

  if (!identity.authenticated) {
    if (required) {
      return { error: json({ error: 'unauthenticated', hint: 'Cloudflare Access 로그인이 필요합니다.' }, 401) };
    }
    const fallback = await env.DB.prepare(
      `SELECT code, scope, entity_code, label_ko, locale FROM role WHERE code = 'HQ_ESG'`
    ).first();
    const local = fallback ? [fallback] : [];
    return { rows: local, scope: inputScope(local), actor: fallback ? fallback.code : null };
  }
  if (rows.length === 0) {
    return { error: json({ error: 'no_role',
      hint: '이 계정에 역할이 매핑되지 않았습니다. 총괄에게 문의하세요.' }, 403) };
  }
  return { rows, scope: inputScope(rows), actor: rows[0].code };
}

/** 마스터 변경을 이력으로 남긴다 (D-4 정신 — entry 외의 변경도 추적한다) */
async function logMasterChange(env, table, rowKey, field, oldValue, newValue, actor) {
  await env.DB.prepare(
    `INSERT INTO audit_log (table_name, row_key, field, old_value, new_value, changed_by_role, changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(table, rowKey, field,
         oldValue === null || oldValue === undefined ? null : String(oldValue),
         newValue === null || newValue === undefined ? null : String(newValue),
         actor, new Date().toISOString()).run();
}

/** GET /api/master — 기준정보 전체. 데이터량이 작아 한 번에 보낸다 */
async function handleMasterBootstrap(env) {
  const [entities, roles, metrics, units, assignments, factors, fx, reasons, availability] =
    await env.DB.batch([
      env.DB.prepare(`SELECT code, name_ko, name_zh, name_vi, country, currency,
                             fiscal_year_start, locale_default, calc_standard, grid_region
                        FROM entity WHERE is_active = 1 ORDER BY code`),
      env.DB.prepare(`SELECT code, entity_code, label_ko, scope, locale
                        FROM role WHERE is_active = 1 ORDER BY entity_code, code`),
      env.DB.prepare(`SELECT code, category, name_ko, name_zh, name_vi, unit_standard,
                             period_type, aggregation, definition_ko, help_ko, help_zh, help_vi,
                             disclosure_level, evidence_policy, gri_code, kssb_code,
                             is_calculated, calc_kind, numerator_codes, denominator_codes,
                             multiplier, factor_type, ghg_scope, sort_order, active_from, active_to
                        FROM metric ORDER BY sort_order`),
      env.DB.prepare(`SELECT metric_code, entity_code, unit_input, factor_to_standard
                        FROM metric_unit_override ORDER BY metric_code, entity_code`),
      env.DB.prepare(`SELECT metric_code, entity_code, owner_role, backup_role, is_applicable
                        FROM metric_assignment ORDER BY entity_code, metric_code`),
      env.DB.prepare(`SELECT id, factor_type, purpose, region, year, value, unit, gwp_set,
                             source, published_at, version
                        FROM factor ORDER BY version DESC, region, factor_type`),
      env.DB.prepare(`SELECT currency, year, rate_avg, source, version
                        FROM fx_rate ORDER BY version DESC, currency`),
      env.DB.prepare(`SELECT code, label_ko, label_zh, label_vi FROM unavailable_reason ORDER BY sort_order`),
      env.DB.prepare(`SELECT reason_code, COUNT(*) AS n FROM data_availability GROUP BY reason_code`),
    ]);

  return json({
    entities: entities.results,
    roles: roles.results,
    metrics: metrics.results,
    units: units.results,
    assignments: assignments.results,
    factors: factors.results,
    fx_rates: fx.results,
    unavailable_reasons: reasons.results,
    availability_summary: availability.results,
    editable_metric_fields: [...METRIC_EDITABLE],
    enum_values: ENUM_VALUES,
  });
}

/** PATCH /api/master/metric/:code — 화이트리스트 필드만 수정하고 이력을 남긴다 */
async function handleMetricPatch(code, body, env, actor) {
  const current = await env.DB.prepare(`SELECT * FROM metric WHERE code = ?`).bind(code).first();
  if (!current) return json({ error: 'not_found', code }, 404);

  const changes = [];
  for (const [field, raw] of Object.entries(body || {})) {
    if (!METRIC_EDITABLE.has(field)) {
      return json({ error: 'field_not_editable', field,
        hint: field === 'evidence_policy'
          ? '증빙 정책은 화면에서 변경할 수 없습니다. 인사·안전 지표에 개인정보가 첨부될 경로를 여는 변경이기 때문입니다 (R86).'
          : '이 항목은 산정 로직의 근간이므로 화면에서 변경하지 않습니다.' }, 400);
    }
    if (ENUM_VALUES[field] && raw !== null && !ENUM_VALUES[field].includes(raw)) {
      return json({ error: 'invalid_value', field, allowed: ENUM_VALUES[field] }, 400);
    }
    const value = raw === '' ? null : raw;
    if (String(current[field] ?? '') !== String(value ?? '')) {
      changes.push([field, current[field], value]);
    }
  }
  if (changes.length === 0) return json({ updated: 0, changes: [] });

  const setSql = changes.map(([f]) => `${f} = ?`).join(', ');
  await env.DB.prepare(`UPDATE metric SET ${setSql} WHERE code = ?`)
    .bind(...changes.map(([, , v]) => v), code).run();
  for (const [f, oldV, newV] of changes) {
    await logMasterChange(env, 'metric', code, f, oldV, newV, actor);
  }
  return json({ updated: changes.length, changes: changes.map(([f, o, n]) => ({ field: f, from: o, to: n })) });
}

/** PATCH /api/master/assignment — 담당·부담당·적용여부. 부담당자는 비울 수 없다 (R67) */
async function handleAssignmentPatch(body, env, actor) {
  const { metric_code, entity_code, owner_role, backup_role, is_applicable } = body || {};
  if (!metric_code || !entity_code) return json({ error: 'missing_key' }, 400);

  const current = await env.DB.prepare(
    `SELECT * FROM metric_assignment WHERE metric_code = ? AND entity_code = ?`
  ).bind(metric_code, entity_code).first();
  if (!current) return json({ error: 'not_found' }, 404);

  const next = {
    owner_role: owner_role ?? current.owner_role,
    backup_role: backup_role ?? current.backup_role,
    is_applicable: is_applicable === undefined ? current.is_applicable : (is_applicable ? 1 : 0),
  };
  if (!next.backup_role) {
    return json({ error: 'backup_required',
      hint: '부담당자는 비울 수 없습니다. 담당자 1인이 부재하면 그 법인 데이터가 멈추기 때문입니다 (P-7).' }, 400);
  }
  if (next.owner_role === next.backup_role) {
    return json({ error: 'same_role', hint: '주담당과 부담당은 서로 달라야 합니다.' }, 400);
  }

  try {
    await env.DB.prepare(
      `UPDATE metric_assignment SET owner_role = ?, backup_role = ?, is_applicable = ?
        WHERE metric_code = ? AND entity_code = ?`
    ).bind(next.owner_role, next.backup_role, next.is_applicable, metric_code, entity_code).run();
  } catch (err) {
    return json({ error: 'db_rejected', message: String(err.message || err) }, 400);
  }

  const key = `${metric_code}/${entity_code}`;
  for (const f of ['owner_role', 'backup_role', 'is_applicable']) {
    if (String(current[f]) !== String(next[f])) {
      await logMasterChange(env, 'metric_assignment', key, f, current[f], next[f], actor);
    }
  }
  return json({ ok: true, assignment: { metric_code, entity_code, ...next } });
}

/** PUT / DELETE /api/master/unit — 법인별 입력 단위 오버라이드 (R26 / P-5) */
async function handleUnitPut(body, env, actor) {
  const { metric_code, entity_code, unit_input, factor_to_standard } = body || {};
  if (!metric_code || !entity_code) return json({ error: 'missing_key' }, 400);

  if (unit_input === null || unit_input === '') {
    await env.DB.prepare(`DELETE FROM metric_unit_override WHERE metric_code = ? AND entity_code = ?`)
      .bind(metric_code, entity_code).run();
    await logMasterChange(env, 'metric_unit_override', `${metric_code}/${entity_code}`,
                          'unit_input', null, '(삭제)', actor);
    return json({ ok: true, removed: true });
  }
  const f = Number(factor_to_standard);
  if (!Number.isFinite(f) || f <= 0) {
    return json({ error: 'invalid_factor', hint: '환산계수는 0보다 큰 숫자여야 합니다. 예: 万kWh -> kWh 는 10000' }, 400);
  }
  await env.DB.prepare(
    `INSERT INTO metric_unit_override (metric_code, entity_code, unit_input, factor_to_standard)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(metric_code, entity_code) DO UPDATE SET unit_input = ?, factor_to_standard = ?`
  ).bind(metric_code, entity_code, unit_input, f, unit_input, f).run();
  await logMasterChange(env, 'metric_unit_override', `${metric_code}/${entity_code}`,
                        'unit_input', null, `${unit_input} x${f}`, actor);
  return json({ ok: true });
}

/** POST /api/master/factor — 계수는 수정하지 않고 새 버전으로만 등록한다 (R59) */
async function handleFactorPost(body, env, actor) {
  const need = ['factor_type', 'purpose', 'region', 'year', 'value', 'unit', 'source', 'published_at', 'version'];
  const missing = need.filter((k) => body?.[k] === undefined || body[k] === '');
  if (missing.length) return json({ error: 'missing_fields', missing }, 400);

  const value = Number(body.value);
  const year = Number(body.year);
  if (!Number.isFinite(value) || value < 0) return json({ error: 'invalid_value' }, 400);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return json({ error: 'invalid_year' }, 400);
  if (!['emission', 'heating_value'].includes(body.purpose)) return json({ error: 'invalid_purpose' }, 400);

  try {
    await env.DB.prepare(
      `INSERT INTO factor (factor_type, purpose, region, year, value, unit, gwp_set, source, published_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(body.factor_type, body.purpose, body.region, year, value, body.unit,
           body.gwp_set || null, body.source, body.published_at, body.version).run();
  } catch (err) {
    return json({ error: 'db_rejected', message: String(err.message || err),
      hint: '같은 종류·지역·연도·버전의 계수가 이미 있습니다. 값을 고치려면 새 버전으로 등록하세요 (R59).' }, 400);
  }
  await logMasterChange(env, 'factor',
    `${body.factor_type}/${body.purpose}/${body.region}/${year}/${body.version}`,
    'value', null, String(value), actor);
  return json({ ok: true });
}

/** POST /api/master/fx — 연평균 환율 (R65) */
async function handleFxPost(body, env, actor) {
  const need = ['currency', 'year', 'rate_avg', 'source', 'version'];
  const missing = need.filter((k) => body?.[k] === undefined || body[k] === '');
  if (missing.length) return json({ error: 'missing_fields', missing }, 400);
  const rate = Number(body.rate_avg);
  const year = Number(body.year);
  if (!Number.isFinite(rate) || rate <= 0) return json({ error: 'invalid_rate' }, 400);
  if (!Number.isInteger(year)) return json({ error: 'invalid_year' }, 400);

  try {
    await env.DB.prepare(
      `INSERT INTO fx_rate (currency, year, rate_avg, source, version) VALUES (?, ?, ?, ?, ?)`
    ).bind(body.currency, year, rate, body.source, body.version).run();
  } catch (err) {
    return json({ error: 'db_rejected', message: String(err.message || err),
      hint: '같은 통화·연도·버전의 환율이 이미 있습니다.' }, 400);
  }
  await logMasterChange(env, 'fx_rate', `${body.currency}/${year}/${body.version}`,
                        'rate_avg', null, String(rate), actor);
  return json({ ok: true });
}

/** GET /api/master/audit — 최근 변경 이력 */
async function handleMasterAudit(env) {
  const rows = await env.DB.prepare(
    `SELECT table_name, row_key, field, old_value, new_value, changed_by_role, changed_at
       FROM audit_log
      WHERE table_name IN ('metric','metric_assignment','metric_unit_override','factor','fx_rate')
      ORDER BY id DESC LIMIT 50`
  ).all();
  return json({ entries: rows.results });
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
  // REQUIRE_ACCESS=false 인 로컬 확인 상태. authorizeInput 과 같은 역할을 가정해야
  // 화면과 API 권한이 어긋나지 않는다.
  const effectiveRoles = identity.authenticated ? identity.roles : ['HQ_ESG'];
  if (effectiveRoles.length === 0) {
    return json({ roles: [], assignments: [], scopes: [],
      can: { master: false, input: false, board: false, review: false, close: false,
             all_entities: false },
      hint: '이 계정에 역할이 매핑되지 않았습니다.' }, 200);
  }

  const placeholders = effectiveRoles.map(() => '?').join(',');
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
  ).bind(...effectiveRoles).all();

  const scopes = [...new Set(rows.results.map((r) => r.scope))];
  const entryEntities = [...new Set(rows.results.filter((r) => r.scope === 'entry').map((r) => r.entity_code))];
  const isManager = scopes.some((s) => ['manager', 'approver', 'admin'].includes(s));
  const canInput = rows.results.some((r) => r.scope === 'entry') || isManager;
  const review = reviewScope(rows.results);
  return json({
    roles: effectiveRoles,
    unauthenticated_local: !identity.authenticated || undefined,
    assignments: rows.results,
    scopes,
    can: {
      master: isManager,
      input: canInput,
      // 현황 보드는 입력 담당자도 본다 — 자기 법인의 빈칸을 스스로 보게 한다 (P-4)
      board: canInput,
      review: review.canApprove,
      close: review.canClose,
      all_entities: isManager,
    },
    entry_entities: entryEntities,
    default_entity: entryEntities[0] || 'HQ',
    default_locale: rows.results[0] ? rows.results[0].locale : 'ko',
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      try {
        if (url.pathname === '/api/health') return await handleHealth(request, env);
        if (url.pathname === '/api/me')     return await handleMe(request, env);

        if (url.pathname.startsWith('/api/entry')) {
          const auth = await authorizeInput(request, env);
          if (auth.error) return auth.error;
          const { scope, actor } = auth;

          if (url.pathname === '/api/entry/sheet' && request.method === 'GET') {
            const entityCode = url.searchParams.get('entity');
            const period = url.searchParams.get('period');
            if (!entityCode || !period || !isValidPeriod(period)) {
              return json({ error: 'invalid_params', hint: 'entity 와 period(YYYY-MM) 가 필요합니다.' }, 400);
            }
            if (!scope.isManager && !(scope.entities || []).includes(entityCode)) {
              return json({ error: 'forbidden_entity',
                hint: '자기 법인의 데이터만 조회할 수 있습니다.' }, 403);
            }
            const sheet = await loadSheet(env, entityCode, period, scope);
            if (sheet.error) return json(sheet, 404);
            return json(sheet);
          }
          if (url.pathname === '/api/entry' && request.method === 'POST') {
            const body = await request.json().catch(() => ({}));
            const r = await saveEntry(env, body, scope, actor);
            return json(r.body, r.status);
          }
          if (url.pathname === '/api/entry/submit' && request.method === 'POST') {
            const body = await request.json().catch(() => ({}));
            if (!body.entity_code || !isValidPeriod(body.period || '')) {
              return json({ error: 'invalid_params' }, 400);
            }
            const r = await submitSheet(env, body.entity_code, body.period, scope);
            return json(r.body, r.status);
          }
          if (url.pathname === '/api/entry/evidence' && request.method === 'POST') {
            const r = await uploadEvidence(env, request, scope, actor);
            return json(r.body, r.status);
          }
          if (url.pathname === '/api/entry/evidence' && request.method === 'GET') {
            const key = url.searchParams.get('key');
            if (!key) return json({ error: 'missing_key' }, 400);
            const r = await fetchEvidence(env, key, scope);
            if (r.status !== 200) return json({ error: 'not_found_or_forbidden' }, r.status);
            return new Response(r.stream, { headers: r.headers });
          }
          return json({ error: 'not_found', path: url.pathname, method: request.method }, 404);
        }

        if (url.pathname.startsWith('/api/review')) {
          const auth = await authorizeInput(request, env);
          if (auth.error) return auth.error;
          const { rows, scope, actor } = auth;
          const review = reviewScope(rows);
          const body = ['POST', 'PATCH', 'PUT'].includes(request.method)
            ? await request.json().catch(() => ({}))
            : null;

          // 현황 보드는 입력 담당자도 본다 — 자기 법인의 빈칸을 스스로 보게 하는 것이 목적이다 (P-4)
          if (url.pathname === '/api/review/board' && request.method === 'GET') {
            const year = Number(url.searchParams.get('year'));
            if (!Number.isInteger(year) || year < 2000 || year > 2100) {
              return json({ error: 'invalid_year' }, 400);
            }
            let entityCode = url.searchParams.get('entity') || null;
            let allowed = null;            // null = 전 법인
            if (!scope.isManager) {
              const mine = scope.entities || [];
              if (mine.length === 0) return json({ error: 'forbidden_entity' }, 403);
              // 입력 담당자는 자기 법인만 본다. 다른 법인을 요청하면 자기 법인으로 되돌린다
              if (!entityCode || !mine.includes(entityCode)) entityCode = mine[0];
              allowed = mine;
            }
            const board = await loadBoard(env, year, entityCode, allowed);
            if (board.error) return json(board, 404);
            return json({ ...board, can_approve: review.canApprove, can_close: review.canClose });
          }

          // 승인 큐부터는 검토 권한이 필요하다
          if (!review.canApprove) {
            return json({ error: 'forbidden',
              hint: '검증·승인 화면은 본사 ESG 총괄·파트장만 사용합니다.' }, 403);
          }

          if (url.pathname === '/api/review/queue' && request.method === 'GET') {
            const period = url.searchParams.get('period');
            if (period && !isValidPeriod(period)) return json({ error: 'invalid_period' }, 400);
            const q = await loadQueue(env, {
              entityCode: url.searchParams.get('entity') || null,
              period: period || null,
            });
            return json({ ...q, can_close: review.canClose });
          }
          if (url.pathname === '/api/review/approve' && request.method === 'POST') {
            const r = await approveEntries(env, body, review, actor);
            return json(r.body, r.status);
          }
          if (url.pathname === '/api/review/return' && request.method === 'POST') {
            const r = await returnEntry(env, body, review, actor);
            return json(r.body, r.status);
          }
          if (url.pathname === '/api/review/close' && request.method === 'POST') {
            const r = await closePeriod(env, body, review, actor);
            return json(r.body, r.status);
          }
          if (url.pathname === '/api/review/reopen' && request.method === 'POST') {
            const r = await reopenPeriod(env, body, review, actor);
            return json(r.body, r.status);
          }
          return json({ error: 'not_found', path: url.pathname, method: request.method }, 404);
        }

        if (url.pathname.startsWith('/api/calc')) {
          const auth = await authorizeInput(request, env);
          if (auth.error) return auth.error;
          const { scope, actor } = auth;
          const version = url.searchParams.get('version')
            || await latestFactorVersion(env);
          if (!version) {
            return json({ error: 'no_factors',
              hint: '배출계수가 등록되지 않았습니다. 기준정보 → 배출계수에서 등록하세요.' }, 409);
          }

          if (url.pathname === '/api/calc/month' && request.method === 'GET') {
            const entityCode = url.searchParams.get('entity');
            const period = url.searchParams.get('period');
            if (!entityCode || !period || !isValidPeriod(period)) {
              return json({ error: 'invalid_params',
                hint: 'entity 와 period(YYYY-MM) 가 필요합니다.' }, 400);
            }
            if (!scope.isManager && !(scope.entities || []).includes(entityCode)) {
              return json({ error: 'forbidden_entity' }, 403);
            }
            const c = await computeMonth(env, entityCode, period, version);
            if (c.error) return json(c, 404);
            return json(c);
          }

          // 재산정·저장과 그룹 합산은 총괄 이상만 한다
          if (!scope.isManager) {
            return json({ error: 'forbidden',
              hint: '산정 실행과 그룹 합산은 본사 총괄·승인자만 사용합니다.' }, 403);
          }

          if (url.pathname === '/api/calc/year' && request.method === 'GET') {
            const year = Number(url.searchParams.get('year'));
            if (!Number.isInteger(year) || year < 2000 || year > 2100) {
              return json({ error: 'invalid_year' }, 400);
            }
            return json(await computeYear(env, year, version));
          }
          if (url.pathname === '/api/calc/run' && request.method === 'POST') {
            const body = await request.json().catch(() => ({}));
            const period = body.period;
            if (!isValidPeriod(period || '')) return json({ error: 'invalid_period' }, 400);
            const entities = body.entity_code
              ? [body.entity_code]
              : (await env.DB.prepare(
                  `SELECT code FROM entity WHERE is_active = 1 ORDER BY code`).all())
                  .results.map((e) => e.code);
            const out = [];
            for (const code of entities) {
              const c = await computeMonth(env, code, period, version);
              if (c.error) { out.push({ entity_code: code, error: c.error }); continue; }
              const saved = await saveMonthResult(env, c);
              out.push({ entity_code: code, results: c.results,
                         unpriced: c.unpriced.length, excluded: c.excluded.length,
                         pending_approval: c.pending_approval, saved_metrics: saved });
            }
            return json({ ok: true, period, factor_version: version,
                          actor_role: actor, entities: out });
          }
          return json({ error: 'not_found', path: url.pathname, method: request.method }, 404);
        }

        if (url.pathname.startsWith('/api/master')) {
          const auth = await authorizeMaster(request, env);
          if (auth.error) return auth.error;
          const actor = auth.actor || null;
          const body = ['POST', 'PATCH', 'PUT'].includes(request.method)
            ? await request.json().catch(() => ({}))
            : null;

          if (url.pathname === '/api/master' && request.method === 'GET') {
            return await handleMasterBootstrap(env);
          }
          if (url.pathname === '/api/master/audit' && request.method === 'GET') {
            return await handleMasterAudit(env);
          }
          const metricMatch = url.pathname.match(/^\/api\/master\/metric\/([A-Za-z0-9._-]+)$/);
          if (metricMatch && request.method === 'PATCH') {
            return await handleMetricPatch(decodeURIComponent(metricMatch[1]), body, env, actor);
          }
          if (url.pathname === '/api/master/assignment' && request.method === 'PATCH') {
            return await handleAssignmentPatch(body, env, actor);
          }
          if (url.pathname === '/api/master/unit' && request.method === 'PUT') {
            return await handleUnitPut(body, env, actor);
          }
          if (url.pathname === '/api/master/factor' && request.method === 'POST') {
            return await handleFactorPost(body, env, actor);
          }
          if (url.pathname === '/api/master/fx' && request.method === 'POST') {
            return await handleFxPost(body, env, actor);
          }
          return json({ error: 'not_found', path: url.pathname, method: request.method }, 404);
        }

        return json({ error: 'not_found', path: url.pathname }, 404);
      } catch (err) {
        // 오류 메시지를 그대로 내려준다. 비개발자가 AI 에게 붙여넣을 수 있어야 한다 (EP8 원칙 6)
        return json({ error: 'internal_error', message: String(err && err.message ? err.message : err) }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  },
};
