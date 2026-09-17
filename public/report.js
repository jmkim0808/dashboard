/* 조회 · 데이터북 · 경영진 화면 (S6 · S7 · S9)
 *
 * app.js 의 h() · setChildren() · api() · toast() 를 함께 쓴다. 로드 순서는 index.html 참조.
 *
 * 이 화면이 지키는 원칙
 *   R11  적용 계수·출처·버전을 산출값 옆에 항상 표시한다
 *   R37  경영진 화면은 1페이지 · 신호등이다. 그래프를 늘리지 않는다
 *   R38  "지금 고객사 요청이 오면 며칠 안에 답할 수 있는가"
 *   R43  미확보 칸은 비워 둔다. 추정치를 넣는 UI 가 없다
 *   R44  GRI · KSSB 코드를 병기한다
 *   R55  결과 → 계수 → 입력값 → 증빙 4단을 한 화면에서 따라갈 수 있다
 *   R56  2027년 보고서 발간 준비도
 */

const RP = { from: null, to: null, entity: null, years: null, drill: null, digest: null,
             disclosure: 'public', submitting: false };

const ST_KO = {
  available: '확보', partial: '일부 확보', unavailable: '미확보',
  empty: '미입력', not_applicable: '해당 없음', derived: '산출값',
  not_computed: '산정 불가',
};
const DISC_KO2 = { internal: '내부전용', customer: '고객사제출', public: '대외공시' };
const PURPOSE_KO = { customer: '고객사 제출', regulatory: '법정 보고',
                     report: '지속가능경영보고서', internal: '내부 검토' };

/* ── 공통 ─────────────────────────────────────────────────── */

/* 이 파일의 이름은 rFmt · rSig 처럼 접두어를 붙인다.
   public/*.js 는 전역 스코프를 공유하므로 같은 이름이 있으면 나중에 로드된 쪽이 앞쪽을 덮는다.
   덮이면 오류 없이 다른 화면이 조용히 틀린 동작을 한다. npm run verify 가 이것을 검사한다. */
function rFmt(v, digits) {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('ko-KR', {
    minimumFractionDigits: digits === undefined ? 0 : digits,
    maximumFractionDigits: digits === undefined ? 3 : digits,
  });
}

/** 유효숫자 표시 — 집약도처럼 작은 값이 0.0000 으로 뭉개지지 않게 한다 */
function rSig(v, digits = 4) {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  // 소수 자릿수는 최대치만 정한다. 최소치를 두면 5,022,919 가 5,022,919.4400 으로 찍힌다
  if (Math.abs(n) >= 0.001) {
    return n.toLocaleString('ko-KR', { maximumFractionDigits: digits });
  }
  return n.toPrecision(3);
}

function shiftMonth(period, n) {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function lastMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 미산정이 섞인 합계에는 반드시 그 사실을 붙인다. 숫자만 보여주면 과소 보고가 된다 */
function partialNote(partial) {
  if (!partial) return null;
  const missing = [];
  if (partial.scope1) missing.push('Scope 1');
  if (partial.scope2) missing.push('Scope 2');
  if (partial.energy) missing.push('에너지');
  if (missing.length === 0) return null;
  return h('span', { class: 'flag-partial', text: `${missing.join(' · ')} 미산정 제외` });
}

function statCard(label, value, unit, cls) {
  return h('div', { class: 'stat' + (cls ? ' ' + cls : '') },
    h('div', { class: 'stat-label', text: label }),
    h('div', { class: 'stat-value num' },
      value === null || value === undefined
        ? h('span', { class: 'unpriced', text: '미산정' })
        : [rFmt(value, 3), unit ? h('span', { class: 'unit-pill sm', text: unit }) : null]));
}

/* ══════════════════════════════════════════════════════════
   S6 — 조회 · 드릴다운
   ══════════════════════════════════════════════════════════ */

async function viewQuery(view) {
  const [segFrom, segTo, segEntity] = currentRoute().seg;
  const ok = (p) => /^\d{4}-\d{2}$/.test(p || '');
  RP.to = ok(segTo) ? segTo : (RP.to || lastMonth());
  RP.from = ok(segFrom) ? segFrom : (RP.from || shiftMonth(RP.to, -2));
  RP.entity = segEntity || null;

  const q = RP.entity ? `&entity=${encodeURIComponent(RP.entity)}` : '';
  const r = await api(`/api/report/query?from=${RP.from}&to=${RP.to}${q}`);
  if (!r.ok) {
    setChildren(view, h('div', { class: 'banner fail' },
      h('h2', { text: '조회할 수 없습니다' }),
      h('p', { text: (r.data && (r.data.hint || r.data.error)) || '알 수 없는 오류' })));
    return;
  }
  const Q = r.data;
  const hashOf = (from, to, entity) =>
    '#/query/' + [from, to, entity].filter(Boolean).join('/');

  const rangeChips = h('div', { class: 'chips' },
    h('a', { class: 'chip', href: hashOf(shiftMonth(RP.from, -1), shiftMonth(RP.to, -1), RP.entity),
             text: '← 한 달 앞' }),
    h('span', { class: 'chip on num', text: `${RP.from} ~ ${RP.to}` }),
    h('a', { class: 'chip', href: hashOf(shiftMonth(RP.from, 1), shiftMonth(RP.to, 1), RP.entity),
             text: '한 달 뒤 →' }));

  const presets = h('div', { class: 'chips' },
    [['최근 3개월', 2], ['최근 6개월', 5], ['최근 12개월', 11]].map(([label, back]) =>
      h('a', { class: 'chip', href: hashOf(shiftMonth(RP.to, -back), RP.to, RP.entity),
               text: label })),
    h('a', { class: 'chip', href: hashOf(`${RP.to.slice(0, 4)}-01`, RP.to, RP.entity),
             text: `${RP.to.slice(0, 4)}년 누계` }),
    (S.me && S.me.can && S.me.can.databook)
      ? h('a', { class: 'chip', href: '#/year/' + RP.to.slice(0, 4),
                 text: '연간 집계 · 비율지표 →' })
      : null);

  setChildren(view,
    h('div', { class: 'page-head' },
      h('div', null,
        h('div', { class: 'eyebrow', text: '산정 · 조회' }),
        h('h1', null, h('span', { class: 'num', text: `${RP.from} ~ ${RP.to}` }), ' 산출 결과'),
        h('p', { class: 'page-desc' },
          '숫자를 누르면 ', h('b', { text: '계수 → 입력값 → 증빙' }),
          ' 까지 따라 내려갈 수 있습니다. 고객사가 근거를 물으면 이 화면을 그대로 보여주면 됩니다.')),
      h('div', { class: 'head-right' }, rangeChips)),
    presets,

    // 배출량 · 에너지
    h('div', { class: 'card flush' },
      h('div', { class: 'card-head' },
        h('h3', { text: '온실가스 · 에너지' }),
        h('span', { class: 'note num' }, '계수 ', Q.version)),
      h('div', { class: 'scroll-x' },
        h('table', null,
          h('thead', null, h('tr', null,
            h('th', { text: '법인' }),
            h('th', { class: 'right', text: 'Scope 1' }),
            h('th', { class: 'right', text: 'Scope 2' }),
            h('th', { class: 'right', text: '합계 (tCO2eq)' }),
            h('th', { class: 'right', text: '에너지 (TJ)' }),
            h('th', { class: 'right', text: 'TOE' }),
            h('th', { text: '적용 산정표준 (R11)' }))),
          h('tbody', null,
            Q.entities.map((e) => h('tr', null,
              h('td', null, h('div', { text: e.name_ko }),
                h('div', { class: 'name-sub num', text: `${e.entity_code} · ${e.grid_region}` })),
              h('td', { class: 'right num' }, cellNum(e.scope1)),
              h('td', { class: 'right num' }, cellNum(e.scope2)),
              h('td', { class: 'right num' }, h('b', null, cellNum(e.scope12))),
              h('td', { class: 'right num' }, cellNum(e.energy_tj, 4)),
              h('td', { class: 'right num' }, cellNum(e.energy_toe, 2)),
              h('td', { class: 'hint', text: e.calc_standard }))),
            h('tr', { class: 'total' },
              h('td', null, h('b', { text: '합산' })),
              h('td', { class: 'right num' }, cellNum(Q.group.scope1)),
              h('td', { class: 'right num' }, cellNum(Q.group.scope2)),
              h('td', { class: 'right num' }, h('b', null, cellNum(Q.group.scope12))),
              h('td', { class: 'right num' }, cellNum(Q.group.energy_tj, 4)),
              h('td', { class: 'right num' }, cellNum(Q.group.energy_toe, 2)),
              h('td', null, partialNote(Q.group.partial)))))),
      Q.unpriced.length
        ? h('div', { class: 'banner warn slim' },
            h('p', null, h('b', { text: `미산정 ${Q.unpriced.length}건` }),
              ' — 배출계수가 등록되지 않은 항목입니다. ',
              h('b', { text: '합계에 0 으로 들어가지 않았습니다.' })),
            h('div', { class: 'chips' },
              Q.unpriced.map((u) => h('span', { class: 'chip' },
                `${u.entity_code} ${u.metric_code} ${u.name_ko}`))))
        : null),

    // 물량 항목
    Q.physical.length ? physicalCard(Q) : null,

    // 월별 추이 + 드릴다운 진입
    monthCard(Q),

    // 적용 계수 (R11)
    factorCard(Q),

    h('div', { id: 'drill' }, RP.drill ? drillCard(RP.drill) : null));
}

function cellNum(v, digits = 3) {
  return v === null || v === undefined
    ? h('span', { class: 'unpriced', text: '미산정' })
    : rFmt(v, digits);
}

function physicalCard(Q) {
  const codes = Q.entities.map((e) => e.entity_code);
  return h('div', { class: 'card flush' },
    h('div', { class: 'card-head' },
      h('h3', { text: '용수 · 폐기물 · 대기' }),
      h('span', { class: 'note', text: '계수 없이 물량 그대로 집계하는 항목' })),
    h('div', { class: 'scroll-x' },
      h('table', null,
        h('thead', null, h('tr', null,
          h('th', { text: '항목' }), h('th', { text: '단위' }),
          Q.entities.map((e) => h('th', { class: 'right', text: e.name_ko })),
          h('th', { class: 'right', text: '합계' }), h('th', { text: '' }))),
        h('tbody', null,
          Q.physical.map((p) => h('tr', null,
            h('td', null, h('div', { class: 'name-main', text: p.name_ko }),
              h('div', { class: 'name-sub num' }, p.metric_code,
                p.gri_code ? ` · GRI ${p.gri_code}` : '')),
            h('td', { class: 'num', text: p.unit }),
            codes.map((c) => h('td', { class: 'right num' },
              p.by_entity[c] === null || p.by_entity[c] === undefined
                ? h('span', { class: 'unpriced', text: '미확보' })
                : rFmt(p.by_entity[c], 2))),
            h('td', { class: 'right num' },
              p.total === null ? h('span', { class: 'unpriced', text: '—' })
                               : h('b', { text: rFmt(p.total, 2) })),
            h('td', { class: 'hint' },
              p.missing.length
                ? `${p.missing.join(' · ')} 미확보 — 합계에서 제외됨`
                : ''))))))); 
}

function monthCard(Q) {
  const periods = Q.periods;
  return h('div', { class: 'card flush' },
    h('div', { class: 'card-head' },
      h('h3', { text: '월별 추이' }),
      h('span', { class: 'note', text: '셀을 누르면 그 달의 항목별 계산 내역으로 이동합니다' })),
    h('div', { class: 'scroll-x' },
      h('table', null,
        h('thead', null, h('tr', null,
          h('th', { class: 'nowrap', text: '법인 · 항목' }),
          periods.map((p) => h('th', { class: 'right num', text: p.slice(2) })))),
        h('tbody', null,
          Q.entities.flatMap((e) => [
            ['Scope 1+2 (tCO2eq)', 'scope12', 3],
            ['에너지 (TJ)', 'energy_tj', 4],
          ].map(([label, key, digits], i) => h('tr', { class: i ? 'dim' : '' },
            h('td', { class: 'nowrap' },
              i === 0 ? h('div', { class: 'name-main', text: e.name_ko }) : null,
              h('div', { class: i === 0 ? 'name-sub' : '', text: label })),
            periods.map((p) => {
              const m = e.months.find((x) => x.period === p);
              return h('td', { class: 'right num' },
                !m
                  ? h('span', { class: 'note', text: '—' })
                  : h('a', {
                      class: 'drill-link', href: '#',
                      onclick: (ev) => { ev.preventDefault(); openDrillList(e.entity_code, p); },
                      text: rFmt(m[key], digits),
                    }));
            }))))))));
}

function factorCard(Q) {
  if (Q.factors_used.length === 0) return null;
  return h('div', { class: 'card flush' },
    h('div', { class: 'card-head' },
      h('h3', { text: '적용 배출계수' }),
      h('span', { class: 'note num' }, '버전 ', Q.version)),
    h('div', { class: 'scroll-x' },
      h('table', null,
        h('thead', null, h('tr', null,
          h('th', { text: '항목' }), h('th', { text: '지역' }),
          h('th', { class: 'right', text: '계수' }), h('th', { class: 'right', text: '적용연도' }),
          h('th', { text: '출처' }))),
        h('tbody', null,
          Q.factors_used.map((f) => h('tr', null,
            h('td', null, h('div', { class: 'name-main', text: f.name_ko }),
              h('div', { class: 'name-sub num', text: f.metric_code })),
            h('td', { class: 'num', text: f.region }),
            h('td', { class: 'right num', text: String(f.value) }),
            h('td', { class: 'right num', text: String(f.year) }),
            h('td', { class: 'hint', text: f.source })))))));
}

/* ── 드릴다운 (R55) ───────────────────────────────────────── */

async function openDrillList(entityCode, period) {
  const box = document.getElementById('drill');
  if (!box) return;
  setChildren(box, h('div', { class: 'banner load' }, h('p', { text: '불러오는 중…' })));
  const r = await api(`/api/calc/month?entity=${encodeURIComponent(entityCode)}`
                      + `&period=${encodeURIComponent(period)}`);
  if (!r.ok) { fail(r, '계산 내역을 불러올 수 없습니다'); setChildren(box); return; }
  const c = r.data;

  const evidenceBtn = (metricCode) => h('button', {
    class: 'chip', text: '근거 보기',
    onclick: () => openDrill(entityCode, period, metricCode),
  });

  const pricedRow = (l) => h('tr', null,
    h('td', null,
      h('div', { class: 'name-main', text: l.name_ko }),
      h('div', { class: 'name-sub num' }, l.metric_code,
        l.ghg_scope ? ` · Scope ${l.ghg_scope}` : '',
        l.allocation_basis ? ` · 임대 배분(${l.allocation_basis})` : '')),
    h('td', { class: 'right num', text: rFmt(l.value_raw, 3) }),
    h('td', { class: 'right num' }, rFmt(l.standard, 1),
      h('span', { class: 'unit-pill sm', text: l.unit_standard })),
    h('td', { class: 'right num', text: rFmt(l.allocated, 1) }),
    h('td', { class: 'right num' },
      l.tco2 === undefined
        ? h('span', { class: 'unpriced', text: '미산정' })
        : rFmt(l.tco2, 4)),
    h('td', { class: 'right' }, evidenceBtn(l.metric_code)));

  const unpricedRow = (u) => h('tr', { class: 'dim' },
    h('td', null,
      h('div', { class: 'name-main', text: u.name_ko }),
      h('div', { class: 'name-sub num', text: u.metric_code })),
    h('td', { class: 'right num', text: '—' }),
    h('td', { class: 'right num' }, rFmt(u.value, 1),
      h('span', { class: 'unit-pill sm', text: u.unit })),
    h('td', { class: 'right num', text: '—' }),
    h('td', { class: 'right' }, h('span', { class: 'unpriced', text: '계수 없음' })),
    h('td', { class: 'right' }, evidenceBtn(u.metric_code)));

  const head = h('thead', null, h('tr', null,
    h('th', { text: '항목' }),
    h('th', { class: 'right', text: '입력값' }),
    h('th', { class: 'right', text: '표준단위' }),
    h('th', { class: 'right', text: '배분 후' }),
    h('th', { class: 'right', text: 'tCO2eq' }),
    h('th', { text: '' })));

  const body = h('tbody', null,
    c.lines.map(pricedRow),
    c.unpriced.map(unpricedRow));

  setChildren(box, h('div', { class: 'card', id: 'drill-card' },
    h('div', { class: 'card-head' },
      h('h3', null, entityCode, ' ', h('span', { class: 'num', text: period }), ' 계산 내역'),
      h('button', { class: 'chip', text: '닫기',
        onclick: () => { RP.drill = null; setChildren(box); } })),
    h('p', { class: 'note' },
      '항목을 누르면 계수 · 입력값 · 증빙 · 변경이력까지 한 번에 열립니다 (R55).'),
    h('div', { class: 'scroll-x' }, h('table', null, head, body))));
}

async function openDrill(entityCode, period, metricCode) {
  const r = await api(`/api/report/drill?entity=${encodeURIComponent(entityCode)}`
    + `&period=${encodeURIComponent(period)}&metric=${encodeURIComponent(metricCode)}`);
  if (!r.ok) { fail(r, '근거를 불러올 수 없습니다'); return; }
  RP.drill = r.data;
  const box = document.getElementById('drill');
  if (box) setChildren(box, drillCard(r.data));
  const card = document.getElementById('drill-detail');
  if (card) card.scrollIntoView({ block: 'nearest' });
}

/** 4단 근거 카드 — 결과 → 계수 → 입력값 → 증빙 */
function drillCard(D) {
  const m = D.metric, e = D.entry, c = D.calc, f = D.factor;
  const step = (n, title, body) => h('div', { class: 'step' },
    h('div', { class: 'step-n num', text: String(n) }),
    h('div', { class: 'step-body' },
      h('div', { class: 'step-title', text: title }), body));

  return h('div', { class: 'card editing-card', id: 'drill-detail' },
    h('div', { class: 'editor-title' },
      h('h3', null, m.name_ko, ' ',
        h('span', { class: 'num', text: `${D.entity_code} ${D.period}` })),
      h('button', { class: 'chip', text: '닫기', onclick: () => {
        RP.drill = null;
        const box = document.getElementById('drill');
        if (box) setChildren(box);
      } })),
    h('div', { class: 'chips' },
      h('span', { class: 'chip on', text: DISC_KO2[m.disclosure_level] || m.disclosure_level }),
      m.gri_code ? h('span', { class: 'chip', text: 'GRI ' + m.gri_code }) : null,
      m.kssb_code ? h('span', { class: 'chip', text: 'KSSB/IFRS ' + m.kssb_code }) : null,
      m.ghg_scope ? h('span', { class: 'chip', text: 'Scope ' + m.ghg_scope }) : null),

    step(1, '산출 결과',
      h('div', { class: 'facts' },
        h('div', { class: 'fact' }, '배출량 ',
          c.tco2 === null ? h('b', { class: 'unpriced', text: '미산정' })
                          : h('b', { class: 'num', text: rFmt(c.tco2, 4) + ' tCO2eq' })),
        h('div', { class: 'fact' }, '적용 표준 ', h('b', { text: c.calc_standard })))),

    step(2, '적용 계수',
      f ? h('div', null,
            h('div', { class: 'facts' },
              h('div', { class: 'fact' }, '계수 ',
                h('b', { class: 'num', text: `${f.value} ${f.unit}` })),
              h('div', { class: 'fact' }, '지역 ', h('b', { class: 'num', text: f.region })),
              h('div', { class: 'fact' }, '적용연도 ', h('b', { class: 'num', text: String(f.year) })),
              h('div', { class: 'fact' }, '버전 ', h('b', { class: 'num', text: f.version })),
              f.gwp_set ? h('div', { class: 'fact' }, 'GWP ', h('b', { text: f.gwp_set })) : null),
            h('p', { class: 'hint', text: `출처: ${f.source} (고시 ${f.published_at})` }))
        : h('p', { class: 'hint',
            text: m.factor_type
              ? `${m.factor_type} 계수가 등록되지 않았습니다. 이 항목은 합계에 포함되지 않았습니다.`
              : '계수를 쓰지 않는 물량 항목입니다.' })),

    step(3, '입력값',
      h('div', null,
        h('div', { class: 'facts' },
          h('div', { class: 'fact' }, '원본 ',
            e.value_raw === null
              ? h('b', { class: 'unpriced', text: `미확보 (${e.unavailable_reason_code || '-'})` })
              : h('b', { class: 'num', text: `${rFmt(e.value_raw, 3)} ${e.unit_raw || m.unit_input}` })),
          h('div', { class: 'fact' }, '× 단위환산 ',
            h('b', { class: 'num', text: c.to_standard === 1 ? '없음' : rFmt(c.to_standard, 0) })),
          h('div', { class: 'fact' }, '× 배분율 ',
            h('b', { class: 'num', text: c.allocation_ratio === 1 ? '없음' : String(c.allocation_ratio) })),
          h('div', { class: 'fact' }, '= 산정 투입값 ',
            h('b', { class: 'num', text: `${rFmt(c.allocated, 2)} ${m.unit_standard}` }))),
        h('div', { class: 'facts' },
          h('div', { class: 'fact' }, '입력 ',
            h('span', { class: 'role-code', text: e.entered_by_role || '-' }),
            e.entered_at ? ` · ${e.entered_at.slice(0, 16).replace('T', ' ')}` : ''),
          h('div', { class: 'fact' }, '승인 ',
            h('span', { class: 'role-code', text: e.approved_by_role || '미승인' })),
          e.closed_at ? h('div', { class: 'fact' }, h('b', { text: '확정됨' })) : null,
          e.is_retro ? h('div', { class: 'fact' }, h('b', { text: '소급입력' })) : null),
        h('p', { class: 'hint', text: m.definition_ko }),
        c.allocation_ratio !== 1 && D.site.allocation_basis
          ? h('p', { class: 'hint',
              text: `임대 사업장(${D.site.name_ko}) — 배분 기준: ${D.site.allocation_basis}` })
          : null)),

    step(4, '증빙',
      m.evidence_policy === 'none'
        ? h('p', { class: 'hint',
            text: '이 지표는 증빙 첨부 경로가 없습니다. 개인정보가 포함될 수 있는 인사·안전 자료를 '
                  + '플랫폼에 올릴 방법 자체를 두지 않았습니다 (R86).' })
        : D.evidence.length === 0
          ? h('p', { class: 'hint fail', text: '증빙이 첨부되지 않았습니다.' })
          : h('div', { class: 'stack' },
              D.evidence.map((v) => h('div', { class: 'row' },
                h('div', null,
                  h('div', { class: 'name-main', text: v.original_filename }),
                  h('div', { class: 'name-sub num' },
                    `${Math.round(v.byte_size / 1024)} KB · ${v.content_type}`,
                    ' · SHA-256 ', v.sha256.slice(0, 16), '…')),
                h('a', { class: 'chip', target: '_blank',
                  href: `/api/entry/evidence?key=${encodeURIComponent(v.r2_key)}`,
                  text: '원본 열기' }))))),

    D.history.length
      ? h('details', { class: 'trace' },
          h('summary', { text: `변경 이력 ${D.history.length}건 보기` }),
          h('div', { class: 'scroll-x' },
            h('table', null,
              h('thead', null, h('tr', null,
                h('th', { text: '항목' }), h('th', { text: '이전' }), h('th', { text: '이후' }),
                h('th', { text: '변경 역할' }), h('th', { text: '시각' }))),
              h('tbody', null,
                D.history.map((x) => h('tr', null,
                  h('td', { class: 'num', text: x.field }),
                  h('td', { class: 'num', text: x.old_value === null ? '—' : x.old_value }),
                  h('td', { class: 'num', text: x.new_value === null ? '—' : x.new_value }),
                  h('td', null, h('span', { class: 'role-code', text: x.changed_by_role || '-' })),
                  h('td', { class: 'num', text: (x.changed_at || '').slice(0, 16).replace('T', ' ') })))))))
      : null);
}

/* ══════════════════════════════════════════════════════════
   S7 — 지표 데이터북
   ══════════════════════════════════════════════════════════ */

async function viewDataBook(view) {
  const [segYears, segDisc] = currentRoute().seg;
  const years = /^\d{4}(,\d{4})*$/.test(segYears || '')
    ? segYears.split(',').map(Number)
    : (RP.years || [new Date().getFullYear() - 1, new Date().getFullYear()]);
  RP.years = years;
  RP.disclosure = ['public', 'customer', 'all'].includes(segDisc) ? segDisc : RP.disclosure;

  const dq = RP.disclosure === 'all' ? '' : `&disclosure=${RP.disclosure}`;
  const r = await api(`/api/report/databook?years=${years.join(',')}${dq}`);
  if (!r.ok) {
    setChildren(view, h('div', { class: 'banner fail' },
      h('h2', { text: '데이터북을 불러올 수 없습니다' }),
      h('p', { text: (r.data && (r.data.hint || r.data.error)) || '알 수 없는 오류' })));
    return;
  }
  const B = r.data;
  const hashOf = (ys, disc) => `#/databook/${ys.join(',')}/${disc}`;
  const thisY = new Date().getFullYear();

  setChildren(view,
    h('div', { class: 'page-head' },
      h('div', null,
        h('div', { class: 'eyebrow', text: '지표 데이터북' }),
        h('h1', null, h('span', { class: 'num', text: years.join(' · ') }), ' 지표 추이'),
        h('p', { class: 'page-desc' },
          '2027년 보고서 집필에 그대로 쓰는 표입니다. ',
          h('b', { text: '빈 칸은 확보하지 못한 값이고, 추정치를 넣는 칸은 없습니다' }),
          ' (R43).')),
      h('div', { class: 'head-right' },
        h('div', { class: 'chips' },
          [[thisY - 2, thisY - 1], [thisY - 1, thisY], [thisY - 2, thisY - 1, thisY]].map((ys) =>
            h('a', { class: 'chip' + (ys.join(',') === years.join(',') ? ' on' : ''),
              href: hashOf(ys, RP.disclosure), text: ys.join('·') }))))),

    h('div', { class: 'page-head tight' },
      h('div', null,
        h('h2', { text: '공개등급 필터' }),
        h('p', { class: 'page-desc' },
          '대외 산출물에는 ', h('b', { text: '자동으로' }),
          ' 적용됩니다. 사람이 고르는 것이 아닙니다 (R40).')),
      h('div', { class: 'head-right' },
        h('div', { class: 'chips' },
          [['public', '대외공시만'], ['customer', '+ 고객사제출'], ['all', '전체 (내부용)']]
            .map(([k, label]) => h('a', {
              class: 'chip' + (RP.disclosure === k ? ' on' : ''),
              href: hashOf(years, k), text: label }))))),

    h('div', { class: 'stats' },
      h('div', { class: 'stat' },
        h('div', { class: 'stat-label', text: '지표 수' }),
        h('div', { class: 'stat-value num', text: String(B.rows.length) })),
      h('div', { class: 'stat' },
        h('div', { class: 'stat-label', text: '모든 연도 확보' }),
        h('div', { class: 'stat-value num', text: String(B.counts.available) })),
      h('div', { class: 'stat' },
        h('div', { class: 'stat-label', text: '적용 계수' }),
        h('div', { class: 'stat-value num', text: B.version || '-' })),
      h('div', { class: 'stat' },
        h('div', { class: 'stat-label', text: '적용 환율' }),
        h('div', { class: 'stat-value num', text: B.fx_version || '미등록' }))),

    h('div', { class: 'actions' },
      h('a', { class: 'primary btn-a', download: '',
        href: `/api/report/databook?years=${years.join(',')}${dq}&format=csv`,
        text: '엑셀(CSV) 인출' }),
      h('span', { class: 'note',
        text: '한글이 깨지지 않는 UTF-8 BOM CSV 입니다. 엑셀에서 바로 열립니다.' })),

    disclosureWarningCard(B),
    bookTable(B),
    submissionCard(B));
}

/** 비율지표가 더 엄격한 등급의 항목을 분모로 쓰면 알린다 (R39 / R40) */
function disclosureWarningCard(B) {
  const ws = B.disclosure_warnings || [];
  if (ws.length === 0) return null;
  return h('div', { class: 'banner warn' },
    h('h2', { text: '공개등급 확인이 필요한 지표' }),
    h('p', null,
      '아래 비율지표를 공개하면 ', h('b', { text: '분모를 역산할 수 있습니다' }),
      ' (분모 = 분자 ÷ 비율). 분모가 더 엄격한 등급이면 함께 공개되는 셈입니다. ',
      '내보내도 되는지는 사람이 판단해야 합니다 — 막지 않고 알려드립니다.'),
    h('div', { class: 'stack' },
      ws.map((w) => h('div', { class: 'row' },
        h('div', null,
          h('b', null, w.code, ' ', w.name_ko),
          h('span', { class: 'badge ok', text: DISC_KO2[w.disclosure_level] })),
        h('div', { class: 'head-right' },
          w.sources.map((x) => h('span', { class: 'badge mute' },
            x.code, ' ', x.name_ko, ' · ', DISC_KO2[x.disclosure_level])))))));
}

function bookTable(B) {
  const years = B.years;
  return h('div', { class: 'card flush' },
    h('div', { class: 'card-head' },
      h('h3', { text: '지표 × 연도' }),
      h('span', { class: 'note', text: '확보기간이 12/12개월이 아니면 연간 수치가 아닙니다' })),
    h('div', { class: 'scroll-x' },
      h('table', null,
        h('thead', null, h('tr', null,
          h('th', { text: '지표' }), h('th', { text: '단위' }),
          h('th', { text: '프레임워크' }), h('th', { text: '공개등급' }),
          years.flatMap((y) => [
            h('th', { class: 'right num', text: `${y} 값` }),
            h('th', { class: 'num', text: `${y} 상태` }),
          ]))),
        h('tbody', null,
          B.rows.map((r) => h('tr', { class: r.is_calculated ? 'calc' : '' },
            h('td', null,
              h('div', { class: 'name-main', text: r.name_ko }),
              h('div', { class: 'name-sub num' }, r.code,
                r.is_calculated ? ' · 산출' : '', ' · ', r.period_type)),
            h('td', { class: 'num', text: r.unit }),
            h('td', { class: 'num name-sub' },
              r.gri_code ? h('div', { text: 'GRI ' + r.gri_code }) : null,
              r.kssb_code ? h('div', { text: r.kssb_code }) : null),
            h('td', null, h('span', {
              class: 'badge ' + (r.disclosure_level === 'public' ? 'ok'
                : r.disclosure_level === 'customer' ? 'warn' : 'mute'),
              text: DISC_KO2[r.disclosure_level] })),
            years.flatMap((y) => {
              const c = r.cells[y];
              return [
                h('td', { class: 'right num' },
                  c.value === null ? h('span', { class: 'unpriced', text: '' })
                                   : h('b', { text: rSig(c.value) })),
                h('td', null, stateBadge(c)),
              ];
            })))))));
}

function stateBadge(c) {
  const cls = c.state === 'available' ? 'ok'
    : c.state === 'partial' ? 'warn'
    : c.state === 'derived' ? 'mute'
    : c.state === 'not_computed' ? 'warn'
    : c.state === 'unavailable' ? 'unav' : 'mute';
  return h('div', null,
    h('span', { class: 'badge ' + cls, text: ST_KO[c.state] || c.state }),
    c.coverage && !c.coverage.complete
      ? h('div', { class: 'name-sub num',
          text: `${c.coverage.filled}/${c.coverage.due}` })
      : null);
}

/* ── S8 제출 이력 ──────────────────────────────────────────── */

function submissionCard(B) {
  const can = (S.me && S.me.can && S.me.can.submit);
  return h('div', { class: 'card', id: 'submission-card' },
    h('div', { class: 'card-head' },
      h('h3', { text: '대외 산출물 생성 · 제출 이력' }),
      h('span', { class: 'note', text: can ? '파트장 권한' : '생성 권한 없음 (조회만)' })),
    h('p', { class: 'note' },
      '제출한 파일을 그대로 보관하고 ', h('b', { text: '수신처 · 대상기간 · 적용 계수버전' }),
      ' 을 함께 기록합니다. 나중에 "그때 뭘 냈는가"에 답할 수 있어야 제출 이력이 의미가 있습니다.'),
    can
      ? h('div', { class: 'form-grid' },
          h('label', null, '수신처',
            h('input', { id: 'sub-to', type: 'text', placeholder: '예: 삼성전자 / 빈푹성 환경국' })),
          h('label', null, '용도',
            h('select', { id: 'sub-purpose' },
              Object.entries(PURPOSE_KO).map(([k, v]) =>
                h('option', { value: k }, v)))),
          h('label', null, '대상기간 시작',
            h('input', { id: 'sub-from', type: 'text', value: `${B.years[0]}-01` })),
          h('label', null, '대상기간 종료',
            h('input', { id: 'sub-to-p', type: 'text',
              value: `${B.years[B.years.length - 1]}-12` })))
      : null,
    can
      ? h('div', { class: 'actions' },
          h('button', { class: 'primary', text: RP.submitting ? '생성 중…' : '산출물 생성 · 이력 기록',
            disabled: RP.submitting, onclick: () => doSubmit(B) }),
          h('span', { class: 'note',
            text: '용도에 따라 공개등급이 자동으로 걸립니다 — 고객사 제출은 고객사제출 등급까지, '
                  + '법정·보고서는 대외공시만.' }))
      : null,
    h('div', { id: 'submission-list' }, h('p', { class: 'note', text: '이력 불러오는 중…' })));
}

async function doSubmit(B) {
  const to = (document.getElementById('sub-to') || {}).value || '';
  const purpose = (document.getElementById('sub-purpose') || {}).value || 'customer';
  const from = (document.getElementById('sub-from') || {}).value || '';
  const until = (document.getElementById('sub-to-p') || {}).value || '';
  if (!to.trim()) { toast('수신처를 입력하세요', 'fail'); return; }
  RP.submitting = true;
  const r = await api('/api/report/submission', 'POST', {
    submitted_to: to.trim(), purpose, period_from: from, period_to: until,
    years: B.years,
  });
  RP.submitting = false;
  if (!r.ok) { fail(r, '산출물 생성에 실패했습니다'); return; }
  toast(`${r.data.submitted_to} — 지표 ${r.data.metrics}개 산출물 생성 · 이력 기록됨`);
  await loadSubmissions();
}

async function loadSubmissions() {
  const box = document.getElementById('submission-list');
  if (!box) return;
  const r = await api('/api/report/submission');
  if (!r.ok) { setChildren(box, h('p', { class: 'note', text: '이력을 불러올 수 없습니다.' })); return; }
  const items = r.data.items || [];
  if (items.length === 0) {
    setChildren(box, h('p', { class: 'note', text: '아직 생성한 대외 산출물이 없습니다.' }));
    return;
  }
  setChildren(box, h('div', { class: 'scroll-x' },
    h('table', null,
      h('thead', null, h('tr', null,
        h('th', { text: '제출일시' }), h('th', { text: '수신처' }), h('th', { text: '용도' }),
        h('th', { text: '대상기간' }), h('th', { text: '계수버전' }),
        h('th', { text: '승인' }), h('th', { text: '' }))),
      h('tbody', null,
        items.map((s) => h('tr', null,
          h('td', { class: 'num', text: (s.submitted_at || '').slice(0, 16).replace('T', ' ') }),
          h('td', { text: s.submitted_to }),
          h('td', { text: PURPOSE_KO[s.purpose] || s.purpose }),
          h('td', { class: 'num', text: `${s.period_from} ~ ${s.period_to}` }),
          h('td', { class: 'num', text: s.factor_version }),
          h('td', null, h('span', { class: 'role-code', text: s.approved_by_role || '-' })),
          h('td', { class: 'right' },
            s.output_r2_key
              ? h('a', { class: 'chip', download: '',
                  href: `/api/report/submission?key=${encodeURIComponent(s.output_r2_key)}`,
                  text: '그때 낸 파일' })
              : null)))))));
}

/* ══════════════════════════════════════════════════════════
   S9 — 경영진 화면 (1페이지)
   ══════════════════════════════════════════════════════════ */

const LIGHT = { green: '정상', amber: '주의', red: '지연', gray: '대상 아님' };

async function viewExec(view) {
  const [segPeriod] = currentRoute().seg;
  const period = /^\d{4}-\d{2}$/.test(segPeriod || '') ? segPeriod : lastMonth();
  const thisY = new Date().getFullYear();
  const years = [thisY - 1, thisY];

  const r = await api(`/api/report/readiness?years=${years.join(',')}&period=${period}`);
  if (!r.ok) {
    setChildren(view, h('div', { class: 'banner fail' },
      h('h2', { text: '경영진 화면을 불러올 수 없습니다' }),
      h('p', { text: (r.data && (r.data.hint || r.data.error)) || '알 수 없는 오류' })));
    return;
  }
  const X = r.data;

  setChildren(view,
    h('div', { class: 'page-head' },
      h('div', null,
        h('div', { class: 'eyebrow', text: 'ESG 데이터 현황' }),
        h('h1', null, h('span', { class: 'num', text: period }), ' 기준')),
      h('div', { class: 'head-right' },
        h('div', { class: 'chips' },
          h('a', { class: 'chip', href: '#/exec/' + shiftMonth(period, -1), text: '← 이전 달' }),
          h('a', { class: 'chip', href: '#/exec/' + lastMonth(), text: '최신' })))),

    // 지표 1 — 고객사가 지금 물으면 (R38)
    answerCard(X),
    // 지표 2 — 2027 보고서 준비도 (R56)
    readyCard(X, years),
    // 지표 3 — 법인별 신호등
    lightCard(X, period),
    h('p', { class: 'note' },
      '이 화면에는 배출계수·산정방법론·항목별 상세를 두지 않습니다. ',
      '필요하면 조회 화면에서 근거까지 내려갈 수 있습니다 (R37).'));
}

function answerCard(X) {
  const a = X.answer;
  const ready = !!a.answerable_through && a.awaiting_approval === 0;
  return h('div', { class: 'big-stat ' + (ready ? 'ok' : a.answerable_through ? 'warn' : 'bad') },
    h('div', { class: 'big-stat-label',
      text: '고객사가 지금 탄소데이터를 요청하면' }),
    h('div', { class: 'big-stat-value' },
      a.answerable_through
        ? [h('span', { class: 'num', text: a.answerable_through }), ' 까지 즉시 제출 가능']
        : '아직 즉시 제출할 수 있는 기간이 없습니다'),
    h('div', { class: 'big-stat-sub' },
      a.answerable_through
        ? '3법인 모두 확정(2단 승인)을 마친 가장 최근 달입니다. 근거·계수·증빙이 함께 나갑니다.'
        : `확정을 마치지 못한 법인: ${a.not_closed.join(' · ') || '-'}`),
    h('div', { class: 'facts' },
      h('div', { class: 'fact' }, '승인 대기 ',
        h('b', { class: 'num' + (a.awaiting_approval ? ' anom' : ''),
                 text: String(a.awaiting_approval) }), '건'),
      h('div', { class: 'fact' }, '미확보 사유 검토 ',
        h('b', { class: 'num', text: String(a.awaiting_reason_review) }), '건')));
}

function readyCard(X, years) {
  const r = X.readiness;
  const pct = r.pct === null ? 0 : r.pct;
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h3', { text: '2027년 지속가능경영보고서 발간 준비도' }),
      h('span', { class: 'note num', text: `대상 ${years.join(' · ')} · 대외공시 지표 ${r.metrics}개` })),
    h('div', { class: 'gauge' },
      h('div', { class: 'gauge-num num', text: (r.pct === null ? '—' : r.pct) + '%' }),
      h('div', { class: 'gauge-bar' },
        h('div', { class: 'gauge-fill', style: `width:${Math.min(100, pct)}%` })),
      h('div', { class: 'gauge-sub num' },
        `전체 ${r.cells}칸 = 확보 ${r.available} + 일부 확보 ${r.partial}`
        + ` + 미착수 ${r.not_started}`)),
    h('p', { class: 'note' },
      '필수지표(대외공시 등급) × 대상연도 칸 중 확보된 비율입니다. ',
      '일부 확보는 0.5로 계산합니다. 추정치는 포함하지 않습니다.'),
    r.gaps.length
      ? h('details', { class: 'trace' },
          h('summary', { text: `채워야 할 칸 ${r.gap_total}건 중 상위 ${r.gaps.length}건 보기` }),
          h('div', { class: 'chips' },
            r.gaps.map((g) => h('span', { class: 'chip' },
              `${g.year} ${g.code} ${g.name_ko} (${ST_KO[g.state] || g.state})`))))
      : null);
}

function lightCard(X, period) {
  return h('div', { class: 'card flush' },
    h('div', { class: 'card-head' },
      h('h3', null, h('span', { class: 'num', text: period }), ' 법인별 입력 현황')),
    h('div', { class: 'scroll-x' },
      h('table', null,
        h('thead', null, h('tr', null,
          h('th', { text: '법인' }), h('th', { text: '상태' }),
          h('th', { class: 'right', text: '당월 입력' }),
          h('th', { class: 'right', text: '승인 대기' }),
          h('th', { text: '확정 완료 기간' }))),
        h('tbody', null,
          X.entities.map((e) => h('tr', null,
            h('td', null, h('div', { text: e.name_ko }),
              h('div', { class: 'name-sub num', text: e.entity_code })),
            h('td', null, h('span', { class: 'light ' + e.light },
              h('i'), LIGHT[e.light])),
            h('td', { class: 'right num' },
              `${e.month_filled} / ${e.month_expected}`,
              h('div', { class: 'name-sub num',
                text: e.month_pct === null ? '' : e.month_pct + '%' })),
            h('td', { class: 'right num' },
              e.awaiting_approval
                ? h('b', { class: 'anom', text: String(e.awaiting_approval) })
                : '0'),
            h('td', { class: 'num' },
              e.last_closed || h('span', { class: 'unpriced', text: '없음' })))))))); 
}

/* ══════════════════════════════════════════════════════════
   마감 독촉 문구 (R16)
   ══════════════════════════════════════════════════════════ */

async function viewDigest(view) {
  const [segPeriod] = currentRoute().seg;
  const period = /^\d{4}-\d{2}$/.test(segPeriod || '') ? segPeriod : lastMonth();
  const r = await api(`/api/report/digest?period=${period}`);
  if (!r.ok) {
    setChildren(view, h('div', { class: 'banner fail' },
      h('h2', { text: '독촉 목록을 불러올 수 없습니다' }),
      h('p', { text: (r.data && (r.data.hint || r.data.error)) || '알 수 없는 오류' })));
    return;
  }
  const D = r.data;

  setChildren(view,
    h('div', { class: 'page-head' },
      h('div', null,
        h('div', { class: 'eyebrow', text: '마감 독촉' }),
        h('h1', null, h('span', { class: 'num', text: period }), ' 미입력 요청 문구'),
        h('p', { class: 'page-desc' },
          '담당 역할별로 묶어 그대로 붙여넣을 수 있는 문구를 만듭니다. ',
          h('b', { text: '메일·메신저 자동발송은 외부 서비스 계약이 필요하므로 1차 범위에서 제외했습니다' }),
          ' — 10명 규모에서는 복사·붙여넣기가 더 빠르고 유지보수할 것이 없습니다.')),
      h('div', { class: 'head-right' },
        h('div', { class: 'chips' },
          h('a', { class: 'chip', href: '#/digest/' + shiftMonth(period, -1), text: '← 이전 달' }),
          h('a', { class: 'chip', href: '#/digest/' + lastMonth(), text: '최신' })))),

    h('div', { class: 'stats' },
      h('div', { class: 'stat' + (D.total_missing ? ' hot' : '') },
        h('div', { class: 'stat-label', text: '미입력 항목' }),
        h('div', { class: 'stat-value num', text: String(D.total_missing) })),
      h('div', { class: 'stat' },
        h('div', { class: 'stat-label', text: '요청 대상 담당' }),
        h('div', { class: 'stat-value num', text: String(D.groups.length) }))),

    h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h3', { text: '붙여넣을 문구' }),
        h('button', { class: 'chip', text: '복사', onclick: async () => {
          try { await navigator.clipboard.writeText(D.text); toast('복사했습니다'); }
          catch { toast('복사할 수 없습니다. 아래 내용을 직접 선택하세요.', 'fail'); }
        } })),
      h('pre', { text: D.text })),

    D.groups.length
      ? h('div', { class: 'card flush' },
          h('div', { class: 'card-head' }, h('h3', { text: '담당별 미입력' })),
          h('div', { class: 'scroll-x' },
            h('table', null,
              h('thead', null, h('tr', null,
                h('th', { text: '법인' }), h('th', { text: '담당 역할' }),
                h('th', { text: '부담당' }), h('th', { class: 'right', text: '미입력' }),
                h('th', { text: '' }))),
              h('tbody', null,
                D.groups.map((g) => h('tr', null,
                  h('td', { text: g.entity_name }),
                  h('td', null, h('span', { class: 'role-code', text: g.owner_role })),
                  h('td', null, h('span', { class: 'role-code', text: g.backup_role })),
                  h('td', { class: 'right num' },
                    h('b', { class: 'anom', text: String(g.items.length) })),
                  h('td', { class: 'hint',
                    text: g.items.slice(0, 6).map((i) => i.name_ko).join(' · ')
                          + (g.items.length > 6 ? ` 외 ${g.items.length - 6}건` : '') }))))))) 
      : null);
}

/* ── 라우트 등록 ──────────────────────────────────────────── */

ROUTES.query = viewQuery;
ROUTES.databook = async (view) => { await viewDataBook(view); loadSubmissions(); };
ROUTES.exec = viewExec;
ROUTES.digest = viewDigest;
