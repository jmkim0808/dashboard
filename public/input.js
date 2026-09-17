/* 입력 화면 — 월간 입력 시트(S1)와 항목 입력 카드(S2)
 *
 * app.js 의 h() · api() · toast() 를 함께 쓴다. 로드 순서는 index.html 참조.
 *
 * 이 화면이 지키는 원칙
 *   P-1  입력자는 숫자만 넣는다. 단위는 고정 표시되고 담당자가 환산하지 않는다
 *   P-2  미확보는 정상 상태다. 화면이 그렇게 말해준다
 *   P-3  본사 담당자 3~5분, 해외법인 20~40분
 *   P-6  본사는 "내 항목만" 카드, 해외법인은 "한 화면에 전부" 시트
 *   R60  이상치는 경고만. 저장을 막지 않는다
 */

/* ── 3개 언어 사전 (R27 / R30) ─────────────────────────────── */

const L = {
  ko: {
    sheet_title: '월간 데이터 입력', card_title: '내 입력 항목',
    progress: '진행률', deadline: '마감', period: '대상 월', entity: '법인',
    col_item: '항목', col_unit: '단위', col_prev: '전월', col_value: '이번 달 입력',
    col_evidence: '증빙', col_status: '상태',
    st_entered: '입력완료', st_empty: '미입력', st_unavailable: '미확보',
    st_returned: '반송', st_approved: '승인완료', st_closed: '확정',
    anomaly: '확인 필요',
    mark_unavailable: '미확보로 표시', undo: '되돌리기', pick_reason: '사유 선택',
    unavailable_ok: '미확보는 정상적인 입력 상태입니다.',
    unavailable_note: '자료가 확보되면 나중에 입력하실 수 있습니다.',
    attach: '첨부', attached: '첨부됨', na: '해당 없음', not_provided: '미제공',
    saved: '저장됨', saving: '저장 중', submit: '제출 (완료 확인)',
    vs_prev: '전월 대비', new_occurrence: '신규 발생', check_unit: '단위를 확인해 주세요',
    not_mine: '담당 아님', backup: '부담당', numbers_only: '숫자만 입력하세요',
    where_to_find: '이 숫자는 어디서 찾나', help: '안내',
    all_done: '이번 달 입력을 모두 마쳤습니다.',
    missing_n: '아직 입력하지 않은 항목', save_next: '저장하고 다음', prev_item: '이전',
    of: '/', locked_note: '승인·확정된 항목은 수정할 수 없습니다.',
    photo_hint: '고지서를 사진으로 찍어 올려도 됩니다.',
  },
  zh: {
    sheet_title: '月度数据录入', card_title: '我的录入项目',
    progress: '录入进度', deadline: '截止日期', period: '对象月份', entity: '法人',
    col_item: '项目', col_unit: '单位', col_prev: '上月', col_value: '本月录入',
    col_evidence: '凭证', col_status: '状态',
    st_entered: '已录入', st_empty: '未录入', st_unavailable: '未获取',
    st_returned: '已退回', st_approved: '已批准', st_closed: '已确定',
    anomaly: '请确认',
    mark_unavailable: '标记为未获取', undo: '撤销', pick_reason: '选择原因',
    unavailable_ok: '未获取是正常的录入状态。',
    unavailable_note: '资料到齐后可以随时补录。',
    attach: '附加', attached: '已附加', na: '不适用', not_provided: '不提供',
    saved: '已保存', saving: '保存中', submit: '提交（完成确认）',
    vs_prev: '比上月', new_occurrence: '新发生', check_unit: '请确认单位',
    not_mine: '非本人负责', backup: '副担当', numbers_only: '仅可输入数字',
    where_to_find: '这个数字在哪里找', help: '说明',
    all_done: '本月录入已全部完成。',
    missing_n: '尚未录入的项目', save_next: '保存并继续', prev_item: '上一项',
    of: '/', locked_note: '已批准·确定的项目无法修改。',
    photo_hint: '也可以拍摄发票照片上传。',
  },
  vi: {
    sheet_title: 'Nhập dữ liệu hàng tháng', card_title: 'Chỉ tiêu tôi phụ trách',
    progress: 'Tiến độ', deadline: 'Hạn chót', period: 'Tháng', entity: 'Chi nhánh',
    col_item: 'Chỉ tiêu', col_unit: 'Đơn vị', col_prev: 'Tháng trước', col_value: 'Nhập tháng này',
    col_evidence: 'Chứng từ', col_status: 'Trạng thái',
    st_entered: 'Đã nhập', st_empty: 'Chưa nhập', st_unavailable: 'Chưa có',
    st_returned: 'Bị trả lại', st_approved: 'Đã phê duyệt', st_closed: 'Đã chốt',
    anomaly: 'Cần xác nhận',
    mark_unavailable: 'Đánh dấu chưa có', undo: 'Hoàn tác', pick_reason: 'Chọn lý do',
    unavailable_ok: 'Chưa có là trạng thái bình thường.',
    unavailable_note: 'Có thể nhập sau khi có tài liệu.',
    attach: 'Đính kèm', attached: 'Đã đính kèm', na: 'Không áp dụng', not_provided: 'Không cung cấp',
    saved: 'Đã lưu', saving: 'Đang lưu', submit: 'Gửi (xác nhận hoàn thành)',
    vs_prev: 'So với trước', new_occurrence: 'Mới phát sinh', check_unit: 'Vui lòng kiểm tra đơn vị',
    not_mine: 'Không phụ trách', backup: 'Phụ trách phụ', numbers_only: 'Chỉ nhập số',
    where_to_find: 'Tìm số này ở đâu', help: 'Hướng dẫn',
    all_done: 'Đã nhập xong toàn bộ tháng này.',
    missing_n: 'Chỉ tiêu chưa nhập', save_next: 'Lưu và tiếp', prev_item: 'Trước',
    of: '/', locked_note: 'Không thể sửa chỉ tiêu đã phê duyệt.',
    photo_hint: 'Có thể chụp ảnh hóa đơn để tải lên.',
  },
};

const ES = { entity: null, period: null, locale: null, sheet: null, cardIndex: 0, helpFor: null };

function t(key) {
  const dict = L[ES.locale] || L.ko;
  return dict[key] ?? L.ko[key] ?? key;
}
function nameOf(item) {
  return ES.locale === 'zh' ? item.name_zh : ES.locale === 'vi' ? item.name_vi : item.name_ko;
}
function helpOf(item) {
  return ES.locale === 'zh' ? item.help_zh : ES.locale === 'vi' ? item.help_vi : item.help_ko;
}
function reasonLabel(reason) {
  return ES.locale === 'zh' ? reason.label_zh : ES.locale === 'vi' ? reason.label_vi : reason.label_ko;
}

const LOCALE_NAMES = { ko: '한국어', zh: '中文', vi: 'Tiếng Việt' };

function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthOptions(count = 24) {
  const out = [];
  const d = new Date();
  for (let i = 0; i < count; i += 1) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}
const fmt = (v) => (v === null || v === undefined ? '' : Number(v).toLocaleString());

/* ── 공통: 값 저장 ─────────────────────────────────────────── */

async function persist(item, payload) {
  const r = await api('/api/entry', 'POST', {
    entity_code: ES.entity,
    metric_code: item.metric_code,
    period: ES.period,
    ...payload,
  });
  if (!r.ok) { fail(r, '저장하지 못했습니다.'); return null; }
  Object.assign(item, {
    status: r.data.status,
    value_raw: r.data.value_raw,
    unavailable_reason_code: r.data.unavailable_reason_code,
    return_reason: null,
    anomaly: r.data.anomaly,
    prev_value: r.data.prev_value,
    is_retro: r.data.is_retro,
  });
  return r.data;
}

function anomalyText(item) {
  const a = item.anomaly;
  if (!a || !a.flag) return null;
  if (a.kind === 'new_occurrence') return t('new_occurrence');
  if (a.pct === null) return t('anomaly');
  const sign = a.pct > 0 ? '+' : '';
  return `${t('vs_prev')} ${sign}${a.pct}% · ${t('check_unit')}`;
}

function statusBadge(item) {
  const map = {
    entered: ['ok', 'st_entered'], unavailable: ['mute', 'st_unavailable'],
    empty: ['', 'st_empty'], returned: ['fail', 'st_returned'],
    approved: ['ok', 'st_approved'], closed: ['ok', 'st_closed'],
  };
  const [cls, key] = map[item.status] || ['', 'st_empty'];
  if (item.anomaly && item.anomaly.flag && item.status === 'entered') {
    return h('span', { class: 'badge warn', text: t('anomaly') });
  }
  return h('span', { class: 'badge ' + cls, text: t(key) });
}

/* ── 증빙 첨부 ─────────────────────────────────────────────── */

function evidenceCell(item, onDone) {
  if (item.evidence_policy === 'none') {
    return h('span', { class: 'note', text: t('not_provided') });
  }
  const label = h('span', { class: item.evidence_count ? 'ev-on' : 'note' },
    item.evidence_count ? `${t('attached')} ${item.evidence_count}` : '—');

  const picker = h('input', {
    type: 'file', accept: 'image/*,application/pdf', style: 'display:none',
  });
  picker.addEventListener('change', async () => {
    const file = picker.files && picker.files[0];
    if (!file) return;
    if (item.status === 'empty') { toast('먼저 값을 입력한 뒤 증빙을 첨부하세요.', 'fail'); return; }
    const form = new FormData();
    form.append('entity_code', ES.entity);
    form.append('metric_code', item.metric_code);
    form.append('period', ES.period);
    form.append('file', file);
    label.textContent = t('saving');
    const res = await fetch('/api/entry/evidence', { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(data.hint || data.message || '첨부하지 못했습니다.', 'fail');
      label.textContent = item.evidence_count ? `${t('attached')} ${item.evidence_count}` : '—';
      return;
    }
    item.evidence_count = (item.evidence_count || 0) + 1;
    toast(`${nameOf(item)} — ${t('attached')}`);
    if (onDone) onDone();
  });

  return h('div', { class: 'ev-cell' }, label,
    item.locked ? null : h('button', {
      type: 'button', class: 'tiny ghost', onclick: () => picker.click(),
    }, t('attach')),
    picker);
}

/* ══════════════════════════════════════════════════════════
   화면 1 — 월간 입력 시트 (해외법인)
   ══════════════════════════════════════════════════════════ */

async function loadSheet() {
  const r = await api(`/api/entry/sheet?entity=${encodeURIComponent(ES.entity)}&period=${ES.period}`);
  if (!r.ok) { ES.sheet = null; return r; }
  ES.sheet = r.data;
  return r;
}

async function viewSheet(view) {
  const me = S.me || {};
  const [segEntity, segPeriod] = currentRoute().seg;
  ES.entity = segEntity || ES.entity || me.default_entity || 'HQ';
  ES.period = (segPeriod && /^\d{4}-\d{2}$/.test(segPeriod)) ? segPeriod : (ES.period || thisMonth());
  if (!ES.locale || !L[ES.locale]) ES.locale = me.default_locale || 'ko';  // 최초 1회만

  const r = await loadSheet();
  if (!r.ok) {
    setChildren(view, h('div', { class: 'banner fail' },
      h('h2', { text: '입력 시트를 불러올 수 없습니다' }),
      h('p', { text: (r.data && (r.data.hint || r.data.error)) || '' })));
    return;
  }
  const D = ES.sheet;
  const pct = D.progress.total ? Math.round(((D.progress.done + D.progress.unavailable) / D.progress.total) * 100) : 0;

  /* 상단 */
  const entitySel = h('select', { class: 'inline' },
    (me.can && me.can.all_entities ? ['HQ', 'SY', 'VP'] : (me.entry_entities || [ES.entity]))
      .map((code) => h('option', { value: code, selected: code === ES.entity }, code)));
  entitySel.addEventListener('change', () => { location.hash = `#/sheet/${entitySel.value}/${ES.period}`; });

  const periodSel = h('select', { class: 'inline' },
    monthOptions().map((p) => h('option', { value: p, selected: p === ES.period }, p)));
  periodSel.addEventListener('change', () => { location.hash = `#/sheet/${ES.entity}/${periodSel.value}`; });

  const localeBtns = h('div', { class: 'chips', style: 'margin:0' },
    Object.keys(LOCALE_NAMES).map((lc) => h('button', {
      type: 'button', class: 'chip' + (ES.locale === lc ? ' on' : ''),
      onclick: () => { ES.locale = lc; route(); },
    }, LOCALE_NAMES[lc])));

  const head = h('div', { class: 'page-head' },
    h('div', null,
      h('div', { class: 'eyebrow', text: `${D.entity.code} · ${ES.period}` }),
      h('h1', { text: t('sheet_title') }),
      h('p', { class: 'page-desc', text: nameLocalized(D.entity) })),
    h('div', { class: 'head-right' },
      h('div', null, h('label', { text: t('entity') }), entitySel),
      h('div', null, h('label', { text: t('period') }), periodSel)),
  );

  const meter = h('div', { class: 'stats' },
    h('div', { class: 'stat', style: 'flex:2 1 320px' },
      h('div', { class: 'stat-label', text: t('progress') }),
      h('div', { style: 'display:flex;align-items:center;gap:14px;margin-top:4px' },
        h('div', { class: 'stat-value num', text: `${D.progress.done + D.progress.unavailable} / ${D.progress.total}` }),
        h('div', { class: 'bar' }, h('div', { class: 'bar-fill', style: `width:${pct}%` })))),
    h('div', { class: 'stat warn' },
      h('div', { class: 'stat-label', text: t('deadline') }),
      h('div', { class: 'stat-value num', text: D.deadline })),
    h('div', { class: 'stat' },
      h('div', { class: 'stat-label', text: t('st_unavailable') }),
      h('div', { class: 'stat-value num', text: String(D.progress.unavailable) })),
  );

  /* 표 */
  const tbody = h('tbody');
  for (const it of D.items) tbody.append(...sheetRow(it));

  const submitBtn = h('button', { type: 'button', class: 'primary' }, t('submit'));
  submitBtn.addEventListener('click', async () => {
    submitBtn.disabled = true;
    const res = await api('/api/entry/submit', 'POST', { entity_code: ES.entity, period: ES.period });
    submitBtn.disabled = false;
    if (!res.ok) { fail(res, '확인하지 못했습니다.'); return; }
    const d = res.data;
    if (d.ok) {
      toast(`${ES.period} — ${t('all_done')}`);
    } else {
      toast(`${t('missing_n')} ${d.missing.length}건`, 'fail');
    }
    await route();
  });

  setChildren(view, head, localeBtns, meter,
    h('div', { class: 'card flush' }, h('table', null,
      h('thead', null, h('tr', null,
        h('th', { text: t('col_item') }), h('th', { text: t('col_unit') }),
        h('th', { class: 'right', text: t('col_prev') }), h('th', { text: t('col_value') }),
        h('th', { text: t('col_evidence') }), h('th', { text: t('col_status') }))),
      tbody)),
    h('div', { class: 'actions' }, submitBtn,
      h('span', { class: 'note' }, t('unavailable_ok'), ' ', t('unavailable_note'))),
  );
}

function nameLocalized(entity) {
  return ES.locale === 'zh' ? entity.name_zh : ES.locale === 'vi' ? entity.name_vi : entity.name_ko;
}

/** 한 항목의 행 + (열려 있으면) 안내 행 */
function sheetRow(it) {
  const rows = [];
  const readOnly = !it.editable || it.locked;

  /* 값 입력 */
  const box = h('input', {
    type: 'text', inputmode: 'decimal', class: 'val',
    value: it.value_raw === null ? '' : fmt(it.value_raw),
    disabled: readOnly || it.status === 'unavailable',
    'aria-label': nameOf(it),
  });
  const mark = h('span', { class: 'save-mark' });

  const commit = async () => {
    const raw = box.value.trim();
    if (raw === '' && it.value_raw === null) return;
    if (raw !== '' && !/^[\d,]+(\.\d+)?$/.test(raw)) { toast(t('numbers_only'), 'fail'); box.focus(); return; }
    if (raw !== '' && Number(raw.replace(/,/g, '')) === it.value_raw) return;
    mark.textContent = t('saving');
    const saved = await persist(it, raw === '' ? { value_raw: null } : { value_raw: raw });
    if (!saved) { box.value = it.value_raw === null ? '' : fmt(it.value_raw); mark.textContent = ''; return; }
    box.value = saved.value_raw === null ? '' : fmt(saved.value_raw);
    mark.textContent = t('saved');
    box.classList.toggle('flag', !!(it.anomaly && it.anomaly.flag));
    refreshRow(it);
    setTimeout(() => { mark.textContent = ''; }, 1800);
  };
  box.addEventListener('change', commit);
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); box.blur(); } });
  if (it.anomaly && it.anomaly.flag) box.classList.add('flag');

  /* 미확보 */
  const reasonSel = h('select', { class: 'inline', disabled: readOnly },
    h('option', { value: '' }, t('pick_reason')),
    (ES.sheet.reasons || []).map((rs) =>
      h('option', { value: rs.code, selected: rs.code === it.unavailable_reason_code }, reasonLabel(rs))));
  reasonSel.addEventListener('change', async () => {
    if (!reasonSel.value) return;
    const saved = await persist(it, { unavailable_reason_code: reasonSel.value });
    if (saved) { toast(`${nameOf(it)} — ${t('st_unavailable')}`); refreshRow(it); }
  });

  const toggleUnavailable = h('button', { type: 'button', class: 'tiny ghost', disabled: readOnly },
    it.status === 'unavailable' ? t('undo') : t('mark_unavailable'));
  toggleUnavailable.addEventListener('click', async () => {
    if (it.status === 'unavailable') {
      const saved = await persist(it, { value_raw: null, unavailable_reason_code: null });
      if (saved) { toast(`${nameOf(it)} — ${t('undo')}`); refreshRow(it); }
    } else {
      const saved = await persist(it, { unavailable_reason_code: 'INVOICE_PENDING' });
      if (saved) { toast(`${nameOf(it)} — ${t('st_unavailable')}`); refreshRow(it); }
    }
  });

  const valueCell = h('td', null,
    it.status === 'unavailable'
      ? h('div', { class: 'stack' }, reasonSel, toggleUnavailable)
      : h('div', { class: 'stack' },
          h('div', { class: 'val-line' }, box, mark),
          toggleUnavailable));

  const statusCell = h('td', null, h('div', { class: 'stack' },
    statusBadge(it),
    anomalyText(it) ? h('span', { class: 'anom', text: anomalyText(it) }) : null,
    it.role_kind === 'backup' ? h('span', { class: 'note', text: t('backup') }) : null,
    !it.editable ? h('span', { class: 'note', text: t('not_mine') }) : null,
    it.locked ? h('span', { class: 'note', text: t('locked_note') }) : null,
  ));

  const help = helpOf(it);
  const helpBtn = help ? h('button', {
    type: 'button', class: 'help-btn', 'aria-label': t('help'),
    onclick: () => { ES.helpFor = ES.helpFor === it.metric_code ? null : it.metric_code; route(); },
  }, '?') : null;

  const tr = h('tr', { class: it.status === 'unavailable' ? 'dim' : null },
    h('td', null, h('div', { class: 'item-cell' },
      h('div', null,
        h('div', { class: 'name-main', text: nameOf(it) }),
        h('div', { class: 'name-sub num', text: it.metric_code })),
      helpBtn)),
    h('td', null, h('span', { class: 'unit-pill', text: it.unit_input })),
    h('td', { class: 'right num prev', text: it.prev_value === null ? '—' : fmt(it.prev_value) }),
    valueCell,
    h('td', null, evidenceCell(it, () => refreshRow(it))),
    statusCell,
  );
  tr.dataset.metric = it.metric_code;
  rows.push(tr);

  if (help && ES.helpFor === it.metric_code) {
    rows.push(h('tr', { class: 'help-row' }, h('td', { colspan: 6 },
      h('b', { text: t('where_to_find') + ' — ' }), help,
      it.evidence_policy === 'required' ? h('div', { class: 'note', text: t('photo_hint') }) : null)));
  }
  return rows;
}

/** 저장 후 해당 행만 다시 그린다 — 전체 재조회 없이 상태·배지를 갱신한다 */
function refreshRow(it) {
  const tr = document.querySelector(`tr[data-metric="${it.metric_code}"]`);
  if (!tr) return;
  const fresh = sheetRow(it);
  tr.replaceWith(...fresh);
  updateProgress();
}

function updateProgress() {
  const D = ES.sheet;
  if (!D) return;
  D.progress.done = D.items.filter((i) => i.status !== 'empty' && i.status !== 'unavailable' && i.value_raw !== null).length;
  D.progress.unavailable = D.items.filter((i) => i.status === 'unavailable').length;
  D.progress.empty = D.progress.total - D.progress.done - D.progress.unavailable;
  const pct = D.progress.total ? Math.round(((D.progress.done + D.progress.unavailable) / D.progress.total) * 100) : 0;
  const value = document.querySelector('.stats .stat-value.num');
  if (value) value.textContent = `${D.progress.done + D.progress.unavailable} / ${D.progress.total}`;
  const bar = document.querySelector('.bar-fill');
  if (bar) bar.style.width = pct + '%';
}

/* ══════════════════════════════════════════════════════════
   화면 2 — 항목 입력 카드 (본사 · 모바일)
   ══════════════════════════════════════════════════════════ */

async function viewCard(view) {
  const me = S.me || {};
  const [segPeriod] = currentRoute().seg;
  ES.entity = me.default_entity || 'HQ';
  ES.period = (segPeriod && /^\d{4}-\d{2}$/.test(segPeriod)) ? segPeriod : (ES.period || thisMonth());
  if (!ES.locale || !L[ES.locale]) ES.locale = me.default_locale || 'ko';

  const r = await loadSheet();
  if (!r.ok) {
    setChildren(view, h('div', { class: 'banner fail' },
      h('h2', { text: '입력 항목을 불러올 수 없습니다' }),
      h('p', { text: (r.data && (r.data.hint || r.data.error)) || '' })));
    return;
  }
  const mine = ES.sheet.items.filter((i) => i.editable && !i.locked);
  const pending = mine.filter((i) => i.status === 'empty');
  const doneCount = mine.length - pending.length;

  const periodSel = h('select', { class: 'inline' },
    monthOptions(12).map((p) => h('option', { value: p, selected: p === ES.period }, p)));
  periodSel.addEventListener('change', () => { location.hash = `#/input/${periodSel.value}`; });

  const head = h('div', { class: 'page-head' },
    h('div', null,
      h('div', { class: 'eyebrow', text: `${ES.entity} · ${ES.period}` }),
      h('h1', { text: t('card_title') }),
      h('p', { class: 'page-desc' },
        pending.length
          ? `${t('missing_n')} ${pending.length}건 · ${t('deadline')} ${ES.sheet.deadline}`
          : t('all_done'))),
    h('div', { class: 'head-right' }, h('div', null, h('label', { text: t('period') }), periodSel)),
  );

  if (pending.length === 0) {
    setChildren(view, head,
      h('div', { class: 'banner ok' },
        h('h2', { text: t('all_done') }),
        h('p', { text: `${doneCount} / ${mine.length}` })),
      doneList(mine));
    return;
  }

  if (ES.cardIndex >= pending.length) ES.cardIndex = 0;
  const it = pending[ES.cardIndex];

  const box = h('input', {
    type: 'text', inputmode: 'decimal', class: 'big-val',
    value: it.value_raw === null ? '' : fmt(it.value_raw),
    'aria-label': nameOf(it),
  });

  const saveNext = h('button', { type: 'button', class: 'primary wide' }, t('save_next'));
  saveNext.addEventListener('click', async () => {
    const raw = box.value.trim();
    if (raw === '') { toast(t('numbers_only'), 'fail'); box.focus(); return; }
    if (!/^[\d,]+(\.\d+)?$/.test(raw)) { toast(t('numbers_only'), 'fail'); box.focus(); return; }
    saveNext.disabled = true;
    const saved = await persist(it, { value_raw: raw });
    saveNext.disabled = false;
    if (!saved) return;
    const warn = anomalyText(it);
    toast(warn ? `${nameOf(it)} — ${t('saved')} · ${warn}` : `${nameOf(it)} — ${t('saved')}`, warn ? 'fail' : 'ok');
    await route();
  });

  const markNa = h('button', { type: 'button', class: 'ghost wide' }, t('mark_unavailable'));
  markNa.addEventListener('click', async () => {
    const saved = await persist(it, { unavailable_reason_code: 'INVOICE_PENDING' });
    if (saved) { toast(`${nameOf(it)} — ${t('st_unavailable')}`); await route(); }
  });

  const help = helpOf(it);
  const card = h('div', { class: 'card big-card' },
    h('div', { class: 'card-head' },
      h('div', null,
        h('div', { class: 'eyebrow', text: `${ES.cardIndex + 1} ${t('of')} ${pending.length} · ${CAT_KO[it.category] || it.category}` }),
        h('div', { class: 'big-name', text: nameOf(it) })),
      h('span', { class: 'unit-pill big', text: it.unit_input })),
    help ? h('p', { class: 'card-help', text: help }) : null,
    h('div', { class: 'big-field' },
      h('label', { for: 'bigval', text: t('col_value') }),
      box,
      h('div', { class: 'note' },
        `${t('col_prev')} (${it.prev_period}) `,
        h('b', { class: 'num', text: it.prev_value === null ? '—' : `${fmt(it.prev_value)} ${it.unit_input}` }))),
    it.evidence_policy === 'required'
      ? h('div', { class: 'ev-box' },
          h('div', null,
            h('div', { class: 'ev-title', text: t('col_evidence') }),
            h('div', { class: 'note', text: t('photo_hint') })),
          evidenceCell(it, () => route()))
      : null,
    h('div', { class: 'stack card-actions' }, saveNext, markNa),
  );

  const nav = h('div', { class: 'actions' },
    h('button', {
      type: 'button', class: 'ghost',
      disabled: ES.cardIndex === 0,
      onclick: () => { ES.cardIndex -= 1; route(); },
    }, t('prev_item')),
    h('span', { class: 'note', text: `${doneCount} / ${mine.length}` }),
  );

  setChildren(view, head, card, nav, doneList(mine));
}

function doneList(items) {
  const filled = items.filter((i) => i.status !== 'empty');
  if (filled.length === 0) return h('div');
  return h('div', null,
    h('h3', { text: t('progress') }),
    h('div', { class: 'card flush' }, h('div', { class: 'scroll-x' }, h('table', null, h('tbody', null,
      filled.map((i) => h('tr', null,
        h('td', null,
          h('div', { class: 'name-main', text: nameOf(i) }),
          h('div', { class: 'name-sub num', text: i.metric_code })),
        h('td', { class: 'right num' },
          i.status === 'unavailable' ? t('st_unavailable') : `${fmt(i.value_raw)} ${i.unit_input}`),
        h('td', { class: 'right' }, statusBadge(i)),
      )))))));
}

/* ── 라우트 등록 ──────────────────────────────────────────── */

ROUTES.sheet = viewSheet;
ROUTES.input = viewCard;
