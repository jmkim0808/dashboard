/* 파워넷 ESG 데이터 입력플랫폼 — 화면 로직
 *
 * 의존성 없는 vanilla JS. 빌드 단계가 없으므로 파일을 고치고 배포하면 끝이다.
 * innerHTML 을 쓰지 않는다 — 모든 노드는 h() 로 만든다.
 */

/* ── 유틸 ─────────────────────────────────────────────────── */

function h(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'value') n.value = v;
      else if (k === 'checked') n.checked = !!v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
      else n.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const kid of kids.flat(3)) {
    if (kid === null || kid === undefined || kid === false) continue;
    n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    cache: 'no-store',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* 본문 없음 */ }
  return { ok: res.ok, status: res.status, data };
}

let toastTimer = null;
function toast(message, kind = 'ok') {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = h('div', { class: 'toast ' + kind, text: message });
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), kind === 'ok' ? 2600 : 6000);
}

function fail(result, fallback) {
  const d = result.data || {};
  toast(d.hint || d.message || d.error || fallback, 'fail');
}

const NUM = (v) => h('b', { class: 'num', text: String(v) });
const fact = (label, value) => h('div', { class: 'fact' }, label + ' ', NUM(value));

const CAT_KO = { E: '환경', S: '사회', PROD: '생산', G: '지배구조' };
const PERIOD_KO = { monthly: '월', quarterly: '분기', annual: '연' };
const AGG_KO = { sum: '합계', avg: '평균', eop: '기말값' };
const DISC_KO = { internal: '내부전용', customer: '고객사제출', public: '대외공시' };
const STATUS_KO = { ok: '정상', warn: '주의', fail: '실패', load: '확인 중' };

/* ── 상태 ─────────────────────────────────────────────────── */

const S = { master: null, tab: 'metrics', entity: 'HQ', cat: 'all', editing: null, audit: null };

/* ── 라우터 ───────────────────────────────────────────────── */

const ROUTES = { master: viewMaster, health: viewHealth };

function currentRoute() {
  const parts = (location.hash || '#/master').replace(/^#\//, '').split('/').filter(Boolean);
  const name = ROUTES[parts[0]] ? parts[0] : 'master';
  return { name, tab: parts[1] || null, ctx: parts[2] || null, item: parts[3] || null };
}

/** 지금 상태를 주소로 만든다. 새로고침해도 유지되고 링크를 공유할 수 있다 */
function hashFor(tab, ctx, item) {
  return '#/master/' + [tab, ctx, item].filter(Boolean).join('/');
}

async function route() {
  const { name, tab, ctx, item } = currentRoute();
  // 탭 · 필터 · 편집 대상을 주소에서 읽는다
  if (name === 'master') {
    if (tab && TABS.some(([k]) => k === tab)) S.tab = tab;
    if (S.tab === 'metrics') {
      S.cat = ctx || 'all';
      S.editing = item || null;
    } else if (S.tab === 'assign') {
      S.entity = ctx || S.entity;
      S.editing = null;
    } else {
      S.editing = null;
    }
  }
  document.querySelectorAll('#nav a').forEach((a) => {
    a.classList.toggle('on', a.dataset.route === name);
  });
  const view = document.getElementById('view');
  view.replaceChildren(h('div', { class: 'banner load' }, h('p', { text: '불러오는 중…' })));
  await ROUTES[name](view);
}

window.addEventListener('hashchange', route);

/* ── 상단 사용자 표시 ─────────────────────────────────────── */

async function loadWhoami() {
  const box = document.getElementById('whoami');
  const r = await api('/api/me');
  if (r.status === 401) { box.textContent = '로그인 필요'; return; }
  const roles = (r.data && r.data.roles) || [];
  if (roles.length === 0) { box.textContent = '역할 미매핑'; return; }
  const labels = ((r.data && r.data.assignments) || []).map((a) => a.role_label);
  box.replaceChildren(
    h('div', { text: labels[0] || roles[0] }),
    roles.length > 1 ? h('div', { class: 'num', text: roles.join(' · ') }) : null,
  );
}

/* ══════════════════════════════════════════════════════════
   화면 1 — 기준정보 (S10)
   ══════════════════════════════════════════════════════════ */

const TABS = [
  ['metrics', '지표'],
  ['assign', '담당 배정'],
  ['units', '입력 단위'],
  ['factors', '배출계수'],
  ['fx', '환율'],
  ['audit', '변경 이력'],
];

async function viewMaster(view) {
  if (!S.master) {
    const r = await api('/api/master');
    if (!r.ok) {
      view.replaceChildren(
        h('div', { class: 'banner fail' },
          h('h2', { text: '기준정보를 불러올 수 없습니다' }),
          h('p', { text: (r.data && (r.data.hint || r.data.error)) || '알 수 없는 오류' })),
        h('p', { class: 'note' }, '로그인 상태와 권한을 확인하세요. 시스템 상태 화면에서 각 항목을 점검할 수 있습니다.'),
      );
      return;
    }
    S.master = r.data;
  }
  const M = S.master;

  const head = h('div', { class: 'page-head' },
    h('div', null,
      h('div', { class: 'eyebrow', text: '기준정보 관리' }),
      h('h1', { text: '지표 · 배출계수 · 담당' }),
      h('p', { class: 'page-desc' },
        '계수 개정, 항목명·단위 변경, 담당자 교체를 ',
        h('b', { text: '전부 이 화면에서' }),
        ' 합니다. 운영 중에 코드를 고칠 일이 없어야 유지보수가 성립합니다.')),
  );

  const counts = {
    metrics: M.metrics.length,
    assign: M.assignments.length,
    units: M.units.length,
    factors: M.factors.length,
    fx: M.fx_rates.length,
    audit: null,
  };
  const tabs = h('div', { class: 'tabs' }, TABS.map(([key, label]) =>
    h('button', {
      type: 'button', class: 'tab' + (S.tab === key ? ' on' : ''),
      onclick: () => { location.hash = hashFor(key, key === 'assign' ? S.entity : null); },
    }, label, counts[key] !== null ? h('span', { class: 'count', text: String(counts[key]) }) : null)));

  const body = h('div');
  view.replaceChildren(head, tabs, body);

  if (S.tab === 'metrics') renderMetrics(body);
  else if (S.tab === 'assign') renderAssign(body);
  else if (S.tab === 'units') renderUnits(body);
  else if (S.tab === 'factors') renderFactors(body);
  else if (S.tab === 'fx') renderFx(body);
  else if (S.tab === 'audit') await renderAudit(body);
}

async function reloadMaster() {
  S.master = null;
  await route();
}

/* ── 탭: 지표 ─────────────────────────────────────────────── */

function renderMetrics(root) {
  const M = S.master;
  const cats = [
    ['all', '전체'], ['E', '환경'], ['S', '사회'], ['PROD', '생산'], ['calc', '계산지표'],
  ];
  const chips = h('div', { class: 'chips' }, cats.map(([key, label]) => {
    const n = key === 'all' ? M.metrics.length
      : key === 'calc' ? M.metrics.filter((m) => m.is_calculated).length
      : M.metrics.filter((m) => m.category === key && !m.is_calculated).length;
    return h('button', {
      type: 'button', class: 'chip' + (S.cat === key ? ' on' : ''),
      onclick: () => { location.hash = hashFor('metrics', key); },
    }, `${label} ${n}`);
  }));

  const rows = M.metrics.filter((m) =>
    S.cat === 'all' ? true
    : S.cat === 'calc' ? !!m.is_calculated
    : m.category === S.cat && !m.is_calculated);

  const tbody = h('tbody');
  let editingMetric = null;
  for (const m of rows) {
    const editing = S.editing === m.code;
    if (editing) editingMetric = m;
    tbody.append(h('tr', { class: editing ? 'editing' : (m.is_calculated ? 'calc' : null) },
      h('td', null, h('span', { class: 'code' + (m.is_calculated ? ' calc' : ''), text: m.code })),
      h('td', null,
        h('div', { class: 'name-main', text: m.name_ko }),
        h('div', { class: 'name-sub', text: `${m.name_zh} · ${m.name_vi}` })),
      h('td', null, h('span', { class: 'unit-pill', text: m.unit_standard })),
      h('td', { text: PERIOD_KO[m.period_type] || m.period_type }),
      h('td', { text: AGG_KO[m.aggregation] || m.aggregation }),
      h('td', null, m.is_calculated
        ? h('span', { class: 'note', text: '해당 없음' })
        : h('span', { class: 'badge ' + (m.evidence_policy === 'required' ? 'ok' : 'mute'),
                      text: m.evidence_policy === 'required' ? '필수' : '미제공' })),
      h('td', { class: 'note', text: DISC_KO[m.disclosure_level] || m.disclosure_level }),
      h('td', { class: 'note num', text: [m.gri_code, m.kssb_code].filter(Boolean).join(' · ') || '—' }),
      h('td', { class: 'right' }, h('button', {
        type: 'button', class: 'tiny ghost',
        onclick: () => { location.hash = hashFor('metrics', S.cat, editing ? null : m.code); },
      }, editing ? '닫기' : '수정')),
    ));
  }

  root.replaceChildren(
    chips,
    editingMetric ? h('div', { class: 'card flush editing-card' }, metricEditor(editingMetric)) : null,
    h('div', { class: 'card flush' },
      h('div', { class: 'scroll' }, h('table', null,
        h('thead', null, h('tr', null,
          h('th', { text: '코드' }), h('th', { text: '항목명 (한 / 중 / 베)' }),
          h('th', { text: '표준단위' }), h('th', { text: '주기' }), h('th', { text: '집계' }),
          h('th', { text: '증빙' }), h('th', { text: '공개등급' }), h('th', { text: '보고기준 매핑' }),
          h('th', { class: 'right', text: '' }))),
        tbody))),
    h('p', { class: 'note' },
      '사회(S) 지표는 증빙 정책이 ', h('b', { text: '미제공' }),
      ' 입니다 — 급여대장·근태표·재해조사표가 올라갈 경로 자체를 만들지 않았습니다. ',
      '이 값은 화면에서 변경할 수 없습니다.'),
  );
}

function metricEditor(m) {
  const f = {};
  const text = (key, label, note) => h('div', null,
    h('label', { for: 'f_' + key, text: label }),
    (f[key] = h('input', { type: 'text', id: 'f_' + key, value: m[key] ?? '' })),
    note ? h('div', { class: 'field-note', text: note }) : null);
  const pick = (key, label, options, koMap) => h('div', null,
    h('label', { for: 'f_' + key, text: label }),
    (f[key] = h('select', { id: 'f_' + key },
      options.map((o) => h('option', { value: o, selected: m[key] === o }, koMap ? koMap[o] : o)))));
  const area = (key, label, note) => h('div', { class: 'span2' },
    h('label', { for: 'f_' + key, text: label }),
    (f[key] = h('textarea', { id: 'f_' + key }, m[key] ?? '')),
    note ? h('div', { class: 'field-note', text: note }) : null);

  const grid = h('div', { class: 'form-grid' },
    text('name_ko', '항목명 (한국어)'),
    text('name_zh', '항목명 (중국어)'),
    text('name_vi', '항목명 (베트남어)'),
    text('unit_standard', '표준단위'),
    pick('period_type', '수집주기', ['monthly', 'quarterly', 'annual'], PERIOD_KO),
    pick('aggregation', '연간 집계방식', ['sum', 'avg', 'eop'], AGG_KO),
    pick('disclosure_level', '공개등급', ['internal', 'customer', 'public'], DISC_KO),
    text('gri_code', 'GRI 코드'),
    text('kssb_code', 'KSSB / IFRS 코드'),
    text('sort_order', '표시 순서'),
    text('active_to', '폐지 시점 (YYYY-MM)', '비워두면 계속 사용합니다'),
    h('div', null,
      h('label', { text: '증빙 정책' }),
      h('div', { class: 'locked', text: m.evidence_policy === 'required' ? '필수 (변경 불가)' : '미제공 (변경 불가)' }),
      h('div', { class: 'field-note', text: '개인정보 보호 설계이므로 화면에서 바꿀 수 없습니다.' })),
    area('definition_ko', '산정 정의', '이 정의가 흔들리면 다년 추이가 무의미해집니다'),
    area('help_ko', '입력 안내 (한국어)', '"이 숫자는 어디서 찾나"를 담당자가 화면에서 읽습니다'),
    area('help_zh', '입력 안내 (중국어)'),
    area('help_vi', '입력 안내 (베트남어)'),
  );

  const save = h('button', { type: 'button', class: 'primary' }, '저장');
  save.addEventListener('click', async () => {
    const payload = {};
    for (const [key, node] of Object.entries(f)) payload[key] = node.value.trim();
    if (payload.sort_order !== undefined && payload.sort_order !== '') {
      const n = Number(payload.sort_order);
      if (!Number.isInteger(n)) { toast('표시 순서는 정수여야 합니다.', 'fail'); return; }
      payload.sort_order = n;
    }
    save.disabled = true;
    const r = await api('/api/master/metric/' + encodeURIComponent(m.code), 'PATCH', payload);
    save.disabled = false;
    if (!r.ok) { fail(r, '저장하지 못했습니다.'); return; }
    if (r.data.updated === 0) { toast('변경된 내용이 없습니다.'); return; }
    toast(`${m.code} — ${r.data.updated}개 항목을 저장했습니다.`);
    S.master = null;
    location.hash = hashFor('metrics', S.cat);
    await route();
  });

  return h('div', { class: 'editor' },
    h('div', { class: 'editor-title', text: `${m.code} 수정` }),
    grid,
    h('div', { class: 'actions' },
      save,
      h('button', { type: 'button', class: 'ghost',
                    onclick: () => { location.hash = hashFor('metrics', S.cat); } }, '취소')),
  );
}

/* ── 탭: 담당 배정 ────────────────────────────────────────── */

function renderAssign(root) {
  const M = S.master;
  const entityChips = h('div', { class: 'chips' }, M.entities.map((e) =>
    h('button', {
      type: 'button', class: 'chip' + (S.entity === e.code ? ' on' : ''),
      onclick: () => { location.hash = hashFor('assign', e.code); },
    }, `${e.name_ko} (${e.code})`)));

  const rolesOf = (entityCode) => M.roles.filter((r) => r.entity_code === entityCode && r.scope !== 'executive');
  const roleOptions = rolesOf(S.entity);
  const metricByCode = new Map(M.metrics.map((m) => [m.code, m]));
  const rows = M.assignments.filter((a) => a.entity_code === S.entity);
  const missing = M.assignments.filter((a) => !a.backup_role).length;
  const notApplicable = rows.filter((a) => !a.is_applicable).length;

  const tbody = h('tbody');
  for (const a of rows) {
    const m = metricByCode.get(a.metric_code);
    if (!m) continue;

    const ownerSel = h('select', { class: 'inline' },
      roleOptions.map((r) => h('option', { value: r.code, selected: r.code === a.owner_role }, r.label_ko)));
    const backupSel = h('select', { class: 'inline' },
      roleOptions.map((r) => h('option', { value: r.code, selected: r.code === a.backup_role }, r.label_ko)));
    const applyBox = h('input', { type: 'checkbox', checked: !!a.is_applicable, style: 'width:18px;min-height:18px' });

    const send = async () => {
      const r = await api('/api/master/assignment', 'PATCH', {
        metric_code: a.metric_code,
        entity_code: a.entity_code,
        owner_role: ownerSel.value,
        backup_role: backupSel.value,
        is_applicable: applyBox.checked ? 1 : 0,
      });
      if (!r.ok) { fail(r, '저장하지 못했습니다.'); await reloadMaster(); return; }
      Object.assign(a, r.data.assignment);
      toast(`${a.metric_code} 배정을 저장했습니다.`);
    };
    ownerSel.addEventListener('change', send);
    backupSel.addEventListener('change', send);
    applyBox.addEventListener('change', send);

    tbody.append(h('tr', { class: a.is_applicable ? null : 'off' },
      h('td', null, h('span', { class: 'code', text: a.metric_code })),
      h('td', null,
        h('div', { class: 'name-main', text: m.name_ko }),
        h('div', { class: 'name-sub', text: `${CAT_KO[m.category] || m.category} · ${PERIOD_KO[m.period_type]}` })),
      h('td', null, ownerSel),
      h('td', null, backupSel),
      h('td', { class: 'right' }, applyBox),
    ));
  }

  root.replaceChildren(
    entityChips,
    h('div', { class: 'banner ' + (missing ? 'fail' : 'ok') },
      h('div', { class: 'banner-row' },
        h('span', { class: 'dot ' + (missing ? 'fail' : 'ok') }),
        h('div', { class: 'grow' },
          h('h2', { text: missing ? `부담당자가 지정되지 않은 배정 ${missing}건` : '모든 배정에 부담당자가 지정되어 있습니다' }),
          h('p', { text: missing
            ? '부담당자 없이는 저장되지 않습니다 — 담당 1인이 부재하면 그 법인 데이터가 멈추기 때문입니다.'
            : '담당자 1인이 휴가·퇴사해도 그 법인 데이터가 멈추지 않습니다. (P-7)' })))),
    h('div', { class: 'card flush' },
      h('div', { class: 'scroll' }, h('table', null,
        h('thead', null, h('tr', null,
          h('th', { text: '코드' }), h('th', { text: '항목명' }),
          h('th', { text: '주담당' }), h('th', { text: '부담당 (필수)' }),
          h('th', { class: 'right', text: '적용' }))),
        tbody))),
    h('p', { class: 'note' },
      '해외법인은 담당자 1인이 전 항목을 담당합니다. ',
      '해당 법인에 없는 설비·항목은 ', h('b', { text: '적용' }), ' 을 해제하면 입력 시트에서 사라집니다',
      notApplicable ? ` (현재 ${notApplicable}건 해제됨).` : '.',
      ' 변경은 선택하는 즉시 저장됩니다.'),
  );
}

/* ── 탭: 입력 단위 ────────────────────────────────────────── */

function renderUnits(root) {
  const M = S.master;
  const metricByCode = new Map(M.metrics.map((m) => [m.code, m]));

  const tbody = h('tbody');
  if (M.units.length === 0) {
    tbody.append(h('tr', null, h('td', { colspan: 5, class: 'empty', text: '등록된 오버라이드가 없습니다.' })));
  }
  for (const u of M.units) {
    const m = metricByCode.get(u.metric_code);
    tbody.append(h('tr', null,
      h('td', null, h('span', { class: 'code', text: u.metric_code })),
      h('td', { text: m ? m.name_ko : u.metric_code }),
      h('td', null, h('span', { class: 'unit-pill', text: u.unit_input }),
        h('span', { class: 'note' }, ' → ', m ? m.unit_standard : '')),
      h('td', { class: 'num', text: '× ' + u.factor_to_standard.toLocaleString() }),
      h('td', { class: 'right' }, h('button', {
        type: 'button', class: 'tiny ghost',
        onclick: async () => {
          const r = await api('/api/master/unit', 'PUT',
            { metric_code: u.metric_code, entity_code: u.entity_code, unit_input: null });
          if (!r.ok) { fail(r, '삭제하지 못했습니다.'); return; }
          toast('오버라이드를 삭제했습니다.');
          await reloadMaster();
        },
      }, '삭제')),
    ));
  }

  const inputMetrics = M.metrics.filter((m) => !m.is_calculated);
  const fm = h('select', null, inputMetrics.map((m) =>
    h('option', { value: m.code }, `${m.code} · ${m.name_ko} (${m.unit_standard})`)));
  const fe = h('select', null, M.entities.map((e) => h('option', { value: e.code }, `${e.name_ko} (${e.code})`)));
  const fu = h('input', { type: 'text', placeholder: '万kWh' });
  const ff = h('input', { type: 'number', step: 'any', placeholder: '10000' });

  const add = h('button', { type: 'button', class: 'primary' }, '등록');
  add.addEventListener('click', async () => {
    if (!fu.value.trim() || !ff.value) { toast('입력 단위와 환산계수를 모두 채우세요.', 'fail'); return; }
    add.disabled = true;
    const r = await api('/api/master/unit', 'PUT', {
      metric_code: fm.value, entity_code: fe.value,
      unit_input: fu.value.trim(), factor_to_standard: Number(ff.value),
    });
    add.disabled = false;
    if (!r.ok) { fail(r, '등록하지 못했습니다.'); return; }
    toast('입력 단위를 등록했습니다.');
    await reloadMaster();
  });

  root.replaceChildren(
    h('div', { class: 'hint info' },
      '법인별로 현지 고지서 관행에 맞춰 입력 단위를 고정합니다. ',
      '심양 전기요금 고지서는 万kWh 단위를 쓰므로 그대로 받고 시스템이 kWh 로 환산합니다. ',
      h('b', { text: '담당자가 환산하지 않습니다.' })),
    h('div', { class: 'card flush' }, h('table', null,
      h('thead', null, h('tr', null,
        h('th', { text: '지표' }), h('th', { text: '항목명' }),
        h('th', { text: '입력 단위 → 표준 단위' }), h('th', { text: '환산계수' }),
        h('th', { class: 'right', text: '' }))),
      tbody)),
    h('h3', { text: '오버라이드 추가' }),
    h('div', { class: 'card' },
      h('div', { class: 'form-grid' },
        h('div', { class: 'span2' }, h('label', { text: '지표' }), fm),
        h('div', null, h('label', { text: '법인' }), fe),
        h('div', null, h('label', { text: '입력 단위' }), fu,
          h('div', { class: 'field-note', text: '현지 고지서에 찍혀 나오는 단위' })),
        h('div', null, h('label', { text: '표준단위 환산계수' }), ff,
          h('div', { class: 'field-note', text: '万kWh → kWh 는 10000' }))),
      h('div', { class: 'actions' }, add)),
  );
}

/* ── 탭: 배출계수 ─────────────────────────────────────────── */

const FACTOR_TYPES = ['electricity', 'natural_gas', 'diesel', 'diesel_vehicle', 'lpg', 'gasoline', 'steam'];
const REGIONS = ['KR', 'CN-NE', 'VN', 'GLOBAL'];

function renderFactors(root) {
  const M = S.master;
  const tbody = h('tbody');
  if (M.factors.length === 0) {
    tbody.append(h('tr', null, h('td', { colspan: 8, class: 'empty', text: '등록된 계수가 없습니다.' })));
  }
  for (const f of M.factors) {
    tbody.append(h('tr', null,
      h('td', null, h('span', { class: 'code', text: f.factor_type })),
      h('td', { text: f.purpose === 'emission' ? '배출계수' : '순발열량' }),
      h('td', { class: 'num', text: f.region }),
      h('td', { class: 'num', text: String(f.year) }),
      h('td', { class: 'right num', text: String(f.value) }),
      h('td', { class: 'note', text: f.unit + (f.gwp_set ? ` · ${f.gwp_set}` : '') }),
      h('td', { class: 'note' }, f.source, h('div', { class: 'name-sub num', text: '고시 ' + f.published_at })),
      h('td', { class: 'right' }, h('span', { class: 'badge mute num', text: f.version })),
    ));
  }

  const f = {};
  const inp = (key, label, attrs, note) => h('div', null,
    h('label', { text: label }), (f[key] = h('input', attrs)),
    note ? h('div', { class: 'field-note', text: note }) : null);
  const sel = (key, label, options, koMap) => h('div', null,
    h('label', { text: label }),
    (f[key] = h('select', null, options.map((o) => h('option', { value: o }, koMap ? koMap[o] : o)))));

  const save = h('button', { type: 'button', class: 'primary' }, '새 버전으로 등록');
  save.addEventListener('click', async () => {
    const payload = {
      factor_type: f.factor_type.value,
      purpose: f.purpose.value,
      region: f.region.value,
      year: Number(f.year.value),
      value: Number(f.value.value),
      unit: f.unit.value.trim(),
      gwp_set: f.gwp_set.value || null,
      source: f.source.value.trim(),
      published_at: f.published_at.value,
      version: f.version.value.trim(),
    };
    for (const [k, v] of Object.entries(payload)) {
      if (k === 'gwp_set') continue;
      if (v === '' || v === null || Number.isNaN(v)) { toast(`${k} 을(를) 채우세요.`, 'fail'); return; }
    }
    save.disabled = true;
    const r = await api('/api/master/factor', 'POST', payload);
    save.disabled = false;
    if (!r.ok) { fail(r, '등록하지 못했습니다.'); return; }
    toast('계수를 등록했습니다.');
    await reloadMaster();
  });

  root.replaceChildren(
    M.factors.length === 0
      ? h('div', { class: 'banner warn' },
          h('h2', { text: '배출계수가 아직 등록되지 않았습니다 — 이 단계에서는 정상입니다' }),
          h('p', null,
            '실제 고시값을 확인한 뒤 등록합니다. 입력·검증 화면은 계수 없이 동작하므로, ',
            h('b', { text: '산정 로직(W3, 10/6~10) 전까지' }), ' 확보하면 됩니다. ',
            '추측값을 넣으면 그 값으로 산정을 검증하게 되고 전부 다시 해야 합니다.'))
      : null,
    h('div', { class: 'hint info' },
      h('b', { text: '확인처' }),
      ' — 한국: 온실가스종합정보센터·전력거래소 / 중국: 생태환경부 지역 전력망 계수(동북전망) + GB/T 32150-2025 / ',
      '베트남: MONRE 고시 + Decree 06/2022 부속 방법론'),
    h('div', { class: 'card flush' }, h('div', { class: 'scroll' }, h('table', null,
      h('thead', null, h('tr', null,
        h('th', { text: '종류' }), h('th', { text: '용도' }), h('th', { text: '지역' }),
        h('th', { text: '연도' }), h('th', { class: 'right', text: '값' }), h('th', { text: '단위' }),
        h('th', { text: '출처' }), h('th', { class: 'right', text: '버전' }))),
      tbody))),
    h('h3', { text: '계수 등록' }),
    h('div', { class: 'card' },
      h('div', { class: 'form-grid' },
        sel('factor_type', '종류', FACTOR_TYPES),
        sel('purpose', '용도', ['emission', 'heating_value'], { emission: '배출계수', heating_value: '순발열량' }),
        sel('region', '지역', REGIONS),
        inp('year', '적용 연도', { type: 'number', value: '2025' }),
        inp('value', '계수값', { type: 'number', step: 'any', placeholder: '0.0000000' }),
        inp('unit', '단위', { type: 'text', placeholder: 'tCO2eq/kWh' }),
        sel('gwp_set', 'GWP 버전', ['', 'AR5', 'AR6'], { '': '해당 없음', AR5: 'AR5', AR6: 'AR6' }),
        inp('published_at', '고시일', { type: 'date' }),
        inp('source', '출처', { type: 'text', placeholder: '온실가스종합정보센터 고시 제0000호' }),
        inp('version', '버전', { type: 'text', value: 'v2026.1' },
          '기존 계수는 수정되지 않습니다. 값이 바뀌면 새 버전으로 등록하세요.')),
      h('div', { class: 'actions' }, save,
        h('span', { class: 'note' }, '이미 제출한 수치는 등록 당시 버전으로 그대로 재현됩니다.'))),
  );
}

/* ── 탭: 환율 ─────────────────────────────────────────────── */

function renderFx(root) {
  const M = S.master;
  const tbody = h('tbody');
  if (M.fx_rates.length === 0) {
    tbody.append(h('tr', null, h('td', { colspan: 5, class: 'empty', text: '등록된 환율이 없습니다.' })));
  }
  for (const r of M.fx_rates) {
    tbody.append(h('tr', null,
      h('td', null, h('span', { class: 'code', text: r.currency })),
      h('td', { class: 'num', text: String(r.year) }),
      h('td', { class: 'right num', text: r.rate_avg.toLocaleString() }),
      h('td', { class: 'note', text: r.source }),
      h('td', { class: 'right' }, h('span', { class: 'badge mute num', text: r.version })),
    ));
  }

  const fc = h('select', null, ['CNY', 'VND', 'USD', 'KRW'].map((c) => h('option', { value: c }, c)));
  const fy = h('input', { type: 'number', value: '2026' });
  const fr = h('input', { type: 'number', step: 'any', placeholder: '190.5' });
  const fs = h('input', { type: 'text', placeholder: '서울외국환중개 연평균' });
  const fv = h('input', { type: 'text', value: 'v2026.1' });

  const save = h('button', { type: 'button', class: 'primary' }, '등록');
  save.addEventListener('click', async () => {
    if (!fr.value || !fs.value.trim()) { toast('환율과 출처를 채우세요.', 'fail'); return; }
    save.disabled = true;
    const r = await api('/api/master/fx', 'POST', {
      currency: fc.value, year: Number(fy.value), rate_avg: Number(fr.value),
      source: fs.value.trim(), version: fv.value.trim(),
    });
    save.disabled = false;
    if (!r.ok) { fail(r, '등록하지 못했습니다.'); return; }
    toast('환율을 등록했습니다.');
    await reloadMaster();
  });

  root.replaceChildren(
    h('div', { class: 'hint info' },
      '집약도 지표의 분모(매출액)는 3법인 통화가 다릅니다. ',
      h('b', { text: '연평균 환율' }), ' 을 적용하고, 적용 환율을 산정 결과에 함께 기록합니다. ',
      '정책을 바꿔도 과거 산출물은 기존 환율로 보존됩니다.'),
    h('div', { class: 'card flush' }, h('table', null,
      h('thead', null, h('tr', null,
        h('th', { text: '통화' }), h('th', { text: '연도' }),
        h('th', { class: 'right', text: '연평균 환율 (KRW)' }), h('th', { text: '출처' }),
        h('th', { class: 'right', text: '버전' }))),
      tbody)),
    h('h3', { text: '환율 등록' }),
    h('div', { class: 'card' },
      h('div', { class: 'form-grid' },
        h('div', null, h('label', { text: '통화' }), fc),
        h('div', null, h('label', { text: '연도' }), fy),
        h('div', null, h('label', { text: '연평균 환율' }), fr,
          h('div', { class: 'field-note', text: '1단위당 원화' })),
        h('div', null, h('label', { text: '버전' }), fv),
        h('div', { class: 'span2' }, h('label', { text: '출처' }), fs)),
      h('div', { class: 'actions' }, save)),
  );
}

/* ── 탭: 변경 이력 ────────────────────────────────────────── */

const TABLE_KO = {
  metric: '지표', metric_assignment: '담당 배정',
  metric_unit_override: '입력 단위', factor: '배출계수', fx_rate: '환율',
};

async function renderAudit(root) {
  const r = await api('/api/master/audit');
  const entries = (r.data && r.data.entries) || [];
  const tbody = h('tbody');
  if (entries.length === 0) {
    tbody.append(h('tr', null, h('td', { colspan: 6, class: 'empty', text: '변경 이력이 없습니다.' })));
  }
  for (const e of entries) {
    tbody.append(h('tr', null,
      h('td', { class: 'note num', text: (e.changed_at || '').replace('T', ' ').slice(0, 16) }),
      h('td', { text: TABLE_KO[e.table_name] || e.table_name }),
      h('td', null, h('span', { class: 'code', text: e.row_key })),
      h('td', { class: 'note', text: e.field }),
      h('td', { class: 'note' }, String(e.old_value ?? '—'), ' → ', h('b', { text: String(e.new_value ?? '—') })),
      h('td', { class: 'right role-code', text: e.changed_by_role || '—' }),
    ));
  }
  root.replaceChildren(
    h('div', { class: 'hint info' },
      '기준정보 변경은 모두 이력으로 남습니다. 누가 아니라 ', h('b', { text: '어느 역할이' }),
      ' 바꿨는지 기록됩니다 — 개인정보를 남기지 않기 때문입니다.'),
    h('div', { class: 'card flush' }, h('div', { class: 'scroll' }, h('table', null,
      h('thead', null, h('tr', null,
        h('th', { text: '시각' }), h('th', { text: '대상' }), h('th', { text: '키' }),
        h('th', { text: '항목' }), h('th', { text: '변경' }), h('th', { class: 'right', text: '역할' }))),
      tbody))),
  );
}

/* ══════════════════════════════════════════════════════════
   화면 2 — 시스템 상태 (W0 G0 확인)
   ══════════════════════════════════════════════════════════ */

const CHECK_LABEL = {
  access:   ['인증 (Cloudflare Access)', '로그인과 역할 매핑'],
  database: ['데이터베이스 (D1)', '스키마와 기준정보 적재'],
  storage:  ['파일 저장소 (R2)', '증빙 파일 보관 버킷'],
  factors:  ['배출계수', '산정에 사용하는 계수 등록'],
};

async function viewHealth(view) {
  const r = await api('/api/health');
  if (!r.data) {
    view.replaceChildren(h('div', { class: 'banner fail' },
      h('h2', { text: '서버에 연결할 수 없습니다' }),
      h('p', { text: '배포 상태를 확인하세요.' })));
    return;
  }
  const H = r.data;
  const msg = {
    ok:   ['모두 정상입니다', 'G0 게이트를 통과했습니다.'],
    warn: ['동작하지만 확인할 항목이 있습니다', '배출계수 미등록은 이 단계에서 정상입니다.'],
    fail: ['막힌 항목이 있습니다', '아래 실패 항목의 안내를 따라 조치하세요. 다른 항목은 계속 사용할 수 있습니다.'],
  }[H.overall] || ['상태를 알 수 없습니다', ''];

  const cards = ['access', 'database', 'storage', 'factors'].map((key) => {
    const c = H.checks[key];
    if (!c) return null;
    const [title, desc] = CHECK_LABEL[key];
    const facts = h('div', { class: 'facts' }, h('div', { class: 'fact', text: desc }));
    if (key === 'access') {
      facts.append(fact('로그인', c.authenticated ? '확인됨' : '없음'));
      if (c.roles && c.roles.length) facts.append(fact('부여된 역할', c.roles.join(', ')));
    }
    if (key === 'database' && c.counts) {
      facts.append(fact('법인', c.counts.entities), fact('지표', c.counts.metrics),
                   fact('담당배정', c.counts.assignments), fact('입력값', c.counts.entries));
      if (c.monthly_per_entity) {
        facts.append(fact('월간 입력 항목',
          c.monthly_per_entity.map((x) => `${x.entity_code} ${x.n}`).join(' · ')));
      }
      facts.append(fact('부담당자 미지정', c.missing_backup));
    }
    if (key === 'storage') facts.append(fact('버킷 연결', '확인됨'));
    if (key === 'factors') facts.append(fact('등록된 계수', c.registered ?? 0));

    return h('div', { class: 'card' },
      h('div', { class: 'banner-row' },
        h('span', { class: 'dot ' + c.status }),
        h('span', { style: 'font-size:16px;font-weight:600' }, title),
        h('span', { class: 'badge ' + c.status, style: 'margin-left:auto', text: STATUS_KO[c.status] || c.status })),
      facts,
      c.hint ? h('div', { class: 'hint' + (c.status === 'fail' ? ' fail' : ''), text: c.hint }) : null,
      c.error ? h('pre', { text: c.error }) : null);
  });

  const raw = h('pre', { hidden: true, text: JSON.stringify(H, null, 2) });

  view.replaceChildren(
    h('div', { class: 'page-head' }, h('div', null,
      h('div', { class: 'eyebrow', text: '시스템 상태' }),
      h('h1', { text: 'W0 — 배포 파이프라인 확인 (G0)' }))),
    h('div', { class: 'banner ' + H.overall }, h('h2', { text: msg[0] }), h('p', { text: msg[1] })),
    cards,
    h('div', { class: 'actions' },
      h('button', { type: 'button', onclick: route }, '다시 확인'),
      h('button', { type: 'button', class: 'ghost', onclick: () => { raw.hidden = !raw.hidden; } }, '원본 응답 보기')),
    raw,
    h('p', { class: 'note', style: 'margin-top:20px' },
      '문제가 해결되지 않으면 원본 응답의 내용을 그대로 복사해 AI에게 붙여넣으세요. ',
      '요약하지 말고 전문을 붙여넣어야 원인을 특정할 수 있습니다.'),
  );
}

/* ── 시작 ─────────────────────────────────────────────────── */

loadWhoami();
route();
