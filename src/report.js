/**
 * 조회 · 데이터북 · 제출이력 · 경영진 화면 (S6 · S7 · S8 · S9)
 *
 * 이 파일이 지키는 규칙
 *   R11  적용 계수와 버전을 산출값과 함께 항상 내려준다
 *   R40  대외 산출물에는 공개등급 필터가 자동 적용된다. 사람 판단에 맡기지 않는다
 *   R43  확보 불가 연도는 공란이다. 추정치로 채우지 않는다 — 추정 칸이 존재하지 않는다
 *   R44  GRI · KSSB 지표코드를 병기한다
 *   R46  보고서 집필자가 그대로 쓸 수 있는 형태로 일괄 인출한다
 *   R54  최종 승인 없이 대외 산출물을 만들 수 없다
 *   R55  결과 → 계수 → 입력값 → 증빙 4단 역추적
 *   R61  임대 사업장 배분율은 환경(E) 물량에만 적용한다. 인원·근로시간에는 적용하지 않는다
 *   R38  "지금 고객사 요청이 오면 며칠 안에 답할 수 있는가"
 *   R56  2027년 보고서 발간 준비도 = 필수지표 확보율 × 대상연도
 *
 * 개인정보: 산출물·이력 어디에도 사람 이름이 없다. 승인자는 역할코드다 (R85)
 */

import { computeMonth, computeYear, latestFactorVersion } from './calc.js';
import { dueInPeriod, isValidPeriod } from './entry.js';

const EXPORT_SCOPES = new Set(['approver', 'admin']);

/** 공개등급 — 낮은 쪽이 더 넓게 공개된다 */
const DISCLOSURE_RANK = { public: 0, customer: 1, internal: 2 };

/**
 * 한 해를 채우는 데 필요한 입력 횟수.
 *
 * 데이터북에서 이것이 중요한 이유: 12개월 중 3개월만 입력된 항목을 "확보"로 표시하면
 * 보고서 집필자가 그 값을 연간 수치로 그대로 옮겨 쓴다. 3개월 합계가 연간 배출량으로
 * 공시되는 사고는 되돌릴 수 없다. 그래서 칸마다 몇 개월이 채워졌는지를 같이 내려준다.
 */
const DUE_PER_YEAR = { monthly: 12, quarterly: 4, annual: 1 };

export function reportScope(roleRows) {
  const scopes = new Set(roleRows.map((r) => r.scope));
  return { canSubmit: [...scopes].some((s) => EXPORT_SCOPES.has(s)) };
}

function monthsBetween(from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ey, em] = to.split('-').map(Number);
  while (y * 12 + m <= ey * 12 + em && out.length < 120) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

function round(n, d) { const p = 10 ** d; return Math.round(n * p) / p; }

/* ══════════════════════════════════════════════════════════
   S6 — 조회 (임의 구간 · 법인 · 드릴다운)
   ══════════════════════════════════════════════════════════ */

/**
 * 임의 구간 산출.
 *
 * 배출량·에너지는 calc.js 의 월별 산정을 그대로 돌려 합산한다 —
 * 조회 화면이 자기만의 계산식을 갖는 순간 두 화면의 숫자가 달라진다 (R4).
 * 물량 항목(용수·폐기물·대기)은 계수가 없으므로 여기서 합산한다.
 */
export async function loadQuery(env, { entityCodes, from, to, version }) {
  const periods = monthsBetween(from, to);
  if (periods.length === 0) return { error: 'invalid_range' };

  const ph = entityCodes.map(() => '?').join(',');
  const ents = await env.DB.prepare(
    `SELECT code, name_ko, grid_region, calc_standard FROM entity
      WHERE code IN (${ph}) AND is_active = 1 ORDER BY code`
  ).bind(...entityCodes).all();
  if (ents.results.length === 0) return { error: 'entity_not_found' };

  const perEntity = [];
  const group = { scope1: null, scope2: null, energy_tj: null, energy_toe: null };
  const unpriced = new Map();
  const factorsUsed = new Map();

  // null 은 "산정하지 못했다"이므로 0 처럼 더하지 않는다 (calc.js 와 같은 규칙)
  const add = (acc, key, v) => { if (v !== null) acc[key] = (acc[key] || 0) + v; };

  for (const e of ents.results) {
    const totals = { scope1: null, scope2: null, energy_tj: null, energy_toe: null };
    const months = [];
    for (const period of periods) {
      const c = await computeMonth(env, e.code, period, version);
      if (c.error || c.lines.length === 0) continue;
      add(totals, 'scope1', c.results.scope1);
      add(totals, 'scope2', c.results.scope2);
      add(totals, 'energy_tj', c.results.energy_tj);
      add(totals, 'energy_toe', c.results.energy_toe);
      months.push({ period, ...c.results });
      for (const u of c.unpriced) {
        unpriced.set(`${e.code}/${u.metric_code}`,
          { entity_code: e.code, metric_code: u.metric_code, name_ko: u.name_ko,
            factor_type: u.factor_type });
      }
      // R11 — 어떤 계수를 썼는지 화면에 항상 보인다
      for (const l of c.lines) {
        if (!l.emission_factor) continue;
        factorsUsed.set(`${l.metric_code}/${e.grid_region}`, {
          metric_code: l.metric_code, name_ko: l.name_ko, region: e.grid_region,
          value: l.emission_factor, year: l.emission_factor_year,
          source: l.emission_factor_source,
        });
      }
    }
    const rd = (v, d) => (v === null ? null : round(v, d));
    const r = {
      scope1: rd(totals.scope1, 3), scope2: rd(totals.scope2, 3),
      energy_tj: rd(totals.energy_tj, 4), energy_toe: rd(totals.energy_toe, 2),
    };
    perEntity.push({
      entity_code: e.code, name_ko: e.name_ko, grid_region: e.grid_region,
      calc_standard: e.calc_standard,
      ...r,
      scope12: r.scope1 === null && r.scope2 === null ? null
        : round((r.scope1 || 0) + (r.scope2 || 0), 3),
      partial: { scope1: r.scope1 === null, scope2: r.scope2 === null,
                 energy: r.energy_tj === null },
      months,
    });
    add(group, 'scope1', r.scope1);
    add(group, 'scope2', r.scope2);
    add(group, 'energy_tj', r.energy_tj);
    add(group, 'energy_toe', r.energy_toe);
  }

  // 물량 항목 — 계수가 없는 환경 지표(용수·폐기물·대기).
  // 단위환산·배분은 v_entry_alloc 이 이미 적용했다 (schema.sql 참조)
  const phP = periods.map(() => '?').join(',');
  const physRows = await env.DB.prepare(
    `SELECT entity_code, metric_code, name_ko, unit_standard, disclosure_level, gri_code,
            SUM(value_alloc) AS total,
            SUM(CASE WHEN status = 'unavailable' THEN 1 ELSE 0 END) AS unavailable_months,
            COUNT(*) AS months
       FROM v_entry_alloc
      WHERE entity_code IN (${ph}) AND period IN (${phP})
        AND category = 'E' AND factor_type IS NULL
      GROUP BY entity_code, metric_code
      ORDER BY sort_order`
  ).bind(...entityCodes, ...periods).all();

  const physical = new Map();
  for (const r of physRows.results) {
    if (!physical.has(r.metric_code)) {
      physical.set(r.metric_code, {
        metric_code: r.metric_code, name_ko: r.name_ko, unit: r.unit_standard,
        disclosure_level: r.disclosure_level, gri_code: r.gri_code,
        by_entity: {}, total: null, unavailable_months: 0, missing: [],
      });
    }
    const p = physical.get(r.metric_code);
    p.by_entity[r.entity_code] = r.total === null ? null : round(r.total, 3);
    if (r.total === null) p.missing.push(r.entity_code);
    // 값이 하나도 없으면 합계는 0 이 아니라 null 이다.
    // "0 톤 배출"과 "자료를 못 구했다"를 같은 칸에 쓰면 보고서에서 구별할 수 없다 (D-2)
    else p.total = round((p.total || 0) + r.total, 3);
    p.unavailable_months += r.unavailable_months;
  }

  // 조회 대상 법인 중 아예 행이 없는 법인도 미확보로 표시한다
  for (const p of physical.values()) {
    for (const e of ents.results) {
      if (p.by_entity[e.code] === undefined) {
        p.by_entity[e.code] = null;
        p.missing.push(e.code);
      }
    }
  }

  return {
    from, to, periods, version,
    entities: perEntity,
    group: {
      scope1: group.scope1 === null ? null : round(group.scope1, 3),
      scope2: group.scope2 === null ? null : round(group.scope2, 3),
      scope12: group.scope1 === null && group.scope2 === null ? null
        : round((group.scope1 || 0) + (group.scope2 || 0), 3),
      energy_tj: group.energy_tj === null ? null : round(group.energy_tj, 4),
      energy_toe: group.energy_toe === null ? null : round(group.energy_toe, 2),
      partial: { scope1: group.scope1 === null, scope2: group.scope2 === null,
                 energy: group.energy_tj === null },
    },
    physical: [...physical.values()],
    unpriced: [...unpriced.values()],
    factors_used: [...factorsUsed.values()],
  };
}

/**
 * 4단 드릴다운 — 결과 → 계수 → 입력값 → 증빙 (R55).
 * 한 항목·한 법인·한 기간의 모든 근거를 한 번에 돌려준다.
 */
export async function loadDrill(env, entityCode, period, metricCode, version) {
  const row = await env.DB.prepare(
    `SELECT e.id, e.entity_code, e.site_id, e.metric_code, e.period,
            e.value_raw, e.unit_raw, e.status, e.unavailable_reason_code,
            e.flag_anomaly, e.anomaly_pct, e.is_retro,
            e.entered_by_role, e.entered_at, e.approved_by_role, e.approved_at, e.closed_at,
            m.name_ko, m.unit_standard, m.definition_ko, m.disclosure_level,
            m.gri_code, m.kssb_code, m.factor_type, m.ghg_scope, m.evidence_policy,
            v.site_name, v.ownership, v.allocation_ratio, v.allocation_basis,
            v.to_standard, v.value_alloc,
            en.grid_region, en.calc_standard,
            COALESCE(o.unit_input, m.unit_standard) AS unit_input
       FROM entry e
       JOIN metric m ON m.code = e.metric_code
       JOIN v_entry_alloc v ON v.id = e.id
       JOIN entity en ON en.code = e.entity_code
       LEFT JOIN metric_unit_override o
              ON o.metric_code = e.metric_code AND o.entity_code = e.entity_code
      WHERE e.entity_code = ? AND e.metric_code = ? AND e.period = ?`
  ).bind(entityCode, metricCode, period).first();

  if (!row) return { error: 'entry_not_found' };

  const evidence = await env.DB.prepare(
    `SELECT r2_key, original_filename, content_type, byte_size, sha256,
            uploaded_by_role, uploaded_at
       FROM evidence WHERE entry_id = ? ORDER BY uploaded_at`
  ).bind(row.id).all();

  let factor = null;
  if (row.factor_type) {
    factor = await env.DB.prepare(
      `SELECT factor_type, purpose, region, year, value, unit, gwp_set, source,
              published_at, version
         FROM factor
        WHERE factor_type = ? AND purpose = 'emission' AND version = ?
          AND region IN (?, 'GLOBAL') AND year <= ?
        ORDER BY CASE WHEN region = ? THEN 0 ELSE 1 END, year DESC LIMIT 1`
    ).bind(row.factor_type, version, row.grid_region,
           Number(period.slice(0, 4)), row.grid_region).first();
  }

  const history = await env.DB.prepare(
    `SELECT field, old_value, new_value, changed_by_role, changed_at
       FROM audit_log WHERE table_name = 'entry' AND row_key = ?
      ORDER BY id DESC LIMIT 20`
  ).bind(String(row.id)).all();

  const standard = row.value_raw === null ? null : row.value_raw * row.to_standard;
  const ratio = row.allocation_ratio;
  const allocated = row.value_alloc;

  return {
    entity_code: entityCode, period, metric_code: metricCode, version,
    metric: {
      name_ko: row.name_ko, unit_standard: row.unit_standard, unit_input: row.unit_input,
      definition_ko: row.definition_ko, disclosure_level: row.disclosure_level,
      gri_code: row.gri_code, kssb_code: row.kssb_code,
      factor_type: row.factor_type, ghg_scope: row.ghg_scope,
      evidence_policy: row.evidence_policy,
    },
    entry: {
      value_raw: row.value_raw, unit_raw: row.unit_raw, status: row.status,
      unavailable_reason_code: row.unavailable_reason_code,
      flag_anomaly: row.flag_anomaly, anomaly_pct: row.anomaly_pct, is_retro: row.is_retro,
      entered_by_role: row.entered_by_role, entered_at: row.entered_at,
      approved_by_role: row.approved_by_role, approved_at: row.approved_at,
      closed_at: row.closed_at,
    },
    site: { name_ko: row.site_name, ownership: row.ownership,
            allocation_ratio: ratio, allocation_basis: row.allocation_basis },
    calc: {
      to_standard: row.to_standard, standard, allocation_ratio: ratio, allocated,
      calc_standard: row.calc_standard, grid_region: row.grid_region,
      tco2: factor && allocated !== null ? round(allocated * factor.value, 4) : null,
    },
    factor,
    evidence: evidence.results,
    history: history.results,
  };
}

/* ══════════════════════════════════════════════════════════
   S7 — 지표 데이터북 (다년 추이)
   ══════════════════════════════════════════════════════════ */

/**
 * 지표 × 연도 매트릭스.
 *
 * 각 칸은 값이 있거나, 없는 이유가 있다. **추정치 칸은 존재하지 않는다** (R43).
 *   available       값 확보
 *   partial         일부 법인만 확보
 *   unavailable     미확보 (사유 있음)
 *   empty           미입력
 *   not_applicable  이 법인에 해당 없음
 *
 * disclosure 를 주면 그 등급까지만 내려준다 (R40).
 *   'public'   → 대외공시 지표만
 *   'customer' → 대외공시 + 고객사제출
 *   미지정      → 전부 (내부 조회용)
 */
export async function loadDataBook(env, years, { disclosure, version, fxVersion } = {}) {
  const maxRank = disclosure ? DISCLOSURE_RANK[disclosure] : 2;
  if (maxRank === undefined) return { error: 'invalid_disclosure' };

  const entities = await env.DB.prepare(
    `SELECT code, name_ko FROM entity WHERE is_active = 1 ORDER BY code`
  ).all();
  const codes = entities.results.map((e) => e.code);

  const metrics = await env.DB.prepare(
    `SELECT code, category, name_ko, unit_standard, period_type, aggregation,
            definition_ko, disclosure_level, gri_code, kssb_code,
            is_calculated, calc_kind, numerator_codes, denominator_codes, sort_order
       FROM metric ORDER BY sort_order`
  ).all();
  const shown = metrics.results.filter(
    (m) => DISCLOSURE_RANK[m.disclosure_level] <= maxRank);

  // 담당 배정 — 해당 없음 판정용
  const assign = await env.DB.prepare(
    `SELECT metric_code, entity_code, is_applicable FROM metric_assignment`
  ).all();
  const applicable = new Map(
    assign.results.map((a) => [`${a.metric_code}|${a.entity_code}`, a.is_applicable]));

  // 연도별 산정 결과 (계산지표와 비율지표는 여기서 나온다)
  const byYear = {};
  for (const year of years) {
    byYear[year] = await computeYear(env, year, version, fxVersion);
  }

  // 원천 지표의 연간값과 입력 상태를 한 번에 읽는다.
  //
  // 지표마다 법인마다 따로 조회하면 49지표 × 3법인 × 2개년 = 294회가 된다.
  // Worker 한 번의 요청에서 그만큼 쿼리를 돌리면 느려지고 한도에 걸린다.
  //
  // eop_value 는 "그 연도의 가장 늦은 달의 값"이다. SQLite 는 집계 쿼리에
  // MAX() 가 하나만 있으면 같은 행의 다른 컬럼 값을 그 최댓값 행에서 가져온다
  // (문서화된 동작). 그래서 MAX(period) 와 value_raw 를 함께 뽑을 수 있다.
  const yearList = years.map(() => '?').join(' , ');
  const aggRows = await env.DB.prepare(
    `SELECT entity_code, metric_code, SUBSTR(period, 1, 4) AS year,
            SUM(value_alloc) AS sum_value,
            AVG(value_alloc) AS avg_value,
            MAX(period)      AS last_period,
            value_alloc      AS eop_value,
            COUNT(*)         AS filled_months
       FROM v_entry_alloc
      WHERE value_alloc IS NOT NULL AND SUBSTR(period, 1, 4) IN (${yearList})
      GROUP BY entity_code, metric_code, year`
  ).bind(...years.map(String)).all();
  const aggOf = new Map(
    aggRows.results.map((r) => [`${r.metric_code}|${r.entity_code}|${r.year}`, r]));

  const statusRows = await env.DB.prepare(
    `SELECT entity_code, metric_code, SUBSTR(period, 1, 4) AS year,
            SUM(CASE WHEN status = 'unavailable' THEN 1 ELSE 0 END) AS unavailable,
            COUNT(*) AS rows_seen
       FROM entry
      WHERE SUBSTR(period, 1, 4) IN (${yearList})
      GROUP BY entity_code, metric_code, year`
  ).bind(...years.map(String)).all();
  const statusOf = new Map(
    statusRows.results.map((r) => [`${r.metric_code}|${r.entity_code}|${r.year}`, r]));

  /** 원천 지표의 한 법인·한 연도 값. metric.aggregation 정의를 따른다 */
  const sourceAnnual = (metricCode, entityCode, year, aggregation) => {
    const a = aggOf.get(`${metricCode}|${entityCode}|${year}`);
    if (!a) return null;
    if (aggregation === 'avg') return a.avg_value;
    if (aggregation === 'eop') return a.eop_value;
    return a.sum_value;
  };

  const rows = [];
  for (const m of shown) {
    const cells = {};
    for (const year of years) {
      const Y = byYear[year];
      let value = null;
      const byEntity = {};

      if (m.is_calculated && m.calc_kind === 'ratio') {
        const g = (Y.ratios || []).find((r) => r.code === m.code);
        value = g ? g.value : null;
        for (const code of codes) {
          const one = ((Y.ratios_by_entity || {})[code] || []).find((r) => r.code === m.code);
          byEntity[code] = one ? one.value : null;
        }
      } else if (m.is_calculated) {
        let sum = 0; let any = false;
        for (const code of codes) {
          const e = (Y.entities || []).find((x) => x.entity_code === code);
          const v = e ? calcMetricOf(e, m.code) : null;
          byEntity[code] = v;
          if (v !== null) { sum += v; any = true; }
        }
        value = any ? round(sum, 4) : null;
      } else {
        let sum = 0; let any = false;
        for (const code of codes) {
          const v = sourceAnnual(m.code, code, String(year), m.aggregation);
          byEntity[code] = v === null || v === undefined ? null : round(v, 4);
          if (v !== null && v !== undefined) { sum += v; any = true; }
        }
        value = any ? round(sum, 4) : null;
      }

      cells[year] = { value, by_entity: byEntity, ...cellState(
        m, String(year), codes, byEntity, applicable, aggOf, statusOf) };
    }
    rows.push({
      code: m.code, category: m.category, name_ko: m.name_ko,
      unit: m.unit_standard, period_type: m.period_type, aggregation: m.aggregation,
      definition_ko: m.definition_ko, disclosure_level: m.disclosure_level,
      gri_code: m.gri_code, kssb_code: m.kssb_code,
      is_calculated: m.is_calculated, calc_kind: m.calc_kind,
      cells,
    });
  }

  return {
    years, disclosure: disclosure || 'all',
    version: byYear[years[0]] ? byYear[years[0]].version : version,
    fx_version: byYear[years[0]] ? byYear[years[0]].fx_version : null,
    entities: entities.results,
    rows,
    disclosure_warnings: derivedDisclosureWarnings(shown, metrics.results),
    counts: {
      total: rows.length,
      available: rows.filter((r) => years.every((y) => r.cells[y].state === 'available')).length,
    },
  };
}

/**
 * 산정 결과에서 계산지표 값을 꺼낸다.
 *
 * 입력이 한 달도 없는 해는 합계가 0 으로 나온다. 그 0 을 그대로 내려주면
 * 데이터북에 "2025년 배출량 0 tCO2eq (확보)"가 찍힌다. 확보한 적이 없는 값이다.
 * 산정한 달이 없으면 null 을 돌려준다 (R43).
 */
function calcMetricOf(entityResult, code) {
  if (!entityResult || !entityResult.months || entityResult.months.length === 0) return null;
  const map = {
    'E-C1': entityResult.energy_tj, 'E-C2': entityResult.energy_toe,
    'E-C3': entityResult.scope1, 'E-C4': entityResult.scope2,
  };
  return map[code] === undefined ? null : map[code];
}

/**
 * 한 칸의 상태와 커버리지.
 *
 *   available       해당 법인 전부가 그 해의 모든 수집 시점을 채웠다
 *   partial         일부 법인만, 또는 일부 개월만 채웠다 — 연간값으로 쓸 수 없다
 *   unavailable     미확보 (사유가 기록되어 있다)
 *   empty           미입력
 *   not_applicable  이 지표가 해당되는 법인이 없다
 *   derived         계산지표 — 원천 항목의 확보 상태를 따른다
 *
 * 추정 상태는 없다. 값이 없으면 없는 이유가 있을 뿐이다 (R43).
 */
function cellState(m, year, codes, byEntity, applicable, aggOf, statusOf) {
  if (m.is_calculated) {
    // 계산지표는 사람이 넣지 않으므로 "미입력"이라는 말이 성립하지 않는다.
    // 값이 없으면 원천 항목이나 계수가 부족해 산정하지 못한 것이다
    const has = codes.some((c) => byEntity[c] !== null && byEntity[c] !== undefined);
    return { state: has ? 'derived' : 'not_computed', coverage: null };
  }

  const live = codes.filter((c) => applicable.get(`${m.code}|${c}`) !== 0);
  if (live.length === 0) return { state: 'not_applicable', coverage: null };

  const due = DUE_PER_YEAR[m.period_type] || 12;
  let minCovered = due;
  let withValue = 0;
  let unavailable = 0;

  for (const c of live) {
    const a = aggOf.get(`${m.code}|${c}|${year}`);
    const st = statusOf.get(`${m.code}|${c}|${year}`);
    const filled = a ? a.filled_months : 0;
    const unav = st ? st.unavailable : 0;
    // 미확보도 "확인이 끝난 칸"이므로 커버리지에 포함한다. 남은 것은 미입력뿐이다 (D-2)
    minCovered = Math.min(minCovered, filled + unav);
    if (filled > 0) withValue += 1;
    if (unav > 0) unavailable += 1;
  }

  const coverage = { filled: minCovered, due, complete: minCovered >= due,
                     entities: live.length };

  if (withValue === 0) {
    return { state: unavailable > 0 ? 'unavailable' : 'empty', coverage };
  }
  if (withValue === live.length && coverage.complete) {
    return { state: 'available', coverage };
  }
  return { state: 'partial', coverage };
}

/**
 * 파생 공개등급 점검 (R39 / R40).
 *
 * 비율지표가 대외공시인데 분모가 내부전용이면, 그 비율을 공개하는 것만으로
 * 분모를 역산할 수 있다.  분모 = 분자 ÷ 비율.
 * 예: 배출 집약도(공개)와 배출량(공개)을 같이 내면 매출액(내부전용)이 계산된다.
 *
 * 막지 않고 경고한다 — 상장사 매출액처럼 이미 공개된 값이면 문제가 아니고,
 * 그 판단은 사람이 해야 한다. 다만 모르고 내보내는 일은 없어야 한다.
 */
function derivedDisclosureWarnings(shown, allMetrics) {
  const levelOf = new Map(allMetrics.map((m) => [m.code, m.disclosure_level]));
  const nameOf = new Map(allMetrics.map((m) => [m.code, m.name_ko]));
  const out = [];
  for (const m of shown) {
    if (m.calc_kind !== 'ratio') continue;
    const sources = [m.numerator_codes, m.denominator_codes]
      .filter(Boolean).join(',').split(',').map((x) => x.trim()).filter(Boolean);
    const stricter = [...new Set(sources)].filter(
      (c) => DISCLOSURE_RANK[levelOf.get(c)] > DISCLOSURE_RANK[m.disclosure_level]);
    if (stricter.length === 0) continue;
    out.push({
      code: m.code, name_ko: m.name_ko, disclosure_level: m.disclosure_level,
      sources: stricter.map((c) => ({ code: c, name_ko: nameOf.get(c),
                                      disclosure_level: levelOf.get(c) })),
    });
  }
  return out;
}

/* ── CSV 인출 (R46) ────────────────────────────────────────── */

const STATE_KO = {
  available: '확보', partial: '일부 확보', unavailable: '미확보',
  empty: '미입력', not_applicable: '해당 없음', derived: '산출값',
  not_computed: '산정 불가',
};

/** "3/12개월" — 칸의 값이 한 해를 대표하는지 한눈에 보이게 한다 */
function coverageText(c) {
  if (!c) return '';
  const unit = c.due === 12 ? '개월' : c.due === 4 ? '분기' : '회';
  return `${c.filled}/${c.due}${unit}` + (c.complete ? '' : ' (연간값 아님)');
}
const DISC_KO = { internal: '내부전용', customer: '고객사제출', public: '대외공시' };

/** CSV 한 칸. 엑셀에서 수식으로 해석되는 문자로 시작하면 앞에 따옴표를 붙인다 */
function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * 데이터북을 CSV 로 만든다.
 *
 * 엑셀 라이브러리를 쓰지 않는다 — 빌드 단계를 만들지 않기 위한 선택이고(EP8 원칙 2),
 * CSV 는 6개월 뒤에도 무엇이든 열 수 있다. UTF-8 BOM 을 붙여 한글이 깨지지 않게 한다.
 */
export function dataBookCsv(book) {
  const years = book.years;
  const head = [
    '지표코드', '구분', '지표명', '단위', '수집주기', '집계방식', '공개등급',
    'GRI', 'KSSB/IFRS',
    ...years.flatMap((y) => [`${y} 값`, `${y} 상태`, `${y} 확보기간`]),
    ...years.flatMap((y) => book.entities.map((e) => `${y} ${e.name_ko}`)),
    '산정정의',
  ];
  const lines = [head.map(csvCell).join(',')];

  for (const r of book.rows) {
    const cat = r.category === 'E' ? '환경' : r.category === 'S' ? '사회'
      : r.category === 'PROD' ? '생산' : r.category;
    const row = [
      r.code, cat, r.name_ko, r.unit, r.period_type, r.aggregation,
      DISC_KO[r.disclosure_level] || r.disclosure_level,
      r.gri_code, r.kssb_code,
      ...years.flatMap((y) => [
        r.cells[y].value,
        STATE_KO[r.cells[y].state] || r.cells[y].state,
        coverageText(r.cells[y].coverage),
      ]),
      ...years.flatMap((y) => book.entities.map((e) => r.cells[y].by_entity[e.code])),
      r.definition_ko,
    ];
    lines.push(row.map(csvCell).join(','));
  }

  // 인출 조건을 파일 안에 남긴다. 파일만 보고도 무엇을 뽑은 것인지 알 수 있어야 한다 (R11)
  lines.push('');
  lines.push(csvCell(`# 인출 조건: 연도 ${years.join(' · ')} · 공개등급 ${
    book.disclosure === 'all' ? '전체(내부용)' : DISC_KO[book.disclosure]}`));
  lines.push(csvCell(`# 적용 배출계수 버전: ${book.version || '-'}`
    + ` · 적용 환율 버전: ${book.fx_version || '미등록'}`));
  lines.push(csvCell('# 빈 칸은 확보하지 못한 값이다. 추정치로 채우지 않는다.'));
  lines.push(csvCell('# "확보기간"이 12/12개월이 아닌 값은 연간 수치가 아니다. 그대로 공시하지 말 것.'));
  lines.push(csvCell('# "산출값"은 계산지표다. 원천 항목의 확보 상태를 함께 확인할 것.'));
  for (const w of (book.disclosure_warnings || [])) {
    lines.push(csvCell(`# ⚠ ${w.code} ${w.name_ko}(${DISC_KO[w.disclosure_level]})의 분모에 `
      + `${w.sources.map((x) => `${x.code} ${x.name_ko}(${DISC_KO[x.disclosure_level]})`).join(' · ')}`
      + ` 가 쓰인다. 이 비율을 공개하면 분모를 역산할 수 있다.`));
  }
  lines.push(csvCell(`# 생성 시각(UTC): ${new Date().toISOString()}`));

  return '﻿' + lines.join('\r\n') + '\r\n';
}

/* ══════════════════════════════════════════════════════════
   S8 — 제출 이력
   ══════════════════════════════════════════════════════════ */

const PURPOSES = new Set(['customer', 'regulatory', 'report', 'internal']);

/**
 * 제출 이력 기록 (EP1 결손 1 — "3월에 뭘 냈는가"에 답한다).
 *
 * 산출물 파일을 R2 에 그대로 보관하고 키를 이력에 남긴다.
 * 나중에 "그때 낸 그 파일"을 다시 꺼낼 수 있어야 제출 이력이 의미가 있다.
 */
export async function createSubmission(env, body, report, actor) {
  if (!report.canSubmit) {
    return { status: 403, body: { error: 'forbidden',
      hint: '대외 산출물 생성은 파트장(승인자)·시스템 관리자만 할 수 있습니다 (R54).' } };
  }
  const { submitted_to, purpose, period_from, period_to, years, disclosure } = body || {};
  if (!submitted_to || !PURPOSES.has(purpose)) {
    return { status: 400, body: { error: 'invalid_params',
      allowed_purpose: [...PURPOSES] } };
  }
  if (!isValidPeriod(period_from || '') || !isValidPeriod(period_to || '')) {
    return { status: 400, body: { error: 'invalid_period' } };
  }
  if (!Array.isArray(years) || years.length === 0) {
    return { status: 400, body: { error: 'years_required' } };
  }

  const version = body.factor_version || await latestFactorVersion(env);
  if (!version) return { status: 409, body: { error: 'no_factors' } };

  // 공개등급은 여기서 강제된다. 화면이 무엇을 보냈든 대외 제출이면 필터가 걸린다 (R40)
  const level = purpose === 'internal' ? (disclosure || null)
    : purpose === 'customer' ? 'customer' : 'public';

  const book = await loadDataBook(env, years.map(Number), { disclosure: level, version });
  if (book.error) return { status: 400, body: book };

  const csv = dataBookCsv(book);
  const now = new Date().toISOString();
  const stamp = now.replace(/[:.]/g, '-');
  const key = `submission/${purpose}/${stamp}-${years.join('_')}.csv`;

  await env.EVIDENCE.put(key, csv, {
    httpMetadata: { contentType: 'text/csv; charset=utf-8' },
    customMetadata: { purpose, submitted_to, factor_version: version,
                      approved_by_role: actor || 'unknown' },
  });

  await env.DB.prepare(
    `INSERT INTO submission (submitted_to, purpose, period_from, period_to,
                             output_r2_key, factor_version, fx_version,
                             approved_by_role, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(submitted_to, purpose, period_from, period_to, key, version,
         book.fx_version || null, actor, now).run();

  return { status: 200, body: {
    ok: true, submitted_to, purpose, years,
    disclosure: level || 'all',
    metrics: book.rows.length,
    factor_version: version, fx_version: book.fx_version || null,
    output_r2_key: key, bytes: csv.length,
    approved_by_role: actor, submitted_at: now,
  } };
}

export async function listSubmissions(env) {
  const rows = await env.DB.prepare(
    `SELECT id, submitted_to, purpose, period_from, period_to, output_r2_key,
            factor_version, fx_version, approved_by_role, submitted_at
       FROM submission ORDER BY submitted_at DESC LIMIT 100`
  ).all();
  return { items: rows.results };
}

/** 제출한 그 파일을 그대로 다시 꺼낸다 */
export async function fetchSubmissionFile(env, key) {
  if (!key.startsWith('submission/')) return { status: 403 };
  const obj = await env.EVIDENCE.get(key);
  if (!obj) return { status: 404 };
  return { status: 200, stream: obj.body, headers: {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="${key.split('/').pop()}"`,
    'cache-control': 'no-store',
  } };
}

/* ══════════════════════════════════════════════════════════
   S9 — 경영진 화면 (1페이지)
   ══════════════════════════════════════════════════════════ */

/**
 * 경영진이 볼 세 가지만 만든다 (R37 — 그래프를 늘리지 않는다).
 *
 *   1. 지금 고객사 요청이 오면 며칠 안에 답할 수 있는가 (R38)
 *   2. 2027년 보고서 발간 준비도 (R56)
 *   3. 3법인 당월 입력 완료율
 */
export async function loadReadiness(env, { reportYears, period, version }) {
  const entities = await env.DB.prepare(
    `SELECT code, name_ko FROM entity WHERE is_active = 1 ORDER BY code`
  ).all();
  const codes = entities.results.map((e) => e.code);
  const ph = codes.map(() => '?').join(',');

  /* ── 1. 답변 소요 (R38) ───────────────────────────────────
     확정(closed)된 가장 늦은 달까지는 그대로 제출할 수 있다.
     그 뒤 기간은 승인·입력이 남은 만큼 시간이 든다.
     날짜를 추측해 적지 않고, 무엇이 남았는지를 건수로 보여준다. */
  const closed = await env.DB.prepare(
    `SELECT entity_code, MAX(period) AS last_closed FROM entry
      WHERE closed_at IS NOT NULL AND entity_code IN (${ph})
      GROUP BY entity_code`
  ).bind(...codes).all();
  const lastClosed = new Map(closed.results.map((r) => [r.entity_code, r.last_closed]));

  const pending = await env.DB.prepare(
    `SELECT entity_code,
            SUM(CASE WHEN status IN ('entered','returned') AND approved_at IS NULL
                     THEN 1 ELSE 0 END) AS awaiting_approval,
            SUM(CASE WHEN status = 'unavailable' AND approved_at IS NULL
                     THEN 1 ELSE 0 END) AS awaiting_reason_review
       FROM entry WHERE entity_code IN (${ph}) GROUP BY entity_code`
  ).bind(...codes).all();
  const pendingOf = new Map(pending.results.map((r) => [r.entity_code, r]));

  // 3법인이 모두 확정한 가장 늦은 달 = 지금 그대로 낼 수 있는 기준월
  const closedList = codes.map((c) => lastClosed.get(c) || null);
  const answerable = closedList.every(Boolean)
    ? closedList.reduce((a, b) => (a < b ? a : b))
    : null;

  /* ── 2. 보고서 발간 준비도 (R56) ─────────────────────────
     필수지표 = 대외공시(public) 등급 지표.
     준비도 = (확보된 지표·연도 칸) / (전체 지표·연도 칸) */
  const book = await loadDataBook(env, reportYears, { disclosure: 'public', version });
  let cells = 0, got = 0, partial = 0, na = 0;
  const gaps = [];
  for (const r of book.rows) {
    for (const y of reportYears) {
      const st = r.cells[y].state;
      if (st === 'not_applicable') { na += 1; continue; }
      cells += 1;
      if (st === 'available') got += 1;
      else if (st === 'partial') { partial += 1; gaps.push({ code: r.code, name_ko: r.name_ko, year: y, state: st }); }
      else gaps.push({ code: r.code, name_ko: r.name_ko, year: y, state: st });
    }
  }
  const readiness = cells === 0 ? null : Math.round(((got + partial * 0.5) / cells) * 1000) / 10;
  const notStarted = cells - got - partial;

  /* ── 3. 당월 입력 완료율 ─────────────────────────────────── */
  const expected = await env.DB.prepare(
    `SELECT entity_code, metric_code, period_type FROM v_expected_entry
      WHERE entity_code IN (${ph}) AND active_from <= ?
        AND (active_to IS NULL OR active_to >= ?)`
  ).bind(...codes, period, period).all();
  const filled = await env.DB.prepare(
    `SELECT entity_code, metric_code FROM entry
      WHERE entity_code IN (${ph}) AND period = ? AND status <> 'empty'`
  ).bind(...codes, period).all();
  const filledSet = new Set(filled.results.map((r) => `${r.entity_code}|${r.metric_code}`));

  const monthly = {};
  for (const code of codes) monthly[code] = { expected: 0, filled: 0 };
  for (const e of expected.results) {
    if (!dueInPeriod(e.period_type, period)) continue;
    monthly[e.entity_code].expected += 1;
    if (filledSet.has(`${e.entity_code}|${e.metric_code}`)) monthly[e.entity_code].filled += 1;
  }

  const lights = entities.results.map((e) => {
    const m = monthly[e.code];
    const p = pendingOf.get(e.code) || { awaiting_approval: 0, awaiting_reason_review: 0 };
    const pct = m.expected ? Math.round((m.filled / m.expected) * 1000) / 10 : null;
    // 신호등 — 세 단계뿐이다. 경영진 화면에 5단계 색을 두면 아무도 기억하지 못한다
    const light = pct === null ? 'gray'
      : pct >= 100 ? (p.awaiting_approval === 0 ? 'green' : 'amber')
      : pct >= 70 ? 'amber' : 'red';
    return {
      entity_code: e.code, name_ko: e.name_ko,
      last_closed: lastClosed.get(e.code) || null,
      month_expected: m.expected, month_filled: m.filled, month_pct: pct,
      awaiting_approval: p.awaiting_approval,
      awaiting_reason_review: p.awaiting_reason_review,
      light,
    };
  });

  return {
    period, report_years: reportYears, version: book.version,
    answer: {
      // 지금 그대로 제출할 수 있는 최신 기준월 (3법인 공통)
      answerable_through: answerable,
      not_closed: codes.filter((c) => !lastClosed.get(c)),
      awaiting_approval: lights.reduce((a, l) => a + l.awaiting_approval, 0),
      awaiting_reason_review: lights.reduce((a, l) => a + l.awaiting_reason_review, 0),
    },
    readiness: {
      pct: readiness, cells, available: got, partial, not_started: notStarted,
      not_applicable: na,
      metrics: book.rows.length,
      gaps: gaps.slice(0, 20), gap_total: gaps.length,
    },
    entities: lights,
  };
}

/* ── 마감 독촉 문구 (R16) ──────────────────────────────────── */

/**
 * 미입력 항목을 담당 역할별로 묶어 붙여넣을 수 있는 문구로 만든다.
 *
 * 메일·메신저 발송은 외부 서비스 계약이 필요하므로 1차 범위에서 제외했다.
 * 대신 "누구에게 무엇을 요청해야 하는지"를 문장으로 만들어준다 — 10명 규모에서는
 * 이것이 자동발송보다 빠르고, 유지보수할 것이 없다.
 */
export async function loadDigest(env, period) {
  const expected = await env.DB.prepare(
    `SELECT entity_code, metric_code, name_ko, unit_input, owner_role, backup_role, period_type
       FROM v_expected_entry
      WHERE active_from <= ? AND (active_to IS NULL OR active_to >= ?)
      ORDER BY entity_code, sort_order`
  ).bind(period, period).all();

  const rows = await env.DB.prepare(
    `SELECT entity_code, metric_code, status FROM entry WHERE period = ?`
  ).bind(period).all();
  const statusOf = new Map(rows.results.map((r) => [`${r.entity_code}|${r.metric_code}`, r.status]));

  const entities = await env.DB.prepare(
    `SELECT code, name_ko FROM entity WHERE is_active = 1`
  ).all();
  const nameOf = new Map(entities.results.map((e) => [e.code, e.name_ko]));

  const byRole = new Map();
  for (const e of expected.results) {
    if (!dueInPeriod(e.period_type, period)) continue;
    const st = statusOf.get(`${e.entity_code}|${e.metric_code}`);
    if (st && st !== 'empty') continue;
    const key = `${e.entity_code}|${e.owner_role}`;
    if (!byRole.has(key)) {
      byRole.set(key, { entity_code: e.entity_code, entity_name: nameOf.get(e.entity_code),
                        owner_role: e.owner_role, backup_role: e.backup_role, items: [] });
    }
    byRole.get(key).items.push({ metric_code: e.metric_code, name_ko: e.name_ko,
                                 unit: e.unit_input });
  }

  const groups = [...byRole.values()].sort((a, b) => b.items.length - a.items.length);
  const text = groups.map((g) =>
    `[${g.entity_name} · ${g.owner_role}] ${period} 미입력 ${g.items.length}건\n`
    + g.items.map((i) => `  - ${i.name_ko} (${i.metric_code}, ${i.unit})`).join('\n')
  ).join('\n\n');

  return {
    period,
    total_missing: groups.reduce((a, g) => a + g.items.length, 0),
    groups,
    text: text || `${period} 미입력 항목이 없습니다.`,
  };
}
