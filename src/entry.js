/**
 * 입력값 처리 — 월간 입력 시트(S1)와 항목 입력 카드(S2)의 서버측.
 *
 * 이 파일이 지키는 규칙 (docs/planning/ep05-design.md · ep03-personas.md)
 *   P-1 / R3   입력자는 숫자만 보낸다. 단위는 서버가 마스터에서 결정한다.
 *              클라이언트가 보낸 단위를 믿지 않는다 — EP1 "만kWh 사건"의 재발 방지.
 *   P-2 / D-2  '미입력'과 '미확보'는 다른 상태다. 미확보는 값이 NULL이고 사유가 필수다.
 *   R60        이상치는 차단하지 않고 경고만 한다. 실제로 급증하는 달이 있고,
 *              차단하면 담당자가 숫자를 맞춰 넣는다.
 *   R63        해당 월에 수집할 항목만 시트에 뜬다. 월간 시트에 분기·연간 항목이 섞이지 않는다.
 *   R62        법인 단위 데이터 격리. 심양 담당자는 빈푹 데이터에 접근할 수 없다.
 *   R85        행위자는 역할코드로만 기록한다.
 *   R86        인사·안전 지표에는 증빙을 첨부할 수 없다 (DB 트리거가 거부).
 */

const ANOMALY_THRESHOLD = 0.30; // 전월 대비 ±30%

/* ── 기간 계산 ─────────────────────────────────────────────── */

export function shiftPeriod(period, months) {
  const [y, m] = period.split('-').map(Number);
  const total = y * 12 + (m - 1) - months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** 수집주기별 비교 대상 기간. 분기 항목은 전분기, 연간 항목은 전년과 비교한다 */
export function prevPeriodFor(periodType, period) {
  if (periodType === 'quarterly') return shiftPeriod(period, 3);
  if (periodType === 'annual') return shiftPeriod(period, 12);
  return shiftPeriod(period, 1);
}

/** R63 — 이 기간에 수집해야 하는 항목인지 */
export function dueInPeriod(periodType, period) {
  const month = Number(period.split('-')[1]);
  if (periodType === 'monthly') return true;
  if (periodType === 'quarterly') return [3, 6, 9, 12].includes(month);
  if (periodType === 'annual') return month === 12;
  return false;
}

/** 입력 마감 — 다음 달 10일 (EP4 운영 사이클) */
export function deadlineFor(period) {
  const next = shiftPeriod(period, -1);
  return `${next}-10`;
}

export function isValidPeriod(period) {
  if (!/^\d{4}-\d{2}$/.test(period)) return false;
  const m = Number(period.split('-')[1]);
  return m >= 1 && m <= 12;
}

/* ── 이상치 ────────────────────────────────────────────────── */

/**
 * 전월(또는 전분기·전년) 대비 변동을 본다.
 * 반환 { flag, pct, kind } — kind 는 화면이 문구를 고르는 데 쓴다.
 */
export function detectAnomaly(value, prev) {
  if (value === null || value === undefined) return { flag: 0, pct: null, kind: null };
  if (prev === null || prev === undefined) return { flag: 0, pct: null, kind: 'no_baseline' };
  if (prev === 0) {
    return value === 0
      ? { flag: 0, pct: 0, kind: 'both_zero' }
      : { flag: 1, pct: null, kind: 'new_occurrence' };
  }
  const pct = (value - prev) / Math.abs(prev);
  return {
    flag: Math.abs(pct) >= ANOMALY_THRESHOLD ? 1 : 0,
    pct: Math.round(pct * 1000) / 10,
    kind: Math.abs(pct) >= ANOMALY_THRESHOLD ? 'deviation' : 'normal',
  };
}

/* ── 권한 ──────────────────────────────────────────────────── */

/**
 * 입력 권한 판정. 반환 { entities, roleCodes, isManager }
 *   entry  역할 → 자기 법인, 자기가 주담당·부담당인 항목만
 *   manager/approver/admin → 전 법인 조회·입력 가능
 */
export function inputScope(roleRows) {
  const isManager = roleRows.some((r) => ['manager', 'approver', 'admin'].includes(r.scope));
  const entryRoles = roleRows.filter((r) => r.scope === 'entry');
  return {
    isManager,
    roleCodes: roleRows.map((r) => r.code),
    entities: isManager ? null : [...new Set(entryRoles.map((r) => r.entity_code))],
  };
}

/* ── 조회 ──────────────────────────────────────────────────── */

/**
 * 한 법인·한 기간의 입력 시트.
 * 기대 항목(v_expected_entry)을 왼쪽에 두고 입력값을 붙인다.
 * 기대 항목이 기준이므로, 입력이 하나도 없어도 채울 칸이 전부 나온다.
 */
export async function loadSheet(env, entityCode, period, scope) {
  const entity = await env.DB.prepare(
    `SELECT code, name_ko, name_zh, name_vi, locale_default, currency FROM entity WHERE code = ?`
  ).bind(entityCode).first();
  if (!entity) return { error: 'entity_not_found' };

  const site = await env.DB.prepare(
    `SELECT id FROM site WHERE entity_code = ? AND is_active = 1 ORDER BY id LIMIT 1`
  ).bind(entityCode).first();
  if (!site) return { error: 'site_not_found' };

  const expected = await env.DB.prepare(
    `SELECT metric_code, category, period_type, sort_order,
            name_ko, name_zh, name_vi, unit_standard, unit_input,
            evidence_policy, help_ko, help_zh, help_vi, owner_role, backup_role
       FROM v_expected_entry
      WHERE entity_code = ?
        AND active_from <= ?
        AND (active_to IS NULL OR active_to >= ?)
      ORDER BY sort_order`
  ).bind(entityCode, period, period).all();

  const current = await env.DB.prepare(
    `SELECT id, metric_code, value_raw, unit_raw, status, unavailable_reason_code,
            return_reason, flag_anomaly, anomaly_pct, ai_suggested_value, is_retro,
            entered_by_role, entered_at, approved_at, closed_at, evidence_count
       FROM v_entry WHERE entity_code = ? AND period = ?`
  ).bind(entityCode, period).all();
  const byMetric = new Map(current.results.map((r) => [r.metric_code, r]));

  // 비교 기준값 — 주기별로 다른 기간을 본다
  const prevPeriods = [...new Set(expected.results.map((e) => prevPeriodFor(e.period_type, period)))];
  const prevByMetric = new Map();
  if (prevPeriods.length) {
    const ph = prevPeriods.map(() => '?').join(',');
    const prev = await env.DB.prepare(
      `SELECT metric_code, period, value_raw FROM entry
        WHERE entity_code = ? AND period IN (${ph}) AND value_raw IS NOT NULL`
    ).bind(entityCode, ...prevPeriods).all();
    for (const r of prev.results) prevByMetric.set(`${r.metric_code}@${r.period}`, r.value_raw);
  }

  const items = [];
  let done = 0, unavailable = 0;
  for (const e of expected.results) {
    if (!dueInPeriod(e.period_type, period)) continue;

    const mine = scope.isManager
      || scope.roleCodes.includes(e.owner_role)
      || scope.roleCodes.includes(e.backup_role);
    const row = byMetric.get(e.metric_code) || null;
    const prevPeriod = prevPeriodFor(e.period_type, period);
    const prevValue = prevByMetric.get(`${e.metric_code}@${prevPeriod}`) ?? null;
    const anomaly = row ? detectAnomaly(row.value_raw, prevValue) : { flag: 0, pct: null, kind: null };

    if (row && row.status === 'unavailable') unavailable += 1;
    else if (row && row.value_raw !== null) done += 1;

    items.push({
      metric_code: e.metric_code,
      category: e.category,
      period_type: e.period_type,
      name_ko: e.name_ko, name_zh: e.name_zh, name_vi: e.name_vi,
      unit_input: e.unit_input, unit_standard: e.unit_standard,
      evidence_policy: e.evidence_policy,
      help_ko: e.help_ko, help_zh: e.help_zh, help_vi: e.help_vi,
      owner_role: e.owner_role, backup_role: e.backup_role,
      editable: mine,
      role_kind: scope.roleCodes.includes(e.owner_role) ? 'owner'
        : scope.roleCodes.includes(e.backup_role) ? 'backup' : null,
      entry_id: row ? row.id : null,
      value_raw: row ? row.value_raw : null,
      status: row ? row.status : 'empty',
      unavailable_reason_code: row ? row.unavailable_reason_code : null,
      return_reason: row ? row.return_reason : null,
      locked: !!(row && (row.approved_at || row.closed_at
                         || row.status === 'approved' || row.status === 'closed')),
      approved_at: row ? row.approved_at : null,
      closed_at: row ? row.closed_at : null,
      evidence_count: row ? row.evidence_count : 0,
      ai_suggested_value: row ? row.ai_suggested_value : null,
      prev_period: prevPeriod,
      prev_value: prevValue,
      anomaly,
    });
  }

  const reasons = await env.DB.prepare(
    `SELECT code, label_ko, label_zh, label_vi FROM unavailable_reason ORDER BY sort_order`
  ).all();

  return {
    entity, site_id: site.id, period,
    deadline: deadlineFor(period),
    items,
    progress: { total: items.length, done, unavailable, empty: items.length - done - unavailable },
    reasons: reasons.results,
  };
}

/* ── 저장 ──────────────────────────────────────────────────── */

/**
 * 입력값 하나를 저장한다.
 * 단위는 마스터에서 읽어 서버가 넣는다 — 클라이언트가 보낸 단위는 쓰지 않는다 (R3 / P-1).
 */
export async function saveEntry(env, body, scope, actorRole) {
  const { entity_code, metric_code, period } = body || {};
  if (!entity_code || !metric_code || !period) return { status: 400, body: { error: 'missing_key' } };
  if (!isValidPeriod(period)) return { status: 400, body: { error: 'invalid_period' } };

  if (!scope.isManager && !(scope.entities || []).includes(entity_code)) {
    return { status: 403, body: { error: 'forbidden_entity',
      hint: '자기 법인의 데이터만 입력할 수 있습니다.' } };
  }

  // LEFT JOIN 으로 읽는다. 배정이 없는 이유(계산지표인지, 미배정인지)를 구분해 안내해야 한다
  const meta = await env.DB.prepare(
    `SELECT m.code, m.period_type, m.unit_standard, m.is_calculated, m.evidence_policy,
            a.owner_role, a.backup_role, a.is_applicable,
            COALESCE(o.unit_input, m.unit_standard) AS unit_input,
            (SELECT id FROM site WHERE entity_code = ? AND is_active = 1 ORDER BY id LIMIT 1) AS site_id
       FROM metric m
       LEFT JOIN metric_assignment a ON a.metric_code = m.code AND a.entity_code = ?
       LEFT JOIN metric_unit_override o ON o.metric_code = m.code AND o.entity_code = ?
      WHERE m.code = ?`
  ).bind(entity_code, entity_code, entity_code, metric_code).first();

  if (!meta) {
    return { status: 404, body: { error: 'metric_not_found',
      hint: `${metric_code} 은(는) 등록된 지표가 아닙니다.` } };
  }
  if (meta.is_calculated) {
    return { status: 400, body: { error: 'calculated_metric',
      hint: '계산지표는 입력하지 않습니다. 원천 항목을 입력하면 시스템이 산출합니다.' } };
  }
  if (meta.owner_role === null) {
    return { status: 400, body: { error: 'metric_not_assigned',
      hint: '이 법인에 담당이 배정되지 않은 항목입니다. 기준정보 → 담당 배정에서 지정하세요.' } };
  }
  if (!meta.is_applicable) {
    return { status: 400, body: { error: 'not_applicable',
      hint: '이 법인에 해당하지 않는 항목으로 설정되어 있습니다.' } };
  }
  if (!dueInPeriod(meta.period_type, period)) {
    return { status: 400, body: { error: 'not_due',
      hint: `이 항목의 수집주기는 ${meta.period_type} 입니다. 해당 기간에 입력하세요.` } };
  }
  const mine = scope.isManager
    || scope.roleCodes.includes(meta.owner_role)
    || scope.roleCodes.includes(meta.backup_role);
  if (!mine) {
    return { status: 403, body: { error: 'not_my_metric',
      hint: '담당으로 배정된 항목만 입력할 수 있습니다.' } };
  }

  const existing = await env.DB.prepare(
    `SELECT id, status, value_raw, approved_at, closed_at FROM entry
      WHERE site_id = ? AND metric_code = ? AND period = ?`
  ).bind(meta.site_id, metric_code, period).first();

  // 미확보 항목은 승인돼도 status 가 unavailable 로 남는다(review.js 참조).
  // 따라서 잠금 판단은 status 가 아니라 승인·확정 시각으로 한다.
  if (existing && (existing.approved_at || existing.closed_at
                   || existing.status === 'approved' || existing.status === 'closed')) {
    return { status: 409, body: { error: 'locked',
      hint: '이미 승인·확정된 항목입니다. 수정이 필요하면 총괄에게 요청하세요.' } };
  }

  // 미확보 · 값 입력 · 되돌리기 세 갈래
  const reason = body.unavailable_reason_code || null;
  const hasValue = body.value_raw !== undefined && body.value_raw !== null && body.value_raw !== '';

  let value = null, status = 'empty';
  if (reason) {
    status = 'unavailable';
  } else if (hasValue) {
    value = Number(String(body.value_raw).replace(/,/g, ''));
    if (!Number.isFinite(value)) {
      return { status: 400, body: { error: 'invalid_number', hint: '숫자만 입력하세요.' } };
    }
    if (value < 0) {
      return { status: 400, body: { error: 'negative', hint: '음수는 입력할 수 없습니다.' } };
    }
    status = 'entered';
  }

  // 비교 기준값과 이상치 — 차단하지 않고 기록만 한다 (R60)
  const prevPeriod = prevPeriodFor(meta.period_type, period);
  const prev = await env.DB.prepare(
    `SELECT value_raw FROM entry WHERE site_id = ? AND metric_code = ? AND period = ?`
  ).bind(meta.site_id, metric_code, prevPeriod).first();
  const anomaly = detectAnomaly(value, prev ? prev.value_raw : null);

  const now = new Date().toISOString();
  const isRetro = body.is_retro ? 1 : (period < now.slice(0, 7) ? 1 : 0);

  try {
    if (existing) {
      await env.DB.prepare(
        `UPDATE entry
            SET value_raw = ?, unit_raw = ?, status = ?, unavailable_reason_code = ?,
                return_reason = NULL, flag_anomaly = ?, anomaly_pct = ?,
                entered_by_role = ?, entered_at = ?, is_retro = ?,
                last_changed_by_role = ?, updated_at = ?
          WHERE id = ?`
      ).bind(value, value === null ? null : meta.unit_input, status, reason,
             anomaly.flag, anomaly.pct, actorRole, now, isRetro, actorRole, now, existing.id).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO entry (entity_code, site_id, metric_code, period, value_raw, unit_raw,
                            status, unavailable_reason_code, flag_anomaly, anomaly_pct,
                            entered_by_role, entered_at, is_retro, last_changed_by_role, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(entity_code, meta.site_id, metric_code, period, value,
             value === null ? null : meta.unit_input, status, reason,
             anomaly.flag, anomaly.pct, actorRole, now, isRetro, actorRole, now).run();
    }
  } catch (err) {
    return { status: 400, body: { error: 'db_rejected', message: String(err.message || err) } };
  }

  return { status: 200, body: {
    ok: true,
    metric_code, period, status,
    value_raw: value,
    unit_raw: value === null ? null : meta.unit_input,
    unavailable_reason_code: reason,
    is_retro: isRetro,
    prev_period: prevPeriod,
    prev_value: prev ? prev.value_raw : null,
    anomaly,
  } };
}

/* ── 제출 확인 ─────────────────────────────────────────────── */

/**
 * 제출 = 입력 완료 확인.
 * 값은 입력하는 즉시 저장되므로 따로 확정할 것이 없다.
 * 이 호출은 "빠진 것이 있는지" 확인해서 알려준다.
 */
export async function submitSheet(env, entityCode, period, scope) {
  if (!scope.isManager && !(scope.entities || []).includes(entityCode)) {
    return { status: 403, body: { error: 'forbidden_entity' } };
  }
  const sheet = await loadSheet(env, entityCode, period, scope);
  if (sheet.error) return { status: 400, body: sheet };

  const missing = sheet.items.filter((i) => i.status === 'empty');
  const anomalies = sheet.items.filter((i) => i.anomaly && i.anomaly.flag);
  const needEvidence = sheet.items.filter((i) =>
    i.evidence_policy === 'required' && i.status === 'entered' && i.evidence_count === 0);

  return { status: 200, body: {
    ok: missing.length === 0,
    progress: sheet.progress,
    missing: missing.map((i) => ({ metric_code: i.metric_code, name_ko: i.name_ko })),
    anomalies: anomalies.map((i) => ({ metric_code: i.metric_code, name_ko: i.name_ko, pct: i.anomaly.pct })),
    missing_evidence: needEvidence.map((i) => ({ metric_code: i.metric_code, name_ko: i.name_ko })),
  } };
}

/* ── 증빙 업로드 ───────────────────────────────────────────── */

const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf',
]);
const MAX_BYTES = 10 * 1024 * 1024;

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 증빙 파일 업로드.
 * 인사·안전 지표는 DB 트리거가 거부한다 — 여기서도 미리 걸러 안내를 준다 (R86).
 */
export async function uploadEvidence(env, request, scope, actorRole) {
  let form;
  try { form = await request.formData(); } catch { return { status: 400, body: { error: 'invalid_form' } }; }

  const entityCode = form.get('entity_code');
  const metricCode = form.get('metric_code');
  const period = form.get('period');
  const file = form.get('file');

  if (!entityCode || !metricCode || !period || !(file instanceof File)) {
    return { status: 400, body: { error: 'missing_fields' } };
  }
  if (!scope.isManager && !(scope.entities || []).includes(entityCode)) {
    return { status: 403, body: { error: 'forbidden_entity' } };
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return { status: 400, body: { error: 'unsupported_type', type: file.type,
      hint: '사진(JPG·PNG·WEBP·HEIC) 또는 PDF 만 첨부할 수 있습니다.' } };
  }
  if (file.size > MAX_BYTES) {
    return { status: 400, body: { error: 'too_large',
      hint: '10MB 이하 파일만 첨부할 수 있습니다. 사진 해상도를 낮춰 다시 찍어보세요.' } };
  }

  const metric = await env.DB.prepare(
    `SELECT evidence_policy FROM metric WHERE code = ?`
  ).bind(metricCode).first();
  if (!metric) return { status: 404, body: { error: 'metric_not_found' } };
  if (metric.evidence_policy === 'none') {
    return { status: 400, body: { error: 'evidence_not_allowed',
      hint: '이 항목은 증빙을 첨부하지 않습니다. 인사·안전 지표에 개인정보가 포함된 자료가 '
          + '올라가지 않도록 첨부 경로를 두지 않았습니다.' } };
  }

  const entry = await env.DB.prepare(
    `SELECT e.id FROM entry e
       JOIN site s ON s.id = e.site_id
      WHERE s.entity_code = ? AND e.metric_code = ? AND e.period = ?`
  ).bind(entityCode, metricCode, period).first();
  if (!entry) {
    return { status: 400, body: { error: 'entry_missing',
      hint: '먼저 값을 입력한 뒤 증빙을 첨부하세요.' } };
  }

  const buffer = await file.arrayBuffer();
  const hash = await sha256Hex(buffer);
  const safeName = String(file.name).replace(/[^\w.\-가-힣一-龥]/g, '_').slice(-80);
  const key = `${entityCode}/${period}/${metricCode}/${hash.slice(0, 12)}-${safeName}`;

  await env.EVIDENCE.put(key, buffer, { httpMetadata: { contentType: file.type } });

  try {
    await env.DB.prepare(
      `INSERT INTO evidence (entry_id, r2_key, original_filename, content_type, byte_size,
                             sha256, uploaded_by_role, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(entry.id, key, file.name, file.type, file.size, hash, actorRole,
           new Date().toISOString()).run();
  } catch (err) {
    // DB 트리거가 거부한 경우 R2 객체를 남기지 않는다
    await env.EVIDENCE.delete(key).catch(() => {});
    return { status: 400, body: { error: 'db_rejected', message: String(err.message || err) } };
  }

  return { status: 200, body: { ok: true, filename: file.name, size: file.size } };
}

/** 증빙 파일 내려주기 — 자기 법인 것만 */
export async function fetchEvidence(env, r2Key, scope) {
  const row = await env.DB.prepare(
    `SELECT v.r2_key, v.content_type, v.original_filename, e.entity_code
       FROM evidence v JOIN entry e ON e.id = v.entry_id
      WHERE v.r2_key = ?`
  ).bind(r2Key).first();
  if (!row) return { status: 404 };
  if (!scope.isManager && !(scope.entities || []).includes(row.entity_code)) {
    return { status: 403 };
  }
  const object = await env.EVIDENCE.get(row.r2_key);
  if (!object) return { status: 404 };
  return {
    status: 200,
    stream: object.body,
    headers: {
      'content-type': row.content_type,
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.original_filename)}`,
      'cache-control': 'private, no-store',
    },
  };
}
