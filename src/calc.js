/**
 * 배출량 · 에너지 산정
 *
 * 이 파일이 지키는 규칙
 *   R4        산정 로직은 코드에 고정되고 동일 입력에는 항상 동일 결과가 나온다
 *   R11 / D-3 적용 계수 버전을 결과에 스냅샷으로 남긴다. 계수가 개정돼도 과거 산출물이 재현된다
 *   R64       비율·집약도는 분자·분모를 각각 합산한 뒤 재계산한다.
 *             "3법인 이직률의 평균"을 만들지 않는다
 *   R61       임대 사업장은 배분율을 적용하고, 그 사실을 결과에 명시한다
 *   R73       지표 코드·계수값을 이 파일에 하드코딩하지 않는다.
 *             무엇을 어떤 계수로 계산할지는 전부 마스터(metric · factor)가 결정한다
 *
 * 계수가 없는 항목은 0 으로 취급하지 않는다. "미산정"으로 분리해 반환한다.
 * 0 으로 처리하면 배출량이 실제보다 작게 나오고, 그 사실이 보이지 않는다.
 */

/** 1 TOE = 41.868 GJ */
const GJ_PER_TOE = 41.868;

/* ── 계수 ──────────────────────────────────────────────────── */

/**
 * 계수 목록을 한 번에 읽어 메모리에서 고른다.
 * 항목마다 쿼리하면 월 30항목 × 3법인에 90번 조회가 된다.
 */
export async function loadFactorSet(env, version) {
  const rows = await env.DB.prepare(
    `SELECT factor_type, purpose, region, year, value, unit, gwp_set, source, published_at
       FROM factor WHERE version = ? ORDER BY year DESC`
  ).bind(version).all();
  return rows.results;
}

/**
 * 대상 연도에 적용할 계수를 고른다.
 * 계수는 통상 1~2년 뒤늦게 고시되므로 "적용 연도 ≤ 대상 연도" 중 가장 최신을 쓴다.
 * 지역 계수가 없으면 GLOBAL 로 보완한다(전력 순발열량처럼 국가 차이가 없는 값).
 */
export function pickFactor(factorSet, factorType, purpose, region, targetYear) {
  const match = (r) => r.factor_type === factorType && r.purpose === purpose && r.year <= targetYear;
  const regional = factorSet.filter((r) => match(r) && r.region === region);
  if (regional.length) return regional[0];
  const global = factorSet.filter((r) => match(r) && r.region === 'GLOBAL');
  return global.length ? global[0] : null;
}

/* ── 월별 산정 ─────────────────────────────────────────────── */

/**
 * 한 법인·한 기간의 배출량과 에너지 사용량을 산출한다.
 *
 * 반환
 *   results   { scope1, scope2, energy_tj, energy_toe } — 산출값
 *   lines     항목별 계산 내역. 화면에서 역추적(R55)에 쓴다
 *   unpriced  계수가 없어 산정하지 못한 항목
 *   excluded  값이 없거나 미확보인 항목
 */
export async function computeMonth(env, entityCode, period, version) {
  const entity = await env.DB.prepare(
    `SELECT code, grid_region FROM entity WHERE code = ?`
  ).bind(entityCode).first();
  if (!entity) return { error: 'entity_not_found' };

  const targetYear = Number(period.slice(0, 4));
  const factorSet = await loadFactorSet(env, version);
  if (factorSet.length === 0) {
    return { error: 'no_factors',
      hint: `계수 버전 ${version} 이 등록되지 않았습니다. 기준정보 → 배출계수에서 등록하세요.` };
  }

  // 사용량 — 단위환산·배분 규칙은 v_entry_alloc 한 곳에만 있다 (schema.sql 참조)
  const rows = await env.DB.prepare(
    `SELECT metric_code, site_id, status, value_raw, name_ko, factor_type, ghg_scope,
            unit_standard, to_standard, allocation_ratio, value_alloc,
            site_name, ownership, allocation_basis
       FROM v_entry_alloc
      WHERE entity_code = ? AND period = ? AND factor_type IS NOT NULL
      ORDER BY sort_order`
  ).bind(entityCode, period).all();

  const totals = { scope1: 0, scope2: 0, energy_tj: 0 };
  // 계수가 있어서 실제로 합산에 기여한 항목 수.
  // 이게 0 이면 그 스코프는 "0" 이 아니라 "산정하지 못했다" 이다.
  // 0 으로 내려주면 화면과 보고서에 "직접배출 없음"으로 찍힌다 — 확인한 적 없는 사실이다.
  const priced = { scope1: 0, scope2: 0, energy: 0 };
  const lines = [];
  const unpriced = [];
  const excluded = [];
  let pendingApproval = 0;

  for (const r of rows.results) {
    if (r.value_raw === null) {
      excluded.push({ metric_code: r.metric_code, name_ko: r.name_ko, reason: r.status });
      continue;
    }
    if (r.status === 'entered' || r.status === 'returned') pendingApproval += 1;

    // 원본 → 표준단위 → 임대 배분 (R61). 뷰가 계산한 값을 그대로 쓴다
    const standard = r.value_raw * r.to_standard;
    const allocated = r.value_alloc;

    const emission = pickFactor(factorSet, r.factor_type, 'emission', entity.grid_region, targetYear);
    const heating = pickFactor(factorSet, r.factor_type, 'heating_value', entity.grid_region, targetYear);

    if (!emission && !heating) {
      unpriced.push({
        metric_code: r.metric_code, name_ko: r.name_ko,
        factor_type: r.factor_type, value: allocated, unit: r.unit_standard,
      });
      continue;
    }

    const line = {
      metric_code: r.metric_code, name_ko: r.name_ko,
      site_id: r.site_id, site_name: r.site_name,
      value_raw: r.value_raw, to_standard: r.to_standard,
      standard, unit_standard: r.unit_standard,
      allocation_ratio: r.allocation_ratio,
      allocation_basis: r.ownership === 'leased' ? r.allocation_basis : null,
      allocated,
      ghg_scope: r.ghg_scope,
      status: r.status,
    };

    if (emission && r.ghg_scope) {
      const tco2 = allocated * emission.value;
      const key = r.ghg_scope === 1 ? 'scope1' : 'scope2';
      totals[key] += tco2;
      priced[key] += 1;
      line.emission_factor = emission.value;
      line.emission_factor_year = emission.year;
      line.emission_factor_source = emission.source;
      line.tco2 = tco2;
    } else if (r.ghg_scope) {
      unpriced.push({
        metric_code: r.metric_code, name_ko: r.name_ko,
        factor_type: r.factor_type, value: allocated, unit: r.unit_standard,
        missing: 'emission',
      });
    }

    if (heating) {
      const tj = allocated * heating.value;
      totals.energy_tj += tj;
      priced.energy += 1;
      line.heating_factor = heating.value;
      line.energy_tj = tj;
    }

    lines.push(line);
  }

  // 산정하지 못한 스코프는 null 이다. 합계는 산정된 부분만 더하고, 그 사실을 partial 로 알린다
  const s1 = priced.scope1 > 0 ? round(totals.scope1, 4) : null;
  const s2 = priced.scope2 > 0 ? round(totals.scope2, 4) : null;
  const tj = priced.energy > 0 ? round(totals.energy_tj, 6) : null;
  const results = {
    scope1: s1,
    scope2: s2,
    scope12: s1 === null && s2 === null ? null : round((s1 || 0) + (s2 || 0), 4),
    energy_tj: tj,
    energy_toe: tj === null ? null : round((tj * 1000) / GJ_PER_TOE, 3),
    // 이 합계에 빠진 것이 있는지 — 화면이 "(Scope 1 미산정 제외)" 를 붙일 근거
    partial: { scope1: s1 === null, scope2: s2 === null, energy: tj === null },
  };

  return {
    entity_code: entityCode, period, version,
    grid_region: entity.grid_region,
    target_year: targetYear,
    results, lines, unpriced, excluded,
    pending_approval: pendingApproval,
  };
}

function round(n, digits) {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

/**
 * 유효숫자 기준 반올림.
 * 집약도는 0.000136 처럼 작고 이직률은 5.15 처럼 크다. 소수점 자릿수를 고정하면
 * 한쪽이 0 으로 뭉개진다. 표시 형식은 화면이 정하고, 여기서는 정보를 잃지 않게만 자른다.
 */
function roundSig(n, digits) {
  if (n === 0 || !Number.isFinite(n)) return n;
  const mag = Math.ceil(Math.log10(Math.abs(n)));
  const p = 10 ** (digits - mag);
  return Math.round(n * p) / p;
}

/**
 * 산정 결과를 저장한다. 같은 계수 버전으로 다시 돌리면 갱신, 버전이 다르면 별도 행 (D-3)
 *
 * ⚠️ UNIQUE 제약에 의존하지 않고 삭제 후 삽입한다.
 *    calc_result.site_id 는 법인 합산일 때 NULL 이고, SQLite 는 UNIQUE 안의 NULL 을
 *    서로 다른 값으로 취급한다. 따라서 ON CONFLICT 가 걸리지 않아 재산정할 때마다
 *    행이 쌓이고 연간 SUM 이 중복 집계된다.
 *    calc_result 는 원본이 아니라 언제든 다시 만들 수 있는 산출물이므로
 *    삭제 금지 원칙(D-4)의 대상이 아니다. 원본은 entry 에 그대로 있다.
 */
export async function saveMonthResult(env, computed) {
  const { entity_code, period, version, results } = computed;
  const now = new Date().toISOString();
  const map = {
    'E-C3': results.scope1,
    'E-C4': results.scope2,
    'E-C1': results.energy_tj,
    'E-C2': results.energy_toe,
  };
  for (const [metricCode, value] of Object.entries(map)) {
    await env.DB.prepare(
      `DELETE FROM calc_result
        WHERE entity_code = ? AND site_id IS NULL AND period = ?
          AND result_metric = ? AND factor_version = ?`
    ).bind(entity_code, period, metricCode, version).run();
    await env.DB.prepare(
      `INSERT INTO calc_result (entity_code, site_id, period, result_metric, value,
                                factor_version, calculated_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?)`
    ).bind(entity_code, period, metricCode, value, version, now).run();
  }
  return Object.keys(map).length;
}

/**
 * 적용할 계수 버전. 명시하지 않으면 가장 최근 등록 버전을 쓴다.
 * 계수 버전을 코드에 하드코딩하지 않기 위한 함수다 (R73).
 */
export async function latestFactorVersion(env) {
  const r = await env.DB.prepare(
    `SELECT version FROM factor GROUP BY version ORDER BY MAX(published_at) DESC, version DESC LIMIT 1`
  ).first();
  return r ? r.version : null;
}

/* ── 환율 (R65) ────────────────────────────────────────────── */

/**
 * 금액 지표의 단위 접두어.
 * 매출액 등은 법인별 현지통화로 입력받으므로(P-5), 법인을 합산하기 전에
 * 반드시 원화로 환산해야 한다. 지표코드를 하드코딩하지 않고 마스터의 단위로 판별한다 (R73).
 */
const CURRENCY_UNIT_PREFIX = '현지통화';

export async function latestFxVersion(env) {
  const r = await env.DB.prepare(
    `SELECT version FROM fx_rate GROUP BY version ORDER BY MAX(year) DESC, version DESC LIMIT 1`
  ).first();
  return r ? r.version : null;
}

/** 연평균 환율 (KRW 기준). 원화는 항상 1 이다 */
export async function loadFxRates(env, year, fxVersion) {
  const map = new Map([['KRW', 1.0]]);
  if (!fxVersion) return map;
  const rows = await env.DB.prepare(
    `SELECT currency, rate_avg FROM fx_rate WHERE year = ? AND version = ?`
  ).bind(year, fxVersion).all();
  for (const r of rows.results) map.set(r.currency, r.rate_avg);
  return map;
}

/* ── 연간 집계 ─────────────────────────────────────────────── */

/**
 * 한 지표의 연간값.
 * 원천 지표는 metric.aggregation 에 따라, 계산지표는 월별 산정 결과의 합으로 구한다.
 *   sum → 12개월 합 · avg → 평균 · eop → 기말(12월) 값
 */
export async function annualValue(env, entityCode, year, metricCode, version) {
  const m = await env.DB.prepare(
    `SELECT code, aggregation, is_calculated, period_type FROM metric WHERE code = ?`
  ).bind(metricCode).first();
  if (!m) return null;

  if (m.is_calculated) {
    const r = await env.DB.prepare(
      `SELECT SUM(value) AS total FROM calc_result
        WHERE entity_code = ? AND site_id IS NULL AND result_metric = ?
          AND factor_version = ? AND period LIKE ?`
    ).bind(entityCode, metricCode, version, `${year}-%`).first();
    return r && r.total !== null ? r.total : null;
  }

  // 원천 지표는 v_entry_alloc.value_alloc 을 쓴다 — 단위환산과 배분이 적용된 값이다.
  // value_raw 를 그대로 더하면 심양 전력(万kWh)과 본사 전력(kWh)이 섞여 합산된다.
  if (m.aggregation === 'eop') {
    // 기말값 — 그 연도의 가장 늦은 달
    const r = await env.DB.prepare(
      `SELECT value_alloc FROM v_entry_alloc
        WHERE entity_code = ? AND metric_code = ? AND period LIKE ? AND value_alloc IS NOT NULL
        ORDER BY period DESC LIMIT 1`
    ).bind(entityCode, metricCode, `${year}-%`).first();
    return r ? r.value_alloc : null;
  }

  const agg = m.aggregation === 'avg' ? 'AVG(value_alloc)' : 'SUM(value_alloc)';
  const r = await env.DB.prepare(
    `SELECT ${agg} AS v FROM v_entry_alloc
      WHERE entity_code = ? AND metric_code = ? AND period LIKE ? AND value_alloc IS NOT NULL`
  ).bind(entityCode, metricCode, `${year}-%`).first();
  return r && r.v !== null ? r.v : null;
}

/**
 * 비율·집약도 지표 (R64).
 *
 *   값 = (Σ numerator_codes) / (Σ denominator_codes) × multiplier
 *
 * 분자·분모를 각각 합산한 뒤 나눈다. 법인 합산도 같은 방식이므로
 * "3법인 이직률의 평균 ≠ 그룹 이직률" 문제가 발생하지 않는다.
 *
 * entityCodes 에 여러 법인을 주면 그룹 값이 된다.
 */
export async function computeRatios(env, entityCodes, year, version, fxVersion, calcAnnual) {
  const defs = await env.DB.prepare(
    `SELECT code, name_ko, unit_standard, numerator_codes, denominator_codes, multiplier
       FROM v_ratio_metric ORDER BY code`
  ).all();
  if (defs.results.length === 0) return [];

  // 금액 지표 판별용 단위 + 법인 통화 + 환율
  const ph = entityCodes.map(() => '?').join(',');
  const ents = await env.DB.prepare(
    `SELECT code, currency FROM entity WHERE code IN (${ph})`
  ).bind(...entityCodes).all();
  const currencyOf = new Map(ents.results.map((e) => [e.code, e.currency]));
  const fx = await loadFxRates(env, year, fxVersion);

  const units = await env.DB.prepare(
    `SELECT code, unit_standard FROM metric`
  ).all();
  const unitOf = new Map(units.results.map((m) => [m.code, m.unit_standard]));
  const isMoney = (code) => String(unitOf.get(code) || '').startsWith(CURRENCY_UNIT_PREFIX);

  const out = [];
  for (const d of defs.results) {
    const numCodes = d.numerator_codes.split(',').map((x) => x.trim()).filter(Boolean);
    const denCodes = d.denominator_codes.split(',').map((x) => x.trim()).filter(Boolean);

    let numerator = 0, denominator = 0;
    // 같은 코드가 분자·분모에 함께 쓰이는 지표가 있다(예: 여성 관리자 비율의 S15).
    // 중복해서 담으면 "S15 · S14 · S15" 처럼 보인다
    const missingSet = new Set();
    const missingFx = new Set();
    const parts = { numerator: [], denominator: [] };

    for (const [codes, side] of [[numCodes, 'numerator'], [denCodes, 'denominator']]) {
      for (const code of codes) {
        const money = isMoney(code);
        let sum = 0;
        let any = false;
        let fxSkipped = false;
        for (const entityCode of entityCodes) {
          // 같은 산정 실행에서 이미 구한 계산지표 연간값이 있으면 그것을 쓴다.
          // calc_result 를 다시 읽으면 "확정 전에는 집약도가 안 나온다"가 되고,
          // 저장된 값과 방금 산정한 값이 어긋날 수도 있다 (R4 동일 입력 → 동일 결과).
          const pre = calcAnnual && calcAnnual[entityCode]
            ? calcAnnual[entityCode][code] : undefined;
          const v = pre !== undefined ? pre
            : await annualValue(env, entityCode, year, code, version);
          if (v === null || v === undefined) continue;
          if (money) {
            // 법인별 현지통화 → 원화. 환율이 없으면 더하지 않고 미산정으로 넘긴다.
            // 통화가 다른 금액을 그대로 합산하면 집약도가 조용히 틀린 값이 된다 (R65)
            const currency = currencyOf.get(entityCode);
            const rate = fx.get(currency);
            if (rate === undefined) { missingFx.add(currency); fxSkipped = true; continue; }
            sum += v * rate;
          } else {
            sum += v;
          }
          any = true;
        }
        // 환율이 없어서 못 더한 것은 "원천값 없음"이 아니다. 원인을 섞으면 대응이 달라진다
        if (!any && !fxSkipped) missingSet.add(code);
        else if (!any) { /* 환율만 없다 — missingFx 에 이미 기록됐다 */ }
        else if (side === 'numerator') numerator += sum;
        else denominator += sum;
        parts[side].push({ code, value: any ? round(sum, 4) : null, money });
      }
    }

    const missing = [...missingSet];
    const computable = missing.length === 0 && missingFx.size === 0 && denominator !== 0;
    out.push({
      code: d.code, name_ko: d.name_ko, unit: d.unit_standard,
      value: computable ? roundSig((numerator / denominator) * d.multiplier, 6) : null,
      numerator: round(numerator, 4),
      denominator: round(denominator, 4),
      multiplier: d.multiplier,
      parts,
      missing,
      missing_fx: [...missingFx],
      fx_version: fxVersion || null,
      reason: missing.length ? 'missing_source'
        : missingFx.size ? 'missing_fx'
        : denominator === 0 ? 'zero_denominator' : null,
    });
  }
  return out;
}

/* ── 연간 산정 (여러 법인 · 비율지표 · TOE 임계치) ─────────── */

/**
 * 연간 산정. 3법인 각각과 그룹 합산을 함께 낸다.
 * 베트남 Decree 06/2022 의 1,000 TOE 판정(R10 / R33)을 함께 반환한다.
 */
export async function computeYear(env, year, version, fxVersion) {
  const fxVer = fxVersion === undefined ? await latestFxVersion(env) : fxVersion;
  const entities = await env.DB.prepare(
    `SELECT code, name_ko, grid_region FROM entity WHERE is_active = 1 ORDER BY code`
  ).all();

  const perEntity = [];
  const group = { scope1: null, scope2: null, energy_tj: null, energy_toe: null };
  const unpricedAll = new Map();
  const calcAnnual = {};
  let monthsComputed = 0;

  /** null 은 "산정하지 못했다"이므로 0 처럼 더하지 않는다. 한 달이라도 나오면 그때부터 합산한다 */
  const add = (acc, key, v) => { if (v !== null) acc[key] = (acc[key] || 0) + v; };

  for (const e of entities.results) {
    const totals = { scope1: null, scope2: null, energy_tj: null, energy_toe: null };
    const months = [];
    for (let m = 1; m <= 12; m += 1) {
      const period = `${year}-${String(m).padStart(2, '0')}`;
      const c = await computeMonth(env, e.code, period, version);
      if (c.error) continue;
      const hasData = c.lines.length > 0;
      if (hasData) {
        monthsComputed += 1;
        add(totals, 'scope1', c.results.scope1);
        add(totals, 'scope2', c.results.scope2);
        add(totals, 'energy_tj', c.results.energy_tj);
        add(totals, 'energy_toe', c.results.energy_toe);
        months.push({ period, ...c.results });
      }
      for (const u of c.unpriced) {
        unpricedAll.set(`${e.code}/${u.metric_code}`,
          { entity_code: e.code, metric_code: u.metric_code, name_ko: u.name_ko, factor_type: u.factor_type });
      }
    }
    // 반올림한 값으로 누적한다.
    // 보고서에 인쇄된 법인별 수치를 독자가 더했을 때 합계가 나와야 한다.
    // 반올림 전 값으로 합하면 "3법인을 더했는데 합계와 0.01 다르다"는 질문을 받게 되고,
    // 그 질문에는 답할 방법이 없다. 월 → 연 → 그룹 모두 같은 규칙을 쓴다.
    const rd = (v, d) => (v === null ? null : round(v, d));
    const rounded = {
      scope1: rd(totals.scope1, 3), scope2: rd(totals.scope2, 3),
      energy_tj: rd(totals.energy_tj, 4),
      energy_toe: rd(totals.energy_toe, 2),
    };
    // 집약도 지표(E-C5 · E-C6)의 분자로 쓰인다. 인쇄되는 값과 같은 값을 써야 한다
    calcAnnual[e.code] = {
      'E-C1': rounded.energy_tj, 'E-C2': rounded.energy_toe,
      'E-C3': rounded.scope1, 'E-C4': rounded.scope2,
    };
    const toe = rounded.energy_toe;
    perEntity.push({
      entity_code: e.code, name_ko: e.name_ko, grid_region: e.grid_region,
      ...rounded,
      scope12: rounded.scope1 === null && rounded.scope2 === null ? null
        : round((rounded.scope1 || 0) + (rounded.scope2 || 0), 3),
      partial: { scope1: rounded.scope1 === null, scope2: rounded.scope2 === null,
                 energy: rounded.energy_tj === null },
      months,
      // R10 / R33 — 빈푹 법인의 현지 법정 보고 의무 판정 기준
      toe_threshold: toe === null ? null
        : { limit: 1000, ratio: round(toe / 1000, 3),
            exceeded: toe >= 1000, near: toe >= 800 && toe < 1000 },
    });
    add(group, 'scope1', rounded.scope1);
    add(group, 'scope2', rounded.scope2);
    add(group, 'energy_tj', rounded.energy_tj);
    add(group, 'energy_toe', rounded.energy_toe);
  }

  const codes = entities.results.map((e) => e.code);
  const ratios = await computeRatios(env, codes, year, version, fxVer, calcAnnual);
  const ratiosByEntity = {};
  for (const code of codes) {
    ratiosByEntity[code] = await computeRatios(env, [code], year, version, fxVer, calcAnnual);
  }

  return {
    year, version, fx_version: fxVer,
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
    ratios,
    ratios_by_entity: ratiosByEntity,
    unpriced: [...unpricedAll.values()],
    months_computed: monthsComputed,
  };
}
