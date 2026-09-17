/**
 * 입력 현황 보드 (S4) · 검증·승인 (S5)
 *
 * 이 파일이 지키는 규칙
 *   R55  산출값에서 원본 입력값까지 역추적할 수 있어야 한다 → 보드가 원본 상태를 그대로 보여준다
 *   R57  독촉은 사람이 아니라 시스템이 한다 (P-4) → 보드가 미입력 셀을 지목한다
 *   R58  확정 후 수정도 차단하지 않고 이력으로 남긴다 → 상태 변경은 전부 audit_log 트리거가 기록한다
 *   R60  이상치는 차단하지 않고 경고한다 → 승인 큐에서 이상치를 위에 올린다
 *   R54  최종 확정(2단 승인) 없이 산출물을 만들 수 없다
 *   D-2  미입력(empty)과 미확보(unavailable)는 끝까지 다른 상태로 구분한다
 *
 * 상태 흐름
 *   empty → entered → approved → closed
 *                  ↘ returned → entered
 *   empty → unavailable ──(승인)──(확정)──▶ 끝까지 unavailable 로 남는다
 *
 *   1단 승인: manager (본사 ESG 총괄)  — 항목별 승인·반송
 *   2단 확정: approver / admin (파트장) — 기간 전체 확정. 확정 시 배출량이 산정·저장된다
 *
 * ⚠️ 미확보(unavailable) 항목은 승인·확정해도 status 를 바꾸지 않는다.
 *    approved_at · closed_at 만 찍는다. 이유가 두 가지다.
 *      1) 스키마가 막는다 — status='approved' 는 값이 있어야 한다는 CHECK 이 걸려 있다.
 *      2) 그게 맞다 — "승인된 미확보"가 "승인된 값"과 같은 상태가 되면,
 *         보고서를 만들 때 이 칸이 빈 이유를 설명할 수 없게 된다 (D-2).
 *    따라서 승인 여부는 status 가 아니라 approved_at 의 유무로 판단한다.
 *
 * 개인정보: 승인자·반송자는 역할코드로만 기록한다 (R85). 이름·이메일은 어디에도 없다.
 */

import { dueInPeriod, prevPeriodFor, detectAnomaly, isValidPeriod } from './entry.js';
import { computeMonth, saveMonthResult, latestFactorVersion } from './calc.js';

const APPROVE_SCOPES = new Set(['manager', 'approver', 'admin']);
const CLOSE_SCOPES = new Set(['approver', 'admin']);

const RETURN_REASONS = new Set(['UNIT_SUSPECT', 'VALUE_SUSPECT', 'EVIDENCE_MISSING', 'WRONG_PERIOD']);

/** 검토 권한 해석. scope 는 entry.js 의 inputScope() 결과에 역할 행을 더한 것이다 */
export function reviewScope(roleRows) {
  const scopes = new Set(roleRows.map((r) => r.scope));
  return {
    canApprove: [...scopes].some((s) => APPROVE_SCOPES.has(s)),
    canClose: [...scopes].some((s) => CLOSE_SCOPES.has(s)),
  };
}

function monthsOf(year) {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
}

/** 승인·확정 여부. 미확보 항목은 status 가 바뀌지 않으므로 타임스탬프로 본다 */
function isApproved(row) { return !!(row && row.approved_at); }
function isClosed(row) { return !!(row && row.closed_at); }

/** 한 셀의 표시 상태. 화면은 이 값만 보고 색을 정한다 */
function cellState(row) {
  if (!row) return 'empty';
  if (row.status === 'unavailable') return 'unavailable';
  if (row.status === 'entered' && row.flag_anomaly) return 'anomaly';
  return row.status;
}

/* ── S4 입력 현황 보드 ─────────────────────────────────────── */

/**
 * 법인 × 항목 × 월 현황.
 *
 * entityCode 를 주면 그 법인의 항목별 12개월 매트릭스(rows)까지 낸다.
 * 주지 않으면 법인 × 월 진행률(summary)만 낸다 — 첫 화면을 가볍게 유지한다.
 */
export async function loadBoard(env, year, entityCode, allowedCodes) {
  const from = `${year}-01`;
  const to = `${year}-12`;

  const all = await env.DB.prepare(
    `SELECT code, name_ko FROM entity WHERE is_active = 1 ORDER BY code`
  ).all();
  if (entityCode && !all.results.some((e) => e.code === entityCode)) {
    return { error: 'entity_not_found' };
  }
  // 요약(법인 × 월)은 볼 수 있는 법인 전부를 대상으로 한다.
  // 법인 하나를 골랐다고 나머지 법인의 진행률이 사라지면, 총괄이 "어디가 밀렸는지"를
  // 보려고 매번 법인을 번갈아 눌러야 한다. 상세(항목 × 월)만 고른 법인으로 좁힌다.
  const entities = allowedCodes
    ? all.results.filter((e) => allowedCodes.includes(e.code))
    : all.results;
  const codes = entities.map((e) => e.code);
  if (codes.length === 0) return { error: 'no_entity_in_scope' };

  const ph = codes.map(() => '?').join(',');

  // 입력해야 하는 항목 (계산지표는 v_expected_entry 가 이미 제외한다)
  const expected = await env.DB.prepare(
    `SELECT entity_code, metric_code, category, period_type, sort_order,
            name_ko, unit_input, owner_role
       FROM v_expected_entry
      WHERE entity_code IN (${ph})
        AND active_from <= ?
        AND (active_to IS NULL OR active_to >= ?)
      ORDER BY sort_order, metric_code`
  ).bind(...codes, to, from).all();

  const entered = await env.DB.prepare(
    `SELECT entity_code, metric_code, period, value_raw, status,
            unavailable_reason_code, flag_anomaly, anomaly_pct,
            approved_at, closed_at
       FROM entry
      WHERE entity_code IN (${ph}) AND period >= ? AND period <= ?`
  ).bind(...codes, from, to).all();

  const byKey = new Map(
    entered.results.map((r) => [`${r.entity_code}|${r.metric_code}|${r.period}`, r]));

  const months = monthsOf(year);
  const summary = {};
  for (const code of codes) {
    for (const period of months) {
      summary[`${code}|${period}`] = {
        expected: 0, empty: 0,
        entered: 0,              // 입력됨 · 1단 승인 대기
        returned: 0,             // 반송됨 · 담당자 재입력 대기
        approved: 0,             // 1단 승인 완료 (값 있음)
        closed: 0,               // 2단 확정 완료
        unavailable: 0,          // 미확보 (승인 여부와 무관한 총계)
        unavailable_pending: 0,  // 미확보인데 사유 검토가 안 된 것
        anomaly: 0,
      };
    }
  }

  const rowMap = new Map();

  for (const e of expected.results) {
    for (const period of months) {
      if (!dueInPeriod(e.period_type, period)) continue;
      const s = summary[`${e.entity_code}|${period}`];
      const row = byKey.get(`${e.entity_code}|${e.metric_code}|${period}`) || null;
      const state = cellState(row);

      s.expected += 1;
      if (state === 'empty') s.empty += 1;
      else if (state === 'unavailable') {
        s.unavailable += 1;
        if (!isApproved(row)) s.unavailable_pending += 1;
      } else if (state === 'anomaly') { s.entered += 1; s.anomaly += 1; }
      else if (s[state] !== undefined) s[state] += 1;

      // 상세(항목 × 월)는 고른 법인만. 요약이 전 법인을 도니 여기서 반드시 걸러야 한다
      if (!entityCode || e.entity_code !== entityCode) continue;

      if (!rowMap.has(e.metric_code)) {
        rowMap.set(e.metric_code, {
          metric_code: e.metric_code, name_ko: e.name_ko, category: e.category,
          period_type: e.period_type, unit_input: e.unit_input, owner_role: e.owner_role,
          cells: {},
        });
      }
      rowMap.get(e.metric_code).cells[period] = {
        state,
        value: row ? row.value_raw : null,
        reason: row ? row.unavailable_reason_code : null,
        anomaly_pct: row ? row.anomaly_pct : null,
        approved: isApproved(row),
        closed: isClosed(row),
      };
    }
  }

  for (const key of Object.keys(summary)) {
    const s = summary[key];
    s.filled = s.expected - s.empty;   // 반송 중인 항목도 "손댄" 것이므로 미입력과 구분한다
    s.pending = s.entered + s.returned + s.unavailable_pending;
    s.pct = s.expected ? Math.round((s.filled / s.expected) * 1000) / 10 : null;
  }

  // 미확보 사유는 코드가 아니라 사람이 읽는 말로 보여준다
  const reasons = await env.DB.prepare(
    `SELECT code, label_ko FROM unavailable_reason ORDER BY sort_order`
  ).all();

  return {
    year,
    entity_code: entityCode || null,
    months,
    entities,
    summary,
    rows: entityCode ? [...rowMap.values()] : [],
    reason_labels: Object.fromEntries(reasons.results.map((r) => [r.code, r.label_ko])),
  };
}

/* ── S5 검증·승인 큐 ───────────────────────────────────────── */

/**
 * 승인 대기 항목. 이상치를 위에 올린다 (R60).
 *
 * 대기 = status IN ('entered','unavailable')
 *   미확보(unavailable)도 승인 대상이다. 사유가 타당한지 사람이 봐야 하고,
 *   보지 않은 미확보가 그대로 보고서에 들어가면 안 된다.
 */
export async function loadQueue(env, { entityCode, period }) {
  // 승인이 찍힌 미확보 항목은 큐에서 빠진다 (status 는 그대로 unavailable 이다)
  const where = ["e.status IN ('entered','unavailable')", 'e.approved_at IS NULL'];
  const binds = [];
  if (entityCode) { where.push('e.entity_code = ?'); binds.push(entityCode); }
  if (period) { where.push('e.period = ?'); binds.push(period); }

  const rows = await env.DB.prepare(
    `SELECT e.entity_code, e.metric_code, e.period, e.value_raw, e.unit_raw, e.status,
            e.unavailable_reason_code, e.flag_anomaly, e.anomaly_pct,
            e.entered_by_role, e.entered_at, e.is_retro,
            m.name_ko, m.unit_standard, m.period_type, m.category, m.evidence_policy,
            m.definition_ko, m.sort_order,
            en.name_ko AS entity_name,
            (SELECT COUNT(*) FROM evidence v WHERE v.entry_id = e.id) AS evidence_count
       FROM entry e
       JOIN metric m ON m.code = e.metric_code
       JOIN entity en ON en.code = e.entity_code
      WHERE ${where.join(' AND ')}
      ORDER BY e.flag_anomaly DESC, ABS(COALESCE(e.anomaly_pct, 0)) DESC,
               e.entity_code, m.sort_order
      LIMIT 300`
  ).bind(...binds).all();

  // 비교 기준값 — 반송 판단에 직전 기간 값이 필요하다
  const items = [];
  for (const r of rows.results) {
    const prevPeriod = prevPeriodFor(r.period_type, r.period);
    const prev = await env.DB.prepare(
      `SELECT value_raw FROM entry
        WHERE entity_code = ? AND metric_code = ? AND period = ? AND value_raw IS NOT NULL`
    ).bind(r.entity_code, r.metric_code, prevPeriod).first();
    const prevValue = prev ? prev.value_raw : null;

    items.push({
      entity_code: r.entity_code, entity_name: r.entity_name,
      metric_code: r.metric_code, name_ko: r.name_ko, category: r.category,
      period: r.period, period_type: r.period_type,
      value_raw: r.value_raw, unit_raw: r.unit_raw, unit_standard: r.unit_standard,
      status: r.status,
      unavailable_reason_code: r.unavailable_reason_code,
      definition_ko: r.definition_ko,
      evidence_policy: r.evidence_policy,
      evidence_count: r.evidence_count,
      evidence_missing: r.evidence_policy === 'required' && r.status === 'entered'
                        && r.evidence_count === 0,
      entered_by_role: r.entered_by_role, entered_at: r.entered_at,
      is_retro: r.is_retro,
      prev_period: prevPeriod, prev_value: prevValue,
      anomaly: detectAnomaly(r.value_raw, prevValue),
      stored_anomaly_pct: r.anomaly_pct,
    });
  }

  const reasons = await env.DB.prepare(
    `SELECT code, label_ko FROM unavailable_reason ORDER BY sort_order`
  ).all();

  return {
    entity_code: entityCode || null, period: period || null,
    reason_labels: Object.fromEntries(reasons.results.map((r) => [r.code, r.label_ko])),
    total: items.length,
    anomalies: items.filter((i) => i.anomaly.flag).length,
    evidence_missing: items.filter((i) => i.evidence_missing).length,
    unavailable: items.filter((i) => i.status === 'unavailable').length,
    items,
  };
}

/* ── 승인 · 반송 ───────────────────────────────────────────── */

function keyList(body) {
  const items = Array.isArray(body && body.items) ? body.items : [];
  return items
    .filter((i) => i && i.entity_code && i.metric_code && isValidPeriod(i.period || ''))
    .slice(0, 300);
}

/**
 * 1단 승인.
 *   값이 있는 항목  : status → approved
 *   미확보 항목      : status 유지, approved_at 만 찍는다 (위 주석 참조)
 *
 * 항목별로 실패를 잡아 skipped 에 담는다. 한 건이 막혀서 100건 승인이 통째로
 * 실패하면, 비개발자가 원인을 찾을 수 없다 (EP8 원칙 6).
 */
export async function approveEntries(env, body, review, actorRole) {
  if (!review.canApprove) {
    return { status: 403, body: { error: 'forbidden',
      hint: '승인 권한이 없습니다. 본사 ESG 총괄·파트장만 승인할 수 있습니다.' } };
  }
  const items = keyList(body);
  if (items.length === 0) return { status: 400, body: { error: 'no_items' } };

  const now = new Date().toISOString();
  let approved = 0;
  const skipped = [];

  for (const i of items) {
    const row = await env.DB.prepare(
      `SELECT id, status, value_raw, approved_at FROM entry
        WHERE entity_code = ? AND metric_code = ? AND period = ?`
    ).bind(i.entity_code, i.metric_code, i.period).first();

    if (!row) { skipped.push({ ...i, reason: 'entry_not_found' }); continue; }
    if (row.approved_at) { skipped.push({ ...i, reason: 'already_approved' }); continue; }
    if (!['entered', 'unavailable'].includes(row.status)) {
      skipped.push({ ...i, reason: `not_pending(${row.status})` });
      continue;
    }

    try {
      if (row.status === 'unavailable') {
        await env.DB.prepare(
          `UPDATE entry SET approved_by_role = ?, approved_at = ?,
                            last_changed_by_role = ?, updated_at = ?
            WHERE id = ?`
        ).bind(actorRole, now, actorRole, now, row.id).run();
      } else {
        await env.DB.prepare(
          `UPDATE entry SET status = 'approved', approved_by_role = ?, approved_at = ?,
                            return_reason = NULL,
                            last_changed_by_role = ?, updated_at = ?
            WHERE id = ?`
        ).bind(actorRole, now, actorRole, now, row.id).run();
      }
      approved += 1;
    } catch (err) {
      skipped.push({ ...i, reason: 'db_error',
        message: String(err && err.message ? err.message : err) });
    }
  }

  return { status: 200, body: { approved, skipped, actor_role: actorRole, at: now } };
}

/**
 * 반송. approved → entered 로 되돌리지 않고 returned 로 보낸다.
 * 담당자 화면에 "왜 반송됐는지"가 선택형 사유로 표시된다 (R87 — 자유 텍스트 없음).
 */
export async function returnEntry(env, body, review, actorRole) {
  if (!review.canApprove) {
    return { status: 403, body: { error: 'forbidden' } };
  }
  const { entity_code, metric_code, period, return_reason } = body || {};
  if (!entity_code || !metric_code || !isValidPeriod(period || '')) {
    return { status: 400, body: { error: 'missing_key' } };
  }
  if (!RETURN_REASONS.has(return_reason)) {
    return { status: 400, body: { error: 'invalid_return_reason',
      allowed: [...RETURN_REASONS] } };
  }

  const row = await env.DB.prepare(
    `SELECT id, status, value_raw, closed_at FROM entry
      WHERE entity_code = ? AND metric_code = ? AND period = ?`
  ).bind(entity_code, metric_code, period).first();
  if (!row) return { status: 404, body: { error: 'entry_not_found' } };
  if (row.status === 'closed' || row.closed_at) {
    return { status: 409, body: { error: 'already_closed',
      hint: '확정된 기간입니다. 총괄이 확정을 해제한 뒤 반송하세요.' } };
  }
  // status='returned' 는 value_raw 를 요구하지 않지만, 값이 없는 행을 반송할 이유가 없다
  if (row.value_raw === null && row.status !== 'unavailable') {
    return { status: 409, body: { error: 'nothing_to_return' } };
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE entry
        SET status = 'returned', return_reason = ?,
            approved_by_role = NULL, approved_at = NULL,
            last_changed_by_role = ?, updated_at = ?
      WHERE id = ?`
  ).bind(return_reason, actorRole, now, row.id).run();

  return { status: 200, body: { ok: true, entity_code, metric_code, period,
    return_reason, actor_role: actorRole, at: now } };
}

/* ── 2단 확정 ──────────────────────────────────────────────── */

/**
 * 기간 확정 (R54).
 *
 * 승인되지 않은 항목이 하나라도 있으면 확정하지 않는다.
 * 확정과 동시에 배출량을 산정·저장한다 — 확정된 기간의 산출값은 계수 버전과 함께 고정된다 (D-3).
 *
 * dryRun 이면 무엇이 막고 있는지만 돌려준다. 화면이 확정 버튼을 누르기 전에 먼저 호출한다.
 */
export async function closePeriod(env, body, review, actorRole) {
  if (!review.canClose) {
    return { status: 403, body: { error: 'forbidden',
      hint: '기간 확정은 파트장(승인자)·시스템 관리자만 할 수 있습니다.' } };
  }
  const { entity_code, period } = body || {};
  if (!entity_code || !isValidPeriod(period || '')) {
    return { status: 400, body: { error: 'missing_key' } };
  }

  const board = await loadBoard(env, Number(period.slice(0, 4)), entity_code);
  if (board.error) return { status: 404, body: board };
  const s = board.summary[`${entity_code}|${period}`];
  if (!s) return { status: 400, body: { error: 'period_out_of_year' } };

  // 확정을 막는 것은 "빈칸"과 "승인 안 된 것"뿐이다.
  // 승인된 미확보는 막지 않는다 — 확보할 수 없다는 판단까지 사람이 승인한 상태다 (D-2 / P-2)
  const blockers = [];
  if (s.empty > 0) blockers.push({ kind: 'empty', count: s.empty,
    hint: '입력도 미확보 처리도 되지 않은 칸입니다. 담당자에게 입력 또는 미확보 사유 선택을 요청하세요.' });
  if (s.entered > 0) blockers.push({ kind: 'not_approved', count: s.entered,
    hint: '1단 승인이 남았습니다. 검증·승인 화면에서 승인하세요.' });
  if (s.returned > 0) blockers.push({ kind: 'returned', count: s.returned,
    hint: '반송된 항목입니다. 담당자 재입력 후 다시 승인해야 합니다.' });
  if (s.unavailable_pending > 0) blockers.push({ kind: 'unavailable_not_approved',
    count: s.unavailable_pending,
    hint: '미확보 사유가 검토되지 않았습니다. 사유를 확인하고 승인하세요.' });

  const version = body.factor_version || await latestFactorVersion(env);
  if (!version) {
    blockers.push({ kind: 'no_factor_version', count: 0 });
  }

  if (blockers.length > 0 || body.dry_run) {
    return { status: blockers.length ? 409 : 200, body: {
      ok: blockers.length === 0, dry_run: true,
      entity_code, period, factor_version: version,
      progress: s, blockers,
    } };
  }

  const now = new Date().toISOString();
  // 값이 있는 항목은 closed 로, 미확보 항목은 unavailable 을 유지하고 closed_at 만 찍는다
  // (변경 건수는 UPDATE 반환값이 아니라 SELECT 로 센다 — 감사 트리거가 만든 행까지 세어져
  //  "29건인데 58건 확정"처럼 보고되면 사용자가 무엇을 믿어야 할지 알 수 없다)
  await env.DB.prepare(
    `UPDATE entry
        SET status = 'closed', closed_at = ?, last_changed_by_role = ?, updated_at = ?
      WHERE entity_code = ? AND period = ? AND status = 'approved'`
  ).bind(now, actorRole, now, entity_code, period).run();
  await env.DB.prepare(
    `UPDATE entry
        SET closed_at = ?, last_changed_by_role = ?, updated_at = ?
      WHERE entity_code = ? AND period = ? AND status = 'unavailable'
        AND approved_at IS NOT NULL AND closed_at IS NULL`
  ).bind(now, actorRole, now, entity_code, period).run();

  const counted = await env.DB.prepare(
    `SELECT SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END)      AS closed_value,
            SUM(CASE WHEN status = 'unavailable' THEN 1 ELSE 0 END) AS closed_unavailable
       FROM entry
      WHERE entity_code = ? AND period = ? AND closed_at = ?`
  ).bind(entity_code, period, now).first();

  const computed = await computeMonth(env, entity_code, period, version);
  if (computed.error) {
    return { status: 500, body: { error: 'calc_failed', detail: computed } };
  }
  const saved = await saveMonthResult(env, computed);

  return { status: 200, body: {
    ok: true, entity_code, period,
    closed: counted ? (counted.closed_value || 0) : 0,
    closed_unavailable: counted ? (counted.closed_unavailable || 0) : 0,
    factor_version: version,
    results: computed.results,
    unpriced: computed.unpriced,
    saved_metrics: saved,
    actor_role: actorRole, at: now,
  } };
}

/**
 * 확정 해제. 산출값을 고쳐야 할 때 쓴다.
 * 원본은 지우지 않고 상태만 approved 로 되돌린다. 이력에는 전부 남는다 (R58).
 */
export async function reopenPeriod(env, body, review, actorRole) {
  if (!review.canClose) return { status: 403, body: { error: 'forbidden' } };
  const { entity_code, period } = body || {};
  if (!entity_code || !isValidPeriod(period || '')) {
    return { status: 400, body: { error: 'missing_key' } };
  }
  const now = new Date().toISOString();
  const before = await env.DB.prepare(
    `SELECT SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END)      AS v,
            SUM(CASE WHEN status = 'unavailable' THEN 1 ELSE 0 END) AS u
       FROM entry WHERE entity_code = ? AND period = ? AND closed_at IS NOT NULL`
  ).bind(entity_code, period).first();
  await env.DB.prepare(
    `UPDATE entry
        SET status = 'approved', closed_at = NULL, last_changed_by_role = ?, updated_at = ?
      WHERE entity_code = ? AND period = ? AND status = 'closed'`
  ).bind(actorRole, now, entity_code, period).run();
  await env.DB.prepare(
    `UPDATE entry SET closed_at = NULL, last_changed_by_role = ?, updated_at = ?
      WHERE entity_code = ? AND period = ? AND status = 'unavailable' AND closed_at IS NOT NULL`
  ).bind(actorRole, now, entity_code, period).run();
  return { status: 200, body: { ok: true, entity_code, period,
    reopened: before ? (before.v || 0) : 0,
    reopened_unavailable: before ? (before.u || 0) : 0,
    actor_role: actorRole, at: now } };
}
