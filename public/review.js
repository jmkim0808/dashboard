/* 검토 화면 — 입력 현황 보드(S4)와 검증·승인(S5)
 *
 * app.js 의 h() · setChildren() · api() · toast() 를 함께 쓴다. 로드 순서는 index.html 참조.
 *
 * 이 화면이 지키는 원칙
 *   P-4  독촉은 사람이 아니라 시스템이 한다 — 보드가 빈칸을 지목하고 담당 역할까지 보여준다
 *   R55  산출값에서 원본까지 역추적한다 — 산정 요약에서 항목별 계산 내역을 펼쳐 볼 수 있다
 *   R60  이상치는 경고만 — 승인 큐 맨 위로 올리되 승인 자체를 막지 않는다
 *   D-2  미입력과 미확보를 끝까지 다른 색으로 구분한다
 *   R54  2단 확정 없이는 산출물이 고정되지 않는다
 */

/* ── 상태 ─────────────────────────────────────────────────── */

const RV = {
  board: null, queue: null, calc: null, close: null,
  year: null, period: null, entity: null,
  sel: new Set(), returning: null, busy: false,
};

const STATE_KO = {
  empty: '미입력', entered: '입력완료', anomaly: '확인 필요',
  returned: '반송', approved: '승인', closed: '확정', unavailable: '미확보',
};

const BLOCKER_KO = {
  empty: '미입력', not_approved: '승인 대기', returned: '반송 중',
  unavailable_not_approved: '미확보 사유 미검토', no_factor_version: '배출계수 미등록',
};

const RETURN_KO = {
  VALUE_SUSPECT: '값이 이상함', UNIT_SUSPECT: '단위가 의심됨',
  EVIDENCE_MISSING: '증빙 누락', WRONG_PERIOD: '기간이 잘못됨',
};

const RATIO_REASON_KO = {
  missing_source: '원천 항목 미입력', missing_fx: '환율 미등록',
  zero_denominator: '분모가 0',
};

/* ── 공통 ─────────────────────────────────────────────────── */

const thisYear = () => new Date().getFullYear();

/** 이번 달이 아니라 직전 달을 기본값으로 쓴다 — 데이터는 항상 지난 달 것을 모은다 */
function lastPeriod() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function nf(v, digits) {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('ko-KR', {
    minimumFractionDigits: digits === undefined ? 0 : digits,
    maximumFractionDigits: digits === undefined ? 3 : digits,
  });
}

/**
 * 유효숫자 기준 표시.
 * 집약도처럼 0.0000027 같은 값을 소수 4자리로 자르면 화면에 0.0000 이 찍히고,
 * 보는 사람은 "0 이다"와 "산정되지 않았다"를 구별할 수 없다.
 */
function sigText(v, digits = 4) {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  if (Math.abs(n) >= 0.001) return nf(n, digits);
  return n.toPrecision(3).replace(/e([+-])(\d+)/, 'e$1$2');
}

function pctText(p) {
  if (p === null || p === undefined) return '—';
  return (p > 0 ? '+' : '') + nf(p, 1) + '%';
}

function entityPicker(list, current, onPick, allowAll) {
  return h('div', { class: 'chips' },
    (allowAll ? [{ code: '', name_ko: '전체' }] : []).concat(list).map((e) => h('button', {
      class: 'chip' + ((current || '') === e.code ? ' on' : ''),
      text: e.name_ko, onclick: () => onPick(e.code),
    })));
}

/** 월 이동. 주소를 바꿔 새로고침·링크 공유가 되게 한다 */
function periodNav(period, hashOf) {
  const shift = (n) => {
    const [y, m] = period.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  return h('div', { class: 'chips' },
    h('a', { class: 'chip', href: hashOf(shift(-1)), text: '← 이전 달' }),
    h('span', { class: 'chip on num', text: period }),
    h('a', { class: 'chip', href: hashOf(shift(1)), text: '다음 달 →' }));
}

/* ══════════════════════════════════════════════════════════
   화면 — 입력 현황 보드 (S4)
   ══════════════════════════════════════════════════════════ */

async function viewBoard(view) {
  // 주소가 상태다 — 새로고침해도 유지되고 특정 화면 링크를 공유할 수 있다
  const [segYear, segEntity, segPeriod] = currentRoute().seg;
  RV.year = /^\d{4}$/.test(segYear || '') ? Number(segYear) : (RV.year || thisYear());
  RV.entity = segEntity || null;
  RV.period = /^\d{4}-\d{2}$/.test(segPeriod || '') ? segPeriod : null;
  const year = RV.year;
  const q = RV.entity ? `&entity=${encodeURIComponent(RV.entity)}` : '';
  const r = await api(`/api/review/board?year=${year}${q}`);
  if (!r.ok) {
    setChildren(view, h('div', { class: 'banner fail' },
      h('h2', { text: '현황을 불러올 수 없습니다' }),
      h('p', { text: (r.data && (r.data.hint || r.data.error)) || '알 수 없는 오류' })));
    return;
  }
  RV.board = r.data;
  const B = r.data;

  const head = h('div', { class: 'page-head' },
    h('div', null,
      h('div', { class: 'eyebrow', text: '입력 현황' }),
      h('h1', null, h('span', { class: 'num', text: String(year) }), '년 데이터 수집 현황'),
      h('p', { class: 'page-desc' },
        '빈칸이 어디인지, 누구 담당인지 ',
        h('b', { text: '시스템이 지목합니다' }),
        '. 사람이 전화로 확인하고 기억할 필요가 없습니다.')),
    h('div', { class: 'head-right' },
      h('div', { class: 'chips' },
        [year - 1, year, year + 1].map((y) => h('a', {
          class: 'chip' + (y === year ? ' on' : ''),
          href: '#/board/' + y + (RV.entity ? '/' + RV.entity : ''),
          text: String(y) + '년',
        })))));

  setChildren(view, head,
    boardSummary(B),
    boardGaps(B),
    boardEntityPick(B),
    RV.entity ? boardMatrix(B) : null,
    RV.entity ? calcPanel(B) : null);

  if (RV.entity) loadCalc(B);
}

/** 법인 × 월 진행률. 첫 화면에서 "어디가 비었는가"만 보이면 된다 */
function boardSummary(B) {
  const last = lastPeriod();
  const cell = (code, period) => {
    const s = B.summary[`${code}|${period}`];
    if (!s || s.expected === 0) return h('td', { class: 'mx off' });
    // 아직 오지 않은 달을 "미입력"이라고 부르지 않는다.
    // 화면이 매년 1월에 빨간칸 11개로 시작하면 아무도 이 화면을 보지 않게 된다.
    const future = period > last && s.filled === 0;
    const cls = future ? 'mx off'
      : s.empty > 0 ? 'mx warn'
      : s.pending > 0 ? 'mx mid'
      : s.closed === s.expected ? 'mx done'
      : 'mx ok';
    const title = `${code} ${period}\n`
      + (future ? '수집 예정\n' : '')
      + `입력 대상 ${s.expected} · 미입력 ${s.empty} · 승인대기 ${s.entered}`
      + ` · 승인 ${s.approved} · 확정 ${s.closed} · 미확보 ${s.unavailable}`;
    return h('td', { class: cls, title },
      h('a', { class: 'mx-link', href: `#/board/${B.year}/${code}` },
        h('div', { class: 'mx-pct num', text: future ? '·' : nf(s.pct, 0) + '%' }),
        h('div', { class: 'mx-sub num' },
          future ? '예정'
            : s.empty > 0 ? `빈칸 ${s.empty}`
            : s.entered > 0 ? `대기 ${s.entered}` : '완료')));
  };

  return h('div', { class: 'card flush' },
    h('div', { class: 'card-head' },
      h('h3', { text: '법인 × 월 진행률' }),
      h('span', { class: 'note', text: '칸을 누르면 그 법인의 항목별 현황으로 이동합니다' })),
    h('div', { class: 'scroll-x' },
      h('table', { class: 'matrix' },
        h('thead', null, h('tr', null,
          h('th', { class: 'sticky-col', text: '법인' }),
          B.months.map((m) => h('th', { class: 'num', text: m.slice(5) + '월' })))),
        h('tbody', null,
          B.entities.map((e) => h('tr', null,
            h('th', { class: 'sticky-col' },
              h('div', { text: e.name_ko }),
              h('div', { class: 'name-sub num', text: e.code })),
            B.months.map((m) => cell(e.code, m))))))),
    h('div', { class: 'legend' },
      h('span', null, h('i', { class: 'sw warn' }), '미입력 있음'),
      h('span', null, h('i', { class: 'sw mid' }), '승인·검토 대기'),
      h('span', null, h('i', { class: 'sw ok' }), '승인 완료'),
      h('span', null, h('i', { class: 'sw done' }), '확정'),
      h('span', null, h('i', { class: 'sw off' }), '수집 예정 · 대상 아님')));
}

/** 미입력 지목. 보드의 존재 이유다 (P-4) */
function boardGaps(B) {
  const gaps = [];
  for (const e of B.entities) {
    for (const m of B.months) {
      const s = B.summary[`${e.code}|${m}`];
      if (!s || s.expected === 0 || s.empty === 0) continue;
      // 아직 안 온 달을 미입력이라고 부르지 않는다
      if (m > lastPeriod()) continue;
      gaps.push({ entity: e.code, name: e.name_ko, period: m, empty: s.empty, of: s.expected });
    }
  }
  gaps.sort((a, b) => (a.period < b.period ? 1 : -1));

  if (gaps.length === 0) {
    return h('div', { class: 'banner ok' },
      h('h2', { text: '지난 달까지 빈칸이 없습니다' }),
      h('p', { text: '수집 대상 항목이 모두 입력 또는 미확보 처리되었습니다.' }));
  }

  return h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h3', { text: '채워야 할 칸' }),
      h('span', { class: 'note', text: '지난 달까지 기준 · 최근 순' })),
    h('div', { class: 'scroll-x' },
      h('table', null,
        h('thead', null, h('tr', null,
          h('th', { text: '대상 월' }), h('th', { text: '법인' }),
          h('th', { class: 'right', text: '미입력' }), h('th', { text: '' }))),
        h('tbody', null,
          gaps.slice(0, 12).map((g) => h('tr', null,
            h('td', { class: 'num', text: g.period }),
            h('td', { text: g.name }),
            h('td', { class: 'right num' },
              h('b', { class: 'anom', text: String(g.empty) }), ` / ${g.of}`),
            h('td', { class: 'right' },
              h('a', { class: 'chip',
                href: g.entity === 'HQ' ? `#/input/${g.period}` : `#/sheet/${g.entity}/${g.period}`,
                text: '입력 화면 열기' }))))))));
}

function boardEntityPick(B) {
  return h('div', { class: 'page-head tight' },
    h('div', null, h('h2', { text: '항목별 현황' }),
      h('p', { class: 'page-desc', text: '법인을 고르면 항목 × 월 표가 나옵니다.' })),
    h('div', { class: 'head-right' },
      // 자기 법인만 볼 수 있는 담당자에게 "전체"를 보여주면 눌러도 자기 법인으로 되돌아온다
      entityPicker(B.entities, RV.entity,
        (code) => { location.hash = '#/board/' + B.year + (code ? '/' + code : ''); },
        !!(S.me && S.me.can && S.me.can.all_entities))));
}

/** 항목 × 월 매트릭스 */
function boardMatrix(B) {
  if (B.rows.length === 0) {
    return h('div', { class: 'banner warn' },
      h('h2', { text: '수집 대상 항목이 없습니다' }),
      h('p', { text: '기준정보 → 담당 배정에서 이 법인에 항목이 배정되어 있는지 확인하세요.' }));
  }
  const last = lastPeriod();
  const cell = (row, period) => {
    const c = row.cells[period];
    if (!c) return h('td', { class: 'mx off', title: `${period} 수집 대상 아님` });
    if (c.state === 'empty' && period > last) {
      return h('td', { class: 'mx off', title: `${period} 수집 예정` },
        h('span', { class: 'mx-v num', text: '·' }));
    }
    const cls = c.state === 'empty' ? 'mx warn'
      : c.state === 'anomaly' ? 'mx anomaly'
      : c.state === 'returned' ? 'mx returned'
      : c.state === 'unavailable' ? (c.approved ? 'mx unav-ok' : 'mx unav')
      : c.state === 'closed' ? 'mx done' : c.state === 'approved' ? 'mx ok' : 'mx mid';
    const reasonKo = c.reason ? ((B.reason_labels || {})[c.reason] || c.reason) : null;
    const label = c.state === 'unavailable' ? (reasonKo || '미확보')
      : c.value === null ? STATE_KO[c.state]
      : nf(c.value, 1);
    return h('td', { class: cls,
      title: `${row.metric_code} ${period}\n${STATE_KO[c.state]}`
             + (c.value !== null ? `\n값 ${nf(c.value, 3)} ${row.unit_input}` : '')
             + (reasonKo ? `\n사유 ${reasonKo}` : '')
             + (c.anomaly_pct !== null && c.anomaly_pct !== undefined
                ? `\n전기 대비 ${pctText(c.anomaly_pct)}` : '')
             + (c.closed ? '\n확정됨' : c.approved ? '\n승인됨' : '') },
      h('span', { class: 'mx-v num', text: String(label) }));
  };

  return h('div', { class: 'card flush' },
    h('div', { class: 'card-head' },
      h('h3', null, (B.entities.find((e) => e.code === B.entity_code) || {}).name_ko,
        ' · 항목 × 월'),
      h('span', { class: 'note num', text: `${B.rows.length}개 항목` })),
    h('div', { class: 'scroll-x' },
      h('table', { class: 'matrix tight' },
        h('thead', null, h('tr', null,
          h('th', { class: 'sticky-col', text: '항목' }),
          B.months.map((m) => h('th', { class: 'num', text: m.slice(5) })))),
        h('tbody', null,
          B.rows.map((row) => h('tr', null,
            h('th', { class: 'sticky-col' },
              h('div', { class: 'name-main', text: row.name_ko }),
              h('div', { class: 'name-sub num' }, row.metric_code, ' · ', row.unit_input,
                ' · ', h('span', { class: 'role-code', text: row.owner_role }))),
            B.months.map((m) => cell(row, m))))))),
    h('div', { class: 'legend' },
      h('span', null, h('i', { class: 'sw warn' }), '미입력'),
      h('span', null, h('i', { class: 'sw mid' }), '입력완료'),
      h('span', null, h('i', { class: 'sw anomaly' }), '확인 필요'),
      h('span', null, h('i', { class: 'sw returned' }), '반송'),
      h('span', null, h('i', { class: 'sw unav' }), '미확보'),
      h('span', null, h('i', { class: 'sw ok' }), '승인'),
      h('span', null, h('i', { class: 'sw done' }), '확정')));
}

/* ── 산정 요약 ─────────────────────────────────────────────── */

/** 산정 패널 — 월을 고르면 그 달의 산정 결과가 나온다. 주소에 월이 남는다 */
function calcPanel(B) {
  const current = RV.period || lastPeriod();
  const last = lastPeriod();
  const choices = B.months.filter((m) => m <= last || m === current);
  return h('div', null,
    h('div', { class: 'page-head tight' },
      h('div', null, h('h2', { text: '배출량 · 에너지 산정' }),
        h('p', { class: 'page-desc', text: '월을 고르면 그 달의 산정 결과와 계산 내역이 나옵니다.' })),
      h('div', { class: 'head-right' },
        h('div', { class: 'chips' },
          choices.map((m) => h('a', {
            class: 'chip' + (m === current ? ' on' : ''),
            href: `#/board/${B.year}/${B.entity_code}/${m}`,
            text: m.slice(5) + '월',
          }))))),
    h('div', { class: 'card', id: 'calc-panel' },
      h('p', { class: 'note', text: '산정 중…' })));
}

async function loadCalc(B) {
  const period = RV.period || lastPeriod();
  const r = await api(`/api/calc/month?entity=${encodeURIComponent(B.entity_code)}`
                      + `&period=${encodeURIComponent(period)}`);
  const box = document.getElementById('calc-panel');
  if (!box) return;
  if (!r.ok) {
    setChildren(box,
      h('div', { class: 'card-head' }, h('h3', { text: '배출량 · 에너지 산정' })),
      h('p', { class: 'note', text: (r.data && (r.data.hint || r.data.error)) || '산정할 수 없습니다.' }));
    return;
  }
  const c = r.data;
  setChildren(box, calcBody(c, B));
}

function calcBody(c) {
  const res = c.results;
  const stat = (label, value, unit) => h('div', { class: 'stat' },
    h('div', { class: 'stat-label', text: label }),
    h('div', { class: 'stat-value num' }, nf(value, 3),
      h('span', { class: 'unit-pill sm', text: unit })));

  return [
    h('div', { class: 'card-head' },
      h('h3', null, h('span', { class: 'num', text: c.period }), ' 산정 결과'),
      h('span', { class: 'note num' }, '계수 ', c.version, ' · 지역 ', c.grid_region)),
    h('div', { class: 'stats' },
      stat('Scope 1 (직접)', res.scope1, 'tCO2eq'),
      stat('Scope 2 (전력·스팀)', res.scope2, 'tCO2eq'),
      stat('합계', res.scope12, 'tCO2eq'),
      stat('에너지', res.energy_tj, 'TJ'),
      stat('에너지', res.energy_toe, 'TOE')),
    c.pending_approval > 0
      ? h('div', { class: 'banner warn slim' },
          h('p', null, '승인되지 않은 입력값 ',
            h('b', { class: 'num', text: String(c.pending_approval) }), '건이 포함된 잠정값입니다. ',
            '확정 후의 값과 달라질 수 있습니다.'))
      : null,
    c.unpriced.length > 0
      ? h('div', { class: 'banner warn slim' },
          h('p', null, h('b', { text: '미산정 ' + c.unpriced.length + '건' }),
            ' — 배출계수가 등록되지 않은 항목입니다. ',
            h('b', { text: '합계에 0 으로 들어가지 않았습니다.' }),
            ' 계수를 등록하면 자동으로 합산됩니다.'),
          h('div', { class: 'chips' },
            c.unpriced.map((u) => h('span', { class: 'chip', title: u.factor_type },
              u.metric_code, ' ', u.name_ko, ' (', nf(u.value, 1), ')'))))
      : null,
    // R55 — 산출값에서 원본까지 역추적
    h('details', { class: 'trace' },
      h('summary', { text: '계산 내역 보기 (입력값 → 표준단위 → 배분 → 배출량)' }),
      h('div', { class: 'scroll-x' },
        h('table', null,
          h('thead', null, h('tr', null,
            h('th', { text: '항목' }), h('th', { class: 'right', text: '입력값' }),
            h('th', { class: 'right', text: '× 단위환산' }), h('th', { class: 'right', text: '표준단위' }),
            h('th', { class: 'right', text: '× 배분율' }), h('th', { class: 'right', text: '× 배출계수' }),
            h('th', { class: 'right', text: 'tCO2eq' }))),
          h('tbody', null,
            c.lines.map((l) => h('tr', null,
              h('td', null,
                h('div', { class: 'name-main', text: l.name_ko }),
                h('div', { class: 'name-sub num' }, l.metric_code,
                  l.ghg_scope ? ` · Scope ${l.ghg_scope}` : '',
                  l.allocation_basis ? ` · 임대 배분(${l.allocation_basis})` : '')),
              h('td', { class: 'right num', text: nf(l.value_raw, 3) }),
              h('td', { class: 'right num', text: l.to_standard === 1 ? '—' : nf(l.to_standard, 0) }),
              h('td', { class: 'right num' }, nf(l.standard, 1),
                h('span', { class: 'unit-pill sm', text: l.unit_standard })),
              h('td', { class: 'right num', text: l.allocation_ratio === 1 ? '—' : nf(l.allocation_ratio, 3) }),
              h('td', { class: 'right num', text: l.emission_factor ? String(l.emission_factor) : '—' }),
              h('td', { class: 'right num', text: l.tco2 === undefined ? '—' : nf(l.tco2, 4) }))))))),
    c.excluded.length > 0
      ? h('p', { class: 'note' }, '산정 제외 ',
          h('b', { class: 'num', text: String(c.excluded.length) }), '건 (미입력·미확보) — ',
          c.excluded.map((x) => x.metric_code).join(' · '))
      : null,
  ];
}

/* ══════════════════════════════════════════════════════════
   화면 — 검증 · 승인 (S5)
   ══════════════════════════════════════════════════════════ */

async function viewReview(view) {
  const [segPeriod, segEntity] = currentRoute().seg;
  RV.period = /^\d{4}-\d{2}$/.test(segPeriod || '') ? segPeriod : (RV.period || lastPeriod());
  RV.entity = segEntity || null;
  const period = RV.period;
  const q = RV.entity ? `&entity=${encodeURIComponent(RV.entity)}` : '';
  const [qr, br] = await Promise.all([
    api(`/api/review/queue?period=${encodeURIComponent(period)}${q}`),
    api(`/api/review/board?year=${period.slice(0, 4)}`),
  ]);
  if (!qr.ok) {
    setChildren(view, h('div', { class: 'banner fail' },
      h('h2', { text: '승인 목록을 불러올 수 없습니다' }),
      h('p', { text: (qr.data && (qr.data.hint || qr.data.error)) || '알 수 없는 오류' })));
    return;
  }
  RV.queue = qr.data;
  const Q = qr.data;
  const entities = br.ok ? br.data.entities : [];
  const hashOf = (p) => '#/review/' + p + (RV.entity ? '/' + RV.entity : '');

  const head = h('div', { class: 'page-head' },
    h('div', null,
      h('div', { class: 'eyebrow', text: '검증 · 승인' }),
      h('h1', null, h('span', { class: 'num', text: period }), ' 입력값 검토'),
      h('p', { class: 'page-desc' },
        '전기 대비 변동이 큰 항목이 ', h('b', { text: '맨 위' }), '로 올라옵니다. ',
        '이상치는 승인을 막지 않습니다 — 확인하고 넘기는 것도 판단입니다.')),
    h('div', { class: 'head-right' }, periodNav(period, hashOf)));

  const filter = h('div', { class: 'page-head tight' },
    h('div', null, h('h2', { text: '승인 대기' })),
    h('div', { class: 'head-right' },
      entityPicker(entities, RV.entity,
        (code) => { location.hash = '#/review/' + period + (code ? '/' + code : ''); },
        true)));

  setChildren(view, head,
    h('div', { class: 'stats' },
      h('div', { class: 'stat' },
        h('div', { class: 'stat-label', text: '승인 대기' }),
        h('div', { class: 'stat-value num', text: String(Q.total) })),
      h('div', { class: 'stat' + (Q.anomalies ? ' hot' : '') },
        h('div', { class: 'stat-label', text: '확인 필요 (이상치)' }),
        h('div', { class: 'stat-value num', text: String(Q.anomalies) })),
      h('div', { class: 'stat' },
        h('div', { class: 'stat-label', text: '증빙 없음' }),
        h('div', { class: 'stat-value num', text: String(Q.evidence_missing) })),
      h('div', { class: 'stat' },
        h('div', { class: 'stat-label', text: '미확보 (사유 검토)' }),
        h('div', { class: 'stat-value num', text: String(Q.unavailable) }))),
    filter,
    queueTable(Q),
    closePanel(period, entities));
}

function queueTable(Q) {
  if (Q.items.length === 0) {
    return h('div', { class: 'banner ok' },
      h('h2', { text: '승인할 항목이 없습니다' }),
      h('p', { text: '이 기간의 입력값은 모두 승인되었거나, 아직 입력되지 않았습니다.' }));
  }

  const rowKey = (i) => `${i.entity_code}|${i.metric_code}|${i.period}`;
  const allOn = Q.items.every((i) => RV.sel.has(rowKey(i)));

  const toggleAll = () => {
    if (allOn) RV.sel.clear();
    else Q.items.forEach((i) => RV.sel.add(rowKey(i)));
    route();
  };

  return h('div', { class: 'card flush' },
    h('div', { class: 'card-head' },
      h('h3', null, '대기 ', h('span', { class: 'num', text: String(Q.total) }), '건'),
      h('div', { class: 'head-right' },
        h('button', { class: 'chip', onclick: toggleAll,
          text: allOn ? '전체 해제' : '전체 선택' }),
        h('button', {
          class: 'primary', disabled: RV.sel.size === 0 || RV.busy,
          text: RV.busy ? '승인 중…' : `선택 ${RV.sel.size}건 승인`,
          onclick: () => doApprove(Q),
        }))),
    h('div', { class: 'scroll-x' },
      h('table', null,
        h('thead', null, h('tr', null,
          h('th', { class: 'pick' }), h('th', { text: '법인' }), h('th', { text: '항목' }),
          h('th', { class: 'right', text: '입력값' }), h('th', { class: 'right', text: '전기' }),
          h('th', { class: 'right', text: '변동' }), h('th', { text: '증빙' }),
          h('th', { class: 'right', text: '' }))),
        h('tbody', null,
          Q.items.map((i) => queueRow(i, rowKey(i)))))),
    RV.returning ? returnBox(RV.returning) : null);
}

/** 미확보 사유 코드를 사람이 읽는 말로. 라벨이 없으면 코드를 그대로 보여준다 */
function reasonLabel(code) {
  if (!code) return '';
  const map = (RV.queue && RV.queue.reason_labels) || {};
  return map[code] || code;
}

function queueRow(i, key) {
  const on = RV.sel.has(key);
  const flag = i.anomaly && i.anomaly.flag;
  return h('tr', { class: (on ? 'sel ' : '') + (flag ? 'anom-row' : '') },
    h('td', { class: 'pick' }, h('input', {
      type: 'checkbox', checked: on,
      onchange: (ev) => { if (ev.target.checked) RV.sel.add(key); else RV.sel.delete(key); route(); },
    })),
    h('td', { class: 'nowrap' }, h('div', { text: i.entity_name }),
      h('div', { class: 'name-sub num', text: i.entity_code })),
    // 산정 정의는 툴팁으로 둔다. 49행 × 3줄이면 아무도 읽지 않는 화면이 된다
    h('td', { title: i.definition_ko },
      h('div', { class: 'name-main', text: i.name_ko }),
      h('div', { class: 'name-sub num' }, i.metric_code, ' · ', i.period,
        i.is_retro ? ' · 소급입력' : '',
        i.entered_by_role ? [' · ', h('span', { class: 'role-code', text: i.entered_by_role })] : '')),
    h('td', { class: 'right num' },
      i.status === 'unavailable'
        ? h('span', { class: 'badge unav', text: '미확보 · ' + reasonLabel(i.unavailable_reason_code) })
        : [nf(i.value_raw, 3), h('span', { class: 'unit-pill sm', text: i.unit_raw || i.unit_standard })]),
    h('td', { class: 'right num' },
      i.prev_value === null ? h('span', { class: 'note', text: '기준 없음' }) : nf(i.prev_value, 3)),
    h('td', { class: 'right num' },
      flag
        ? h('b', { class: 'anom' },
            i.anomaly.kind === 'new_occurrence' ? '신규 발생' : pctText(i.anomaly.pct))
        : pctText(i.anomaly ? i.anomaly.pct : null)),
    h('td', null,
      i.evidence_policy === 'none'
        ? h('span', { class: 'note', text: '해당 없음' })
        : i.evidence_count > 0
          ? h('span', { class: 'badge ok', text: `첨부 ${i.evidence_count}` })
          : h('span', { class: 'badge warn', text: '없음' })),
    h('td', { class: 'right act-col' },
      h('div', { class: 'act-inline' },
        h('button', { class: 'chip', text: '승인', disabled: RV.busy,
          onclick: () => doApprove(null, [i]) }),
        i.status === 'unavailable' ? null : h('button', { class: 'chip', text: '반송',
          onclick: () => { RV.returning = i; route(); } }))));
}

function returnBox(i) {
  return h('div', { class: 'editing-card' },
    h('div', { class: 'editor-title' },
      h('h3', null, '반송 — ', i.name_ko, ' ',
        h('span', { class: 'num', text: `${i.entity_code} ${i.period}` })),
      h('button', { class: 'chip', text: '닫기',
        onclick: () => { RV.returning = null; route(); } })),
    h('p', { class: 'note' },
      '반송 사유는 담당자 입력 화면에 그대로 표시됩니다. ',
      '자유 입력칸을 두지 않는 이유는 사유를 나중에 집계해야 하기 때문입니다 (R87).'),
    h('div', { class: 'chips' },
      Object.entries(RETURN_KO).map(([code, label]) => h('button', {
        class: 'chip', text: label, onclick: () => doReturn(i, code),
      }))));
}

async function doApprove(Q, items) {
  const list = items || (Q || RV.queue).items.filter(
    (i) => RV.sel.has(`${i.entity_code}|${i.metric_code}|${i.period}`));
  if (list.length === 0) return;
  RV.busy = true;
  const r = await api('/api/review/approve', 'POST', {
    items: list.map((i) => ({ entity_code: i.entity_code, metric_code: i.metric_code,
                              period: i.period })),
  });
  RV.busy = false;
  if (!r.ok) { fail(r, '승인에 실패했습니다'); route(); return; }
  const d = r.data;
  const skipped = (d.skipped || []).length;
  toast(`승인 ${d.approved}건` + (skipped ? ` · 건너뜀 ${skipped}건` : ''),
        skipped ? 'warn' : 'ok');
  if (skipped) {
    for (const s of d.skipped.slice(0, 3)) {
      console.warn('승인 건너뜀', s);
    }
  }
  RV.sel.clear();
  route();
}

async function doReturn(i, reasonCode) {
  const r = await api('/api/review/return', 'POST', {
    entity_code: i.entity_code, metric_code: i.metric_code, period: i.period,
    return_reason: reasonCode,
  });
  if (!r.ok) { fail(r, '반송에 실패했습니다'); return; }
  toast(`${i.name_ko} 반송 — ${RETURN_KO[reasonCode]}`);
  RV.returning = null;
  RV.sel.delete(`${i.entity_code}|${i.metric_code}|${i.period}`);
  route();
}

/* ── 2단 확정 ──────────────────────────────────────────────── */

function closePanel(period, entities) {
  const can = (S.me && S.me.can && S.me.can.close) || (RV.queue && RV.queue.can_close);
  const list = RV.entity ? entities.filter((e) => e.code === RV.entity) : entities;

  return h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h3', null, h('span', { class: 'num', text: period }), ' 기간 확정'),
      h('span', { class: 'note', text: can ? '파트장 권한' : '확정 권한 없음 (조회만)' })),
    h('p', { class: 'note' },
      '확정하면 그 기간의 입력값이 잠기고, ',
      h('b', { text: '적용한 배출계수 버전과 함께 산출값이 저장됩니다' }),
      '. 계수가 개정되어도 확정된 과거 산출물은 그대로 재현됩니다 (D-3).'),
    h('div', { class: 'stack' },
      list.map((e) => h('div', { class: 'row', id: 'close-' + e.code },
        h('div', null, h('b', { text: e.name_ko }),
          h('span', { class: 'name-sub num', text: ' ' + e.code })),
        h('div', { class: 'head-right' },
          h('button', { class: 'chip', text: '사전점검',
            onclick: () => doClose(e.code, period, true) }),
          can ? h('button', { class: 'primary', text: '확정',
            onclick: () => doClose(e.code, period, false) }) : null)))),
    h('div', { id: 'close-result' }, RV.close ? closeResult(RV.close) : null));
}

function closeResult(d) {
  if (d.blockers && d.blockers.length) {
    return h('div', { class: 'banner warn' },
      h('h2', null, d.entity_code, ' ', d.period, ' — 확정할 수 없습니다'),
      h('div', { class: 'scroll-x' },
        h('table', null,
          h('thead', null, h('tr', null,
            h('th', { text: '막고 있는 것' }), h('th', { class: 'right', text: '건수' }),
            h('th', { text: '해야 할 일' }))),
          h('tbody', null,
            d.blockers.map((b) => h('tr', null,
              h('td', { text: BLOCKER_KO[b.kind] || b.kind }),
              h('td', { class: 'right num', text: String(b.count) }),
              h('td', { class: 'hint', text: b.hint || '' })))))));
  }
  if (d.dry_run) {
    return h('div', { class: 'banner ok' },
      h('h2', null, d.entity_code, ' ', d.period, ' — 확정 가능'),
      h('p', null, '입력 대상 ',
        h('b', { class: 'num', text: String(d.progress.expected) }), '건 중 값 ',
        h('b', { class: 'num', text: String(d.progress.approved) }), '건 · 미확보 ',
        h('b', { class: 'num', text: String(d.progress.unavailable) }), '건이 모두 승인되었습니다.'));
  }
  return h('div', { class: 'banner ok' },
    h('h2', null, d.entity_code, ' ', d.period, ' 확정 완료'),
    h('p', null, '값 ', h('b', { class: 'num', text: String(d.closed) }), '건 · 미확보 ',
      h('b', { class: 'num', text: String(d.closed_unavailable) }), '건 · 계수 ',
      h('b', { class: 'num', text: d.factor_version })),
    h('div', { class: 'stats' },
      [['Scope 1', d.results.scope1, 'tCO2eq'], ['Scope 2', d.results.scope2, 'tCO2eq'],
       ['합계', d.results.scope12, 'tCO2eq'], ['에너지', d.results.energy_tj, 'TJ'],
       ['에너지', d.results.energy_toe, 'TOE']].map(([label, v, unit]) =>
        h('div', { class: 'stat' },
          h('div', { class: 'stat-label', text: label }),
          h('div', { class: 'stat-value num' }, nf(v, 3),
            h('span', { class: 'unit-pill sm', text: unit }))))),
    (d.unpriced || []).length
      ? h('p', { class: 'note' }, '미산정 ',
          h('b', { class: 'num', text: String(d.unpriced.length) }), '건 — ',
          d.unpriced.map((u) => u.metric_code).join(' · '),
          ' (계수 등록 후 재산정하면 합산됩니다)')
      : null);
}

async function doClose(entityCode, period, dryRun) {
  const r = await api('/api/review/close', 'POST',
    { entity_code: entityCode, period, dry_run: dryRun || undefined });
  RV.close = r.data && r.data.entity_code ? r.data : null;
  if (!RV.close) { fail(r, '확정 처리에 실패했습니다'); return; }
  if (!dryRun && r.ok) toast(`${entityCode} ${period} 확정 완료`);
  const box = document.getElementById('close-result');
  if (box) setChildren(box, closeResult(RV.close));
  else route();
}

/* ══════════════════════════════════════════════════════════
   화면 — 연간 집계 요약 (W4 경영진 화면의 원형)
   ══════════════════════════════════════════════════════════ */

async function viewYear(view) {
  const [segYear] = currentRoute().seg;
  RV.year = /^\d{4}$/.test(segYear || '') ? Number(segYear) : (RV.year || thisYear());
  const year = RV.year;
  const r = await api(`/api/calc/year?year=${year}`);
  if (!r.ok) {
    setChildren(view, h('div', { class: 'banner fail' },
      h('h2', { text: '연간 집계를 불러올 수 없습니다' }),
      h('p', { text: (r.data && (r.data.hint || r.data.error)) || '알 수 없는 오류' })));
    return;
  }
  const Y = r.data;

  setChildren(view,
    h('div', { class: 'page-head' },
      h('div', null,
        h('div', { class: 'eyebrow', text: '연간 집계' }),
        h('h1', null, h('span', { class: 'num', text: String(year) }), '년 3법인 합산'),
        h('p', { class: 'page-desc' },
          '지금까지 입력된 값으로 계산한 ', h('b', { text: '잠정 집계' }), '입니다. ',
          '계수 ', h('span', { class: 'num', text: Y.version }),
          ' · 산정한 법인·월 ', h('span', { class: 'num', text: String(Y.months_computed) }), '건')),
      h('div', { class: 'head-right' },
        h('div', { class: 'chips' },
          [year - 1, year].map((y) => h('a', {
            class: 'chip' + (y === year ? ' on' : ''),
            href: '#/year/' + y, text: String(y) + '년',
          }))))),

    h('div', { class: 'card flush' },
      h('div', { class: 'card-head' }, h('h3', { text: '배출량 · 에너지' }),
        h('span', { class: 'note', text: '법인별 값을 더하면 합계가 나옵니다 (반올림 후 누적)' })),
      h('div', { class: 'scroll-x' },
        h('table', null,
          h('thead', null, h('tr', null,
            h('th', { text: '법인' }),
            h('th', { class: 'right', text: 'Scope 1' }), h('th', { class: 'right', text: 'Scope 2' }),
            h('th', { class: 'right', text: '합계 (tCO2eq)' }),
            h('th', { class: 'right', text: '에너지 (TJ)' }), h('th', { class: 'right', text: 'TOE' }),
            h('th', { text: '1,000 TOE 판정' }))),
          h('tbody', null,
            Y.entities.map((e) => h('tr', null,
              h('td', null, h('div', { text: e.name_ko }),
                h('div', { class: 'name-sub num', text: e.entity_code + ' · ' + e.grid_region })),
              h('td', { class: 'right num', text: nf(e.scope1, 3) }),
              h('td', { class: 'right num', text: nf(e.scope2, 3) }),
              h('td', { class: 'right num' }, h('b', { text: nf(e.scope12, 3) })),
              h('td', { class: 'right num', text: nf(e.energy_tj, 4) }),
              h('td', { class: 'right num', text: nf(e.energy_toe, 2) }),
              h('td', null, toeBadge(e.toe_threshold)))),
            h('tr', { class: 'total' },
              h('td', null, h('b', { text: '3법인 합산' })),
              h('td', { class: 'right num', text: nf(Y.group.scope1, 3) }),
              h('td', { class: 'right num', text: nf(Y.group.scope2, 3) }),
              h('td', { class: 'right num' }, h('b', { text: nf(Y.group.scope12, 3) })),
              h('td', { class: 'right num', text: nf(Y.group.energy_tj, 4) }),
              h('td', { class: 'right num', text: nf(Y.group.energy_toe, 2) }),
              h('td', null))))),
      Y.unpriced.length
        ? h('div', { class: 'banner warn slim' },
            h('p', null, h('b', { text: '미산정 ' + Y.unpriced.length + '건' }),
              ' — 계수 미등록 항목은 0 으로 취급되지 않았습니다: ',
              Y.unpriced.map((u) => `${u.entity_code} ${u.metric_code}`).join(' · ')))
        : null),

    h('div', { class: 'card flush' },
      h('div', { class: 'card-head' }, h('h3', { text: '비율 · 집약도 지표' }),
        h('span', { class: 'note', text: '분자·분모를 각각 합산한 뒤 나눕니다 (법인별 값의 평균이 아닙니다)' })),
      h('div', { class: 'scroll-x' },
        h('table', null,
          h('thead', null, h('tr', null,
            h('th', { text: '지표' }), h('th', { class: 'right', text: '3법인' }),
            Y.entities.map((e) => h('th', { class: 'right', text: e.name_ko })),
            h('th', { text: '' }))),
          h('tbody', null,
            Y.ratios.map((rt) => h('tr', null,
              h('td', null, h('div', { class: 'name-main', text: rt.name_ko }),
                h('div', { class: 'name-sub num' }, rt.code, ' · ', rt.unit)),
              h('td', { class: 'right num' },
                rt.value === null ? h('span', { class: 'note', text: '미산정' })
                                  : h('b', { text: sigText(rt.value) })),
              Y.entities.map((e) => {
                const one = (Y.ratios_by_entity[e.entity_code] || [])
                  .find((x) => x.code === rt.code);
                return h('td', { class: 'right num',
                  text: one && one.value !== null ? sigText(one.value) : '—' });
              }),
              rt.reason
                ? h('td', null, h('span', { class: 'hint' },
                    (RATIO_REASON_KO[rt.reason] || rt.reason)
                    + (rt.missing.length ? ` — ${rt.missing.join(' · ')}` : '')
                    + (rt.missing_fx && rt.missing_fx.length
                       ? ` — ${rt.missing_fx.join(' · ')}` : '')))
                : h('td', { class: 'note num',
                    text: `분자 ${nf(rt.numerator, 2)} ÷ 분모 ${nf(rt.denominator, 2)}` }))))))));
}

function toeBadge(t) {
  if (!t) return null;
  if (t.exceeded) return h('span', { class: 'badge warn', text: '초과 — 현지 법정 보고 대상' });
  if (t.near) return h('span', { class: 'badge warn', text: '임계 근접 (80% 이상)' });
  return h('span', { class: 'badge ok' }, nf(t.ratio * 100, 1), '%');
}

/* ── 라우트 등록 ──────────────────────────────────────────── */

ROUTES.board = viewBoard;
ROUTES.review = viewReview;
ROUTES.year = viewYear;
