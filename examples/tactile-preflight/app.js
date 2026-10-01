import { importSvg, analyze, moveLabel, serialize } from './engine.js';

const ui = new Map([...document.querySelectorAll('[id]')].map(element => [element.id, element]));
const $ = (id) => ui.get(id);
let highlightOverlay = null;
const LIMIT = 2 * 1024 * 1024;
const state = { model: null, source: '', fileName: '', confirmed: false, pending: null, analysis: null, appliedNearMm: 3, bases: new Map(), decisions: Object.create(null), selected: null, focusedRelation: null, history: [], originalDimensions: null, busy: false };
const statusNames = { pending: '待审查', accepted: '已人工确认', fix: '需要修改', manual: '需触读确认' };
const kindNames = { label: '文字标签', point: '数据点', shape: '图形', axis: '坐标轴' };
const typeNames = { overlap: '重叠', near: '近距', coincident: '重合', association: '标签关联' };
const permanentWarnings = ['圆对象采用解析距离，其他对象使用含描边的外接框估算；复杂曲线、倾斜对象和字形留白可能产生保守提示。', '字体可能未安装；屏幕预览和打印字形可能不同，文字与盲文内容需要人工校对。', '本工具不能判断凸起高度、材料、纹理区分度、触读顺序及实际打印效果。'];

function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function announce(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function validNumber(value, minimum, maximum, name) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum || result > maximum) throw new Error(`${name}必须介于 ${minimum} 和 ${maximum} 之间。`);
  return result;
}
function dimensions() { return { widthMm: validNumber($('width-mm').value, 1, 2000, '打印宽度'), heightMm: validNumber($('height-mm').value, 1, 2000, '打印高度') }; }
function threshold() { return validNumber($('near-mm').value, 0.1, 50, '近距阈值'); }
function validateSource(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('请输入有效的 SVG 源码。');
  if (new Blob([source]).size > LIMIT) throw new Error('SVG 文件超过 2 MB，请先简化图稿。');
}
async function parse(source, size, validateModel) {
  validateSource(source);
  const stage = node('div', undefined, 'import-stage');
  stage.setAttribute('aria-hidden', 'true');
  document.body.append(stage);
  try { const model = await importSvg(source, stage, size || {}); if (validateModel) validateModel(model); return model; }
  finally { stage.remove(); }
}
function currentSnapshot() {
  return { svg: serialize(state.model), dimensions: { widthMm: state.model.widthMm, heightMm: state.model.heightMm }, nearMm: state.appliedNearMm, decisions: JSON.parse(JSON.stringify(state.decisions)), selected: state.selected, confirmed: state.confirmed };
}
function saveHistory() { state.history.push(currentSnapshot()); if (state.history.length > 30) state.history.shift(); }
function setBusy(value) { state.busy = value; $('import-source').disabled = value; $('sample-label').disabled = value; $('sample-crowded').disabled = value; updateControls(); }
function updateControls() {
  const loaded = Boolean(state.model), usable = loaded && state.confirmed && !state.pending;
  $('calibrate').disabled = state.busy || (!loaded && !state.pending);
  $('reanalyze').disabled = state.busy || !usable;
  for (const id of ['export-svg', 'export-json', 'export-report']) $(id).disabled = state.busy || !usable;
  $('undo').disabled = state.busy || !state.history.length || Boolean(state.pending);
  $('reset').disabled = state.busy || !loaded || Boolean(state.pending);
  const label = loaded && state.model.objects.find(o => o.id === state.selected && o.kind === 'label');
  for (const id of ['label-target', 'move-x', 'move-y', 'apply-label']) $(id).disabled = state.busy || !label || !usable;
}
function refreshAnalysis() {
  if (state.confirmed) { state.appliedNearMm = threshold(); state.analysis = analyze(state.model, { nearMm: state.appliedNearMm }); } else state.analysis = null;
  const invalidated = reconcileDecisions();
  state.focusedRelation = null;
  render();
  return invalidated;
}
// Bind a judgement to measured geometry and meaning, not only the two object IDs.
function relationBases() {
  serialize(state.model);
  const replacements = [...state.model.svg.querySelectorAll('defs [data-preflight-resource-id]')].map(el => [el.id, el.getAttribute('data-preflight-resource-id')]);
  const fonts = [...state.model.svg.querySelectorAll('style')].flatMap(el => [...el.textContent.matchAll(/font-family:\s*['"]([^'"]+)['"]/g)].map(match => match[1]));
  [...new Set(fonts)].forEach((font, i) => replacements.push([font, `embedded-font-${i}`]));
  replacements.sort((a,b) => b[0].length - a[0].length);
  const normalize = value => { for (const [from, to] of replacements) value = value.split(from).join(to); return value; };
  const attributes = el => [...el.attributes].filter(a => a.namespaceURI !== 'http://www.w3.org/2000/xmlns/').map(a => [a.name, normalize(a.value)]).sort((a,b) => a[0].localeCompare(b[0]));
  const markup = el => el.nodeType === Node.ELEMENT_NODE ? [el.localName, attributes(el), [...el.childNodes].filter(n => n.nodeType !== Node.COMMENT_NODE).map(markup)] : normalize(el.textContent);
  const number = value => Number(value.toFixed(6));
  const objects = new Map(state.model.objects.map(object => {
    const ancestors = [];
    for (let el = object.element.parentElement; el && el !== state.model.svg; el = el.parentElement) ancestors.push([el.localName, attributes(el)]);
    return [object.id, { id: object.id, name: object.name, kind: object.kind, association: object.association, auxiliary: object.auxiliary, box: object.box.map(number), circle: object.circle ? Object.fromEntries(Object.entries(object.circle).map(([key,value]) => [key,number(value)])) : null, markup: markup(object.element), ancestors }];
  }));
  return new Map((state.analysis?.relations || []).map(relation => [relation.id, JSON.stringify({ print: { widthMm: state.model.widthMm, heightMm: state.model.heightMm }, nearMm: state.appliedNearMm, viewBox: state.model.svg.getAttribute('viewBox'), aspectRatio: state.model.svg.getAttribute('preserveAspectRatio') || '', type: relation.type, candidate: relation.candidate, gapMm: number(relation.gapMm), objects: [objects.get(relation.a), objects.get(relation.b)] })]));
}
function archiveDecision(decision, reason) {
  return { status: decision.status, note: decision.note, basis: decision.basis || null, reason, recordedAt: new Date().toISOString() };
}
function reconcileDecisions() {
  if (!state.analysis) return 0;
  const bases = relationBases();
  state.bases = bases;
  let invalidated = 0;
  for (const [id, decision] of Object.entries(state.decisions)) {
    const basis = bases.get(id) || null;
    if (decision.basis !== basis || (!basis && (decision.status !== 'pending' || decision.note))) {
      const history = [...(decision.history || [])];
      if (decision.status !== 'pending' || decision.note) {
        history.push(archiveDecision(decision, !decision.basis ? '原记录缺少审查依据，需重新审查' : !basis ? '关系已离开当前提示，原结论仅作历史' : '几何、尺寸、关联或审查策略已变化，需重新审查'));
        invalidated++;
      }
      state.decisions[id] = { status: 'pending', note: '', basis, history };
    }
  }
  return invalidated;
}
function invalidationMessage(count) { return count ? ` ${count} 项原审查记录已转为历史，当前需重新审查。` : ''; }
function basisSummary(basis) {
  if (!basis) return '原文件未记录几何依据，不能确认对应版本';
  try { const data = JSON.parse(basis); return `原间距 ${format(data.gapMm)} mm；打印 ${format(data.print.widthMm)} × ${format(data.print.heightMm)} mm；近距阈值 ${format(data.nearMm)} mm`; }
  catch { return '原几何依据不可读，需重新审查'; }
}
function historyPanel(history, title = '历史审查记录（不计入当前进度）') {
  const details = node('details', undefined, 'decision-history');
  details.append(node('summary', `${title} · ${history.length} 条`));
  for (const entry of history) details.append(node('p', `${statusNames[entry.status]} · ${entry.reason}。${basisSummary(entry.basis)}。备注：${entry.note || '未填写'}`));
  return details;
}
function install(model, { source, fileName, confirmed = false, decisions, originalDimensions } = {}) {
  state.model = model;
  state.source = source ?? state.source;
  state.fileName = fileName ?? state.fileName;
  state.confirmed = confirmed;
  state.pending = null;
  state.selected = null;
  state.focusedRelation = null;
  state.decisions = decisions || Object.create(null);
  state.history = [];
  state.originalDimensions = originalDimensions || { widthMm: model.widthMm, heightMm: model.heightMm };
  $('width-mm').value = String(Math.round(model.widthMm * 1000) / 1000);
  $('height-mm').value = String(Math.round(model.heightMm * 1000) / 1000);
  $('svg-preview').replaceChildren(model.svg);
  return refreshAnalysis();
}
async function loadSource(source, fileName, size) {
  if (state.busy) return;
  setBusy(true);
  try {
    const model = await parse(source, size);
    install(model, { source, fileName, confirmed: Boolean(size) });
    announce(size ? '图稿已载入。尺寸已确认，可以逐项审查。' : '图稿已载入。请确认实际打印宽度和高度，再开始审查。');
  } catch (error) {
    if (error.code === 'SCALE_REQUIRED') {
      state.pending = { source, fileName };
      $('width-mm').value = '';
      $('height-mm').value = '';
      $('file-name').textContent = `${fileName} · 等待尺寸校准`;
      $('size-source').textContent = '该文件使用像素或没有物理尺寸。先填写实际打印宽度和高度；当前图稿仍保留。';
      announce('需要尺寸校准：填写实际打印宽度和高度，然后点击“确认尺寸并审查”。');
    } else announce(`导入失败：${error.message} 当前图稿保持原样。`, true);
  } finally { setBusy(false); }
}
function render() {
  if (!state.model) return;
  $('file-name').textContent = state.fileName;
  $('size-source').textContent = state.model.scaleSource === 'explicit-mm' ? '源文件具有物理尺寸；请与最终打印设置核对。' : '使用已输入的打印尺寸换算毫米。';
  $('canvas-size').textContent = `${format(state.model.widthMm)} × ${format(state.model.heightMm)} mm`;
  $('object-count').textContent = `${state.model.objects.length} 个可审查对象`;
  $('relation-count').textContent = state.analysis ? String(state.analysis.relations.length) : '—';
  renderRelations(); renderObjects(); renderEditor(); renderWarnings(); drawHighlight(); updateControls();
}
function format(value) { return Number.isFinite(value) ? Number(value.toFixed(2)).toString() : '未知'; }
function relationObjects(relation) {
  return [relation.a, relation.b].map(value => typeof value === 'object' ? value : state.model.objects.find(o => o.id === value));
}
function decisionFor(id) { return state.decisions[id] || { status: 'pending', note: '', basis: state.bases.get(id) || null, history: [] }; }
function renderRelations() {
  const list = $('relations-list'); list.replaceChildren();
  const relations = state.analysis?.relations || [];
  $('relations-empty').hidden = state.confirmed && relations.length > 0;
  $('relations-empty').textContent = state.confirmed ? '当前阈值下未发现提示关系。仍需人工核对文字、纹理与实际触读效果。' : '确认实际打印尺寸后，这里会解释对象的重叠、近距与标签关联。';
  const reviewed = relations.filter(r => decisionFor(r.id).status !== 'pending').length;
  $('review-progress').textContent = state.confirmed ? `${reviewed} / ${relations.length} 已记录状态` : '确认尺寸后开始';
  for (const relation of relations) {
    const objects = relationObjects(relation), decision = decisionFor(relation.id);
    const item = node('article', undefined, `relation-item${decision.status !== 'pending' ? ' reviewed' : ''}`);
    item.dataset.relationId = relation.id;
    const title = node('div', undefined, 'relation-title');
    title.append(node('strong', objects.map(o => o?.name || o?.id || '未知对象').join(' ↔ ')), node('span', typeNames[relation.type] || '需审查', `type-tag${relation.candidate === false ? ' safe' : ''}`));
    const gap = Number.isFinite(relation.gapMm) ? `几何边界间距约 ${format(relation.gapMm)} mm。` : '';
    item.append(title, node('p', `${gap}${relation.message || '请人工核对这两个对象的关系。'}`, 'relation-message'));
    const actions = node('div', undefined, 'relation-actions');
    const select = node('select'); select.setAttribute('aria-label', '该关系的审查状态'); select.dataset.decisionStatus = relation.id;
    for (const [value, name] of Object.entries(statusNames)) { const option = node('option', name); option.value = value; select.append(option); }
    select.value = decision.status;
    select.addEventListener('change', () => { state.decisions[relation.id] = { ...decisionFor(relation.id), status: select.value }; item.classList.toggle('reviewed', select.value !== 'pending'); const stale = item.querySelector('.decision-stale'); if (stale) stale.hidden = select.value !== 'pending'; updateProgress(); });
    const locate = node('button', '定位'); locate.type = 'button'; locate.setAttribute('aria-label', `定位 ${objects.map(o => o?.name || '对象').join(' 和 ')}`);
    locate.addEventListener('click', () => { state.focusedRelation = relation.id; drawHighlight(); const label = objects.find(o => o?.kind === 'label'); if (label) selectObject(label.id, false); announce(`已定位：${objects.map(o => o?.name || '对象').join(' 与 ')}。`); });
    actions.append(select, locate);
    const label = node('label', '审查备注'); label.className = 'visually-small';
    const note = node('textarea'); note.rows = 2; note.maxLength = 5000; note.value = decision.note; note.placeholder = '写下判断依据或需要触读确认的内容'; note.setAttribute('aria-label', '该关系的审查备注'); note.dataset.decisionNote = relation.id;
    note.addEventListener('input', () => { state.decisions[relation.id] = { ...decisionFor(relation.id), note: note.value }; });
    label.append(note); item.append(actions, label);
    if (decision.history?.length) {
      const stale = node('p', '待重新审查：原结论仅作历史，不计入当前进度。', 'decision-stale'); stale.hidden = decision.status !== 'pending'; item.append(stale);
      item.append(historyPanel(decision.history));
    }
    list.append(item);
  }
  const currentIds = new Set(relations.map(r => r.id));
  const archived = Object.entries(state.decisions).filter(([id,d]) => !currentIds.has(id) && d.history?.length);
  if (archived.length) {
    const section = node('section', undefined, 'archived-decisions'); section.append(node('h3', '已不在当前提示中的历史审查'));
    for (const [id,d] of archived) { section.append(node('p', id), historyPanel(d.history)); }
    list.append(section);
  }
}
function updateProgress() {
  const relations = state.analysis?.relations || [];
  $('review-progress').textContent = `${relations.filter(r => decisionFor(r.id).status !== 'pending').length} / ${relations.length} 已记录状态`;
}
function renderObjects() {
  $('objects-list').replaceChildren(); $('objects-empty').hidden = state.model.objects.length > 0;
  for (const object of state.model.objects) {
    const button = node('button', undefined, 'object-button'); button.type = 'button'; button.dataset.objectId = object.id;
    button.setAttribute('aria-pressed', String(state.selected === object.id));
    button.append(node('strong', object.name || object.id), node('small', kindNames[object.kind] || '图形'));
    button.addEventListener('click', () => selectObject(object.id)); $('objects-list').append(button);
  }
}
function selectObject(id, clearRelation = true) {
  state.selected = id; if (clearRelation) state.focusedRelation = null;
  renderObjects(); renderEditor(); drawHighlight(); updateControls();
}
function renderEditor() {
  const object = state.model.objects.find(o => o.id === state.selected);
  $('label-target').replaceChildren(); const empty = node('option', '未指定关联'); empty.value = ''; $('label-target').append(empty);
  for (const target of state.model.objects.filter(o => ['point','shape'].includes(o.kind) && !o.auxiliary)) { const option = node('option', `${target.name || target.id} · ${kindNames[target.kind] || '图形'}`); option.value = target.id; $('label-target').append(option); }
  $('label-target').value = object?.association || '';
  $('move-x').value = '0'; $('move-y').value = '0';
  $('selection-description').textContent = object ? (object.kind === 'label' ? `已选择「${object.name || object.id}」。指定它解释的对象，或按毫米移动文字。` : `已选择「${object.name || object.id}」。此对象仅供定位；请从列表选择文字标签进行调整。`) : '从对象列表选择一个文字标签。数据点和图形保持原位。';
}
function renderWarnings() {
  const warnings = [...new Set([...(state.model.warnings || []), ...(state.analysis?.warnings || []), ...permanentWarnings])];
  $('warnings-panel').hidden = false; $('warnings-list').replaceChildren(...warnings.map(w => node('li', typeof w === 'string' ? w : String(w.message || w))));
}
function drawHighlight() {
  highlightOverlay?.remove(); highlightOverlay = null;
  if (!state.model) return;
  const relation = state.analysis?.relations.find(r => r.id === state.focusedRelation);
  const objects = relation ? relationObjects(relation) : state.model.objects.filter(o => o.id === state.selected);
  if (!objects.length) return;
  const ns = 'http://www.w3.org/2000/svg', overlay = document.createElementNS(ns, 'svg');
  overlay.classList.add('preview-overlay'); overlay.setAttribute('viewBox', `0 0 ${state.model.widthMm} ${state.model.heightMm}`); overlay.setAttribute('aria-hidden', 'true');
  overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;max-height:none;pointer-events:none;';
  for (const object of objects.filter(Boolean)) {
    if (!Array.isArray(object.box) || !object.box.every(Number.isFinite)) continue;
    const [x1,y1,x2,y2] = object.box; const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('x', x1 - .7); rect.setAttribute('y', y1 - .7); rect.setAttribute('width', Math.max(1.4, x2 - x1 + 1.4)); rect.setAttribute('height', Math.max(1.4, y2 - y1 + 1.4));
    rect.setAttribute('fill', 'none'); rect.setAttribute('stroke', relation ? '#ad3d2d' : '#163d36'); rect.setAttribute('stroke-width', relation ? '1.5' : '2'); rect.setAttribute('vector-effect', 'non-scaling-stroke'); rect.setAttribute('stroke-dasharray', relation ? '5 3' : 'none');
    overlay.append(rect);
  }
  $('svg-preview').append(overlay); highlightOverlay = overlay;
}
async function safeAction(action) {
  if (state.busy) return;
  setBusy(true);
  try { await action(); } catch (error) { announce(error.message, true); } finally { setBusy(false); }
}
$('svg-file').addEventListener('change', async (event) => {
  const file = event.target.files[0]; event.target.value = '';
  if (!file) return;
  if (file.size > LIMIT) { announce('导入失败：SVG 文件超过 2 MB。当前图稿保持原样。', true); return; }
  try { await loadSource(await file.text(), file.name); } catch (error) { announce(`无法读取文件：${error.message}`, true); }
});
$('import-source').addEventListener('click', () => loadSource($('svg-source').value, '粘贴的图稿.svg'));
for (const [id, filename] of [['sample-label','label-before.svg'], ['sample-crowded','tvl-crowded.svg']]) {
  $(id).addEventListener('click', async () => {
    if (state.busy) return;
    try { const response = await fetch(`samples/${filename}`); if (!response.ok) throw new Error('示例文件无法读取。'); await loadSource(await response.text(), `示例 · ${filename}`); }
    catch (error) { announce(`${error.message} 请使用 README 中的本地启动方式。`, true); }
  });
}
$('calibration-form').addEventListener('submit', (event) => {
  event.preventDefault(); safeAction(async () => {
    const size = dimensions(); threshold();
    let invalidated = 0;
    if (state.pending) {
      const pending = state.pending, model = await parse(pending.source, size);
      install(model, { source: pending.source, fileName: pending.fileName, confirmed: true });
    } else {
      const model = await parse(serialize(state.model), size);
      saveHistory(); state.model = model; state.confirmed = true; $('svg-preview').replaceChildren(model.svg); invalidated = refreshAnalysis();
    }
    announce(`打印尺寸已确认。间距按当前尺寸换算；逐项留下判断依据。${invalidationMessage(invalidated)}`);
  });
});
$('reanalyze').addEventListener('click', () => safeAction(() => { const nearMm = threshold(); if (nearMm !== state.appliedNearMm) saveHistory(); const invalidated = refreshAnalysis(); announce(`已按新的近距阈值审查。历史备注保留在审查文件中。${invalidationMessage(invalidated)}`); }));
$('apply-label').addEventListener('click', () => safeAction(() => {
  const object = state.model.objects.find(o => o.id === state.selected && o.kind === 'label'); if (!object) throw new Error('请选择文字标签。');
  threshold();
  const dx = validNumber($('move-x').value, -2000, 2000, '水平位移'), dy = validNumber($('move-y').value, -2000, 2000, '垂直位移');
  const association = $('label-target').value;
  if (association && !state.model.objects.some(o => o.id === association && ['point','shape'].includes(o.kind) && !o.auxiliary)) throw new Error('关联对象不存在或是辅助图元。');
  const backup = currentSnapshot();
  try { if (dx || dy) moveLabel(state.model, object.id, dx, dy); object.association = association || null; }
  catch (error) { throw new Error(`标签调整失败：${error.message}`); }
  state.history.push(backup); if (state.history.length > 30) state.history.shift(); const invalidated = refreshAnalysis();
  announce(`标签「${object.name || object.id}」已调整。其他数据对象保持原位。${invalidationMessage(invalidated)}`);
}));
function restoredDecisions(snapshot) {
  const decisions = snapshot.decisions;
  for (const [id, current] of Object.entries(state.decisions)) {
    const restored = decisions[id] || { status: 'pending', note: '', basis: null, history: [] };
    const history = [...(restored.history || []), ...(current.history || [])];
    if ((current.status !== 'pending' || current.note) && (current.basis !== restored.basis || current.status !== restored.status || current.note !== restored.note)) history.push(archiveDecision(current, '撤销前的审查记录，仅作历史'));
    const seen = new Set();
    restored.history = history.filter(entry => { const key = JSON.stringify([entry.status,entry.note,entry.basis,entry.reason]); if (seen.has(key)) return false; seen.add(key); return true; });
    decisions[id] = restored;
  }
  return decisions;
}
$('undo').addEventListener('click', () => safeAction(async () => {
  const snapshot = state.history[state.history.length - 1]; if (!snapshot) return;
  const model = await parse(snapshot.svg, snapshot.dimensions);
  state.history.pop(); state.model = model; state.decisions = restoredDecisions(snapshot); state.selected = snapshot.selected; state.confirmed = snapshot.confirmed;
  $('near-mm').value = snapshot.nearMm;
  $('width-mm').value = model.widthMm; $('height-mm').value = model.heightMm;
  $('svg-preview').replaceChildren(model.svg); refreshAnalysis(); announce('已撤销一步，标签位置、关联、尺寸、已应用阈值及对应审查记录恢复；历史记录保留。');
}));
$('reset').addEventListener('click', () => safeAction(async () => {
  threshold();
  const model = await parse(state.source, state.originalDimensions); saveHistory(); state.model = model; state.selected = null; state.confirmed = true;
  $('width-mm').value = model.widthMm; $('height-mm').value = model.heightMm;
  $('svg-preview').replaceChildren(model.svg); const invalidated = refreshAnalysis(); announce(`已恢复原始图稿及原始尺寸，历史审查记录保留。可撤销此操作。${invalidationMessage(invalidated)}`);
}));
function switchTab(id) {
  for (const name of ['relations','objects']) { const active = id === name; $(`${name}-tab`).setAttribute('aria-selected', String(active)); $(`${name}-tab`).tabIndex = active ? 0 : -1; $(`${name}-panel`).hidden = !active; }
}
for (const name of ['relations','objects']) {
  $(`${name}-tab`).addEventListener('click', () => switchTab(name));
  $(`${name}-tab`).addEventListener('keydown', (event) => { if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'relations' : event.key === 'End' ? 'objects' : name === 'relations' ? 'objects' : 'relations'; switchTab(next); $(`${next}-tab`).focus(); } });
}
function exportData() {
  return { format: 'tactile-preflight-review', version: 2, savedAt: new Date().toISOString(), fileName: state.fileName, source: state.source, modifiedSvg: serialize(state.model), print: { widthMm: state.model.widthMm, heightMm: state.model.heightMm }, originalPrint: state.originalDimensions, nearMm: state.appliedNearMm, decisions: state.decisions, relations: state.analysis.relations.map(r => ({ id: r.id, a: typeof r.a === 'object' ? r.a.id : r.a, b: typeof r.b === 'object' ? r.b.id : r.b, type: r.type, gapMm: r.gapMm, candidate: r.candidate, message: r.message })), warnings: [...new Set([...(state.model.warnings || []), ...(state.analysis.warnings || []), ...permanentWarnings])], limitations: '仅提供几何关系提示；不提供规范认证，需实际打印与触读确认。' };
}
function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type })); const link = node('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function basename() { return state.fileName.replace(/\.svg$/i, '').replace(/[\\/:*?"<>|]/g, '-').slice(0,80) || '触图'; }
$('export-svg').addEventListener('click', () => safeAction(() => { download(serialize(state.model), `${basename()}-审查后.svg`, 'image/svg+xml'); announce('修改后 SVG 已导出。请使用已确认的毫米尺寸打印。'); }));
$('export-json').addEventListener('click', () => safeAction(() => {
  const data = exportData(); validateReview(data);
  const content = JSON.stringify(data, null, 2);
  if (new Blob([content]).size > 6 * LIMIT) throw new Error('审查内容与历史超过12 MB恢复上限，未生成无法恢复的JSON。当前工作保持原样；请先导出SVG与文本报告保留内容，再在原制作软件中分图审查。');
  download(content, `${basename()}-审查.json`, 'application/json'); announce('完整审查 JSON 已导出，可用于恢复工作。');
}));
$('export-report').addEventListener('click', () => safeAction(() => {
  const data = exportData();
  const lines = ['触图审查台 · 打印前审查报告', `导出时间：${data.savedAt}`, `图稿：${state.fileName}`, `打印尺寸：${format(data.print.widthMm)} × ${format(data.print.heightMm)} mm`, `近距提示阈值：${format(data.nearMm)} mm（用户策略，不是规范合格线）`, `对象数量：${state.model.objects.length}`, '', '关系审查'];
  if (!state.analysis.relations.length) lines.push('当前阈值下无提示关系；这不等于通过触读审查。');
  for (const relation of state.analysis.relations) { const objects = relationObjects(relation), decision = decisionFor(relation.id); lines.push(`• ${objects.map(o => o?.name || o?.id || '未知对象').join(' ↔ ')} / ${typeNames[relation.type] || relation.type}`, `  几何边界间距约 ${format(relation.gapMm)} mm；${relation.message || ''}`, `  状态：${statusNames[decision.status]}${decision.status === 'pending' && decision.history?.length ? '（待重新审查）' : ''}`, `  备注：${decision.note || '未填写'}`); }
  const currentIds = new Set(state.analysis.relations.map(r => r.id));
  const archived = Object.entries(state.decisions).filter(([,d]) => d.history?.length);
  if (archived.length) {
    lines.push('', '历史审查记录（不计入当前进度，不代表当前几何的有效结论）');
    for (const [id,d] of archived) {
      lines.push(`• ${id}${currentIds.has(id) ? '' : ' / 已不在当前提示中'}`);
      for (const entry of d.history) lines.push(`  原状态：${statusNames[entry.status]}；${entry.reason}`, `  ${basisSummary(entry.basis)}`, `  原备注：${entry.note || '未填写'}`);
    }
  }
  lines.push('', '标签关联');
  for (const label of state.model.objects.filter(o => o.kind === 'label')) { const target = state.model.objects.find(o => o.id === label.association); lines.push(`• ${label.name || label.id} → ${target ? target.name || target.id : '未指定'}`); }
  lines.push('', '无法自动判断与人工确认项', ...data.warnings.map(w => `• ${w}`), '', data.limitations, '审查状态是操作者记录，不代表规范符合性或实际触读通过。');
  download(lines.join('\n'), `${basename()}-审查报告.txt`, 'text/plain;charset=utf-8'); announce('文本审查报告已导出，包含未判断项与历史备注。');
}));
function validateReview(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.format !== 'tactile-preflight-review' || ![1,2].includes(data.version)) throw new Error('不是受支持的触图审查 JSON（版本 1 或 2）。');
  validateSource(data.source); validateSource(data.modifiedSvg);
  if (!data.print || !data.originalPrint) throw new Error('审查文件缺少打印尺寸。');
  const size = { widthMm: validNumber(data.print.widthMm,1,2000,'打印宽度'), heightMm: validNumber(data.print.heightMm,1,2000,'打印高度') };
  const originalSize = { widthMm: validNumber(data.originalPrint.widthMm,1,2000,'原图宽度'), heightMm: validNumber(data.originalPrint.heightMm,1,2000,'原图高度') };
  const nearMm = validNumber(data.nearMm,.1,50,'近距阈值');
  if (!data.decisions || typeof data.decisions !== 'object' || Array.isArray(data.decisions)) throw new Error('审查记录格式不正确。');
  const decisions = Object.create(null), entries = Object.entries(data.decisions);
  if (entries.length > 10000) throw new Error('审查记录数量过多。');
  let historyCount = 0;
  function validateEntry(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !Object.hasOwn(statusNames, entry.status) || typeof entry.note !== 'string' || entry.note.length > 5000 || (entry.basis != null && (typeof entry.basis !== 'string' || entry.basis.length > 2 * LIMIT))) throw new Error('存在无效的审查状态、备注或几何依据。');
    return { status: entry.status, note: entry.note, basis: entry.basis || null };
  }
  for (const [id, decision] of entries) {
    if (id.length > 1000 || ['__proto__','constructor','prototype'].includes(id)) throw new Error('存在无效的审查关系标识。');
    const current = validateEntry(decision);
    const history = decision.history ?? [];
    if (!Array.isArray(history) || (historyCount += history.length) > 10000) throw new Error('历史审查记录格式无效或数量过多。');
    decisions[id] = { ...current, basis: data.version === 2 ? current.basis : null, history: history.map(entry => {
      const valid = validateEntry(entry);
      if (typeof entry.reason !== 'string' || entry.reason.length > 500 || typeof entry.recordedAt !== 'string' || entry.recordedAt.length > 100) throw new Error('历史审查说明格式无效。');
      return { ...valid, reason: entry.reason, recordedAt: entry.recordedAt };
    }) };
  }
  if (data.fileName !== undefined && (typeof data.fileName !== 'string' || data.fileName.length > 500)) throw new Error('图稿名称格式不正确。');
  return { size, originalSize, nearMm, decisions };
}
function validateAssociations(model) {
  for (const object of model.objects) { if (object.association && (object.kind !== 'label' || !model.objects.some(target => target.id === object.association && ['point','shape'].includes(target.kind) && !target.auxiliary))) throw new Error(`标签「${object.name || object.id}」存在无效关联。`); }
}
$('review-file').addEventListener('change', async (event) => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  if (file.size > 6 * LIMIT) { announce('审查文件超过 12 MB，无法恢复。当前工作保持原样。', true); return; }
  safeAction(async () => {
    try {
      const data = JSON.parse(await file.text()), valid = validateReview(data);
      await parse(data.source, valid.originalSize);
      const model = await parse(data.modifiedSvg, valid.size, (candidate) => { validateAssociations(candidate); analyze(candidate, { nearMm: valid.nearMm }); });
      $('near-mm').value = valid.nearMm;
      const invalidated = install(model, { source: data.source, fileName: data.fileName || file.name, confirmed: true, decisions: valid.decisions, originalDimensions: valid.originalSize });
      announce(`已恢复图稿、打印尺寸、阈值、标签关联和审查记录。${invalidationMessage(invalidated)}`);
    } catch (error) { throw new Error(`恢复失败：${error.message} 当前工作保持原样。`); }
  });
});
