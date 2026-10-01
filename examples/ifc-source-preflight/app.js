'use strict';

const $ = (id) => document.getElementById(id);
const state = { old: null, new: null, report: null, busy: false, synthetic: false, requestId: 0 };
const versionLabel = (version) => version === 'old' ? '基准 A' : version === 'new' ? '当前 B' : '双版本';
const display = (value, fallback = '未提供') => value === null || value === undefined || value === '' ? fallback : String(value);
const number = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '不可确定';
  return new Intl.NumberFormat('zh-CN', { maximumSignificantDigits: 12, ...(value !== 0 && Math.abs(value) < 0.000001 ? { notation: 'scientific' } : {}) }).format(value);
};
const entity = (value) => value === null || value === undefined ? '无实体引用' : `#${value}`;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = String(text);
  if (className) element.className = className;
  return element;
}

function feedback(message, type = '') {
  $('feedback').textContent = message;
  $('feedback').className = `feedback ${type}`;
  $('feedback').hidden = !message;
}

function updateInputs() {
  for (const version of ['old', 'new']) {
    const file = state[version];
    $(`${version}-file-info`).textContent = file ? file.name : '选择文件或拖到这里';
    $(`${version}-file-info`).parentElement.classList.toggle('loaded', Boolean(file));
  }
  $('analyze-button').disabled = state.busy || !state.old || !state.new;
}

function setBusy(busy) {
  state.busy = busy;
  $('input-controls').disabled = busy;
  $('load-demo').disabled = busy;
  $('demo-case').disabled = busy;
  $('reset-button').disabled = busy;
  $('analyze-button').querySelector('span').textContent = busy ? '正在读取与复核…' : '开始来源复核';
  $('analysis-form').setAttribute('aria-busy', String(busy));
  updateInputs();
}

function invalidate(message = '') {
  state.report = null;
  $('results-content').hidden = true;
  $('empty-state').hidden = false;
  $('result-state').textContent = state.old && state.new ? '版本已就绪' : '待载入版本';
  $('result-state').classList.remove('completed');
  feedback(message);
}

async function request(url, options) {
  let response;
  try { response = await fetch(url, options); }
  catch { throw new Error('无法连接本机服务。请确认服务仍在运行，重新载入后再试。'); }
  let data;
  try { data = await response.json(); }
  catch { throw new Error('本机服务未返回有效结果。请重启服务后重新复核。'); }
  if (!response.ok) throw new Error(data.error || '本次复核未完成，请检查文件后重试。');
  return data;
}

async function selectFile(version, file) {
  if (!file || state.busy) return;
  if (!file.name.toLowerCase().endsWith('.ifc')) {
    feedback('请选择 .ifc 文件。其他格式请先在建模工具中导出为 IFC，再重新选择；此前有效输入保持不变。', 'error');
    $(`${version}-file`).value = '';
    return;
  }
  invalidate('正在读取所选文件…');
  setBusy(true);
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('单个文件超过 10 MiB 本地处理上限。请缩小导出范围后重试。');
    const bytes = await file.arrayBuffer();
    let content;
    try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw new Error('文件不是有效 UTF-8 文本。请导出 UTF-8 IFC，或使用 STEP Unicode 转义，再重新选择。'); }
    if (!content.trim()) throw new Error('文件为空。请重新导出 IFC 后选择有效文件。');
    state[version] = { name: file.name, content };
    state.synthetic = false;
    invalidate(state.old && state.new ? '两个版本已就绪。确认构件范围和体积字段后，开始来源复核。' : '文件已载入，请继续选择另一版本。');
  } catch (error) {
    state[version] = null;
    feedback(error.message || '无法读取文件。请重新选择本机可读的 IFC 文件。', 'error');
  } finally { setBusy(false); }
}

for (const version of ['old', 'new']) {
  $(`${version}-file`).addEventListener('change', (event) => selectFile(version, event.target.files[0]));
  const zone = $(`${version}-drop`);
  for (const eventName of ['dragenter', 'dragover']) zone.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (!state.busy) zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('drag-over');
    if (event.dataTransfer.files.length !== 1) {
      feedback('每个版本区域请放入一个 IFC 文件。请分别选择基准版和当前版。', 'error');
      return;
    }
    selectFile(version, event.dataTransfer.files[0]);
  });
}

for (const id of ['element-type', 'quantity-name']) $(id).addEventListener('change', () => invalidate('复核范围已改变，旧结果已失效。请重新开始来源复核。'));

$('load-demo').addEventListener('click', async () => {
  if (state.busy) return;
  setBusy(true);
  invalidate();
  feedback('正在载入合成 IFC 样例…', 'loading');
  try {
    const data = await request(`/api/demo?case=${encodeURIComponent($('demo-case').value)}`);
    state.old = data.old;
    state.new = data.new;
    state.synthetic = true;
    $('old-file').value = '';
    $('new-file').value = '';
    $('element-type').value = data.element_type || 'IfcElement';
    $('quantity-name').value = data.quantity_name || 'NetVolume';
    invalidate('合成样例已载入。点击“开始来源复核”运行真实解析；样例不代表真实项目。');
  } catch (error) { feedback(error.message, 'error'); }
  finally { setBusy(false); }
});

$('analysis-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.busy || !state.old || !state.new) return;
  const requestId = ++state.requestId;
  const payload = { old: state.old, new: state.new, element_type: $('element-type').value, quantity_name: $('quantity-name').value };
  setBusy(true);
  invalidate();
  $('result-state').textContent = '复核进行中';
  feedback('正在解析两个版本，整理数量来源、单位与材料归属。请稍候…', 'loading');
  try {
    const report = await request('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (requestId !== state.requestId) return;
    state.report = report;
    resetFilters();
    renderReport();
    feedback(state.synthetic ? '合成样例复核完成。下方结果来自本次 IFC 解析，仅用于理解复核流程。' : '复核完成。先查看待复核问题，再判断已知小计与完整差量。');
  } catch (error) {
    $('result-state').textContent = '需要重新复核';
    feedback(`${error.message} 输入仍保留，可更换文件或调整范围后重试。`, 'error');
  } finally { setBusy(false); }
});

function metric(label, value, note, warning = false) {
  const card = node('div', undefined, `summary-card${warning ? ' warning' : ''}`);
  card.append(node('span', label, 'metric-label'), node('span', value, 'metric-value'), node('span', note, 'metric-note'));
  return card;
}

function renderReport() {
  const report = state.report;
  const old = report.versions.old;
  const current = report.versions.new;
  const summary = report.summary;
  const issues = report.issues || [];
  const sources = report.sources || [];
  $('results-content').hidden = false;
  $('empty-state').hidden = true;
  $('result-state').textContent = state.synthetic ? '合成样例 / 已复核' : '双版本 / 已复核';
  $('result-state').classList.add('completed');
  $('summary-grid').replaceChildren(
    metric('构件对象 · 基准 / 当前', `${old.object_count} / ${current.object_count}`, `${display(old.schema)} → ${display(current.schema)}`),
    metric('原始数量来源', sources.length, `基准 ${old.source_count} 条 · 当前 ${current.source_count} 条`),
    metric('待复核问题', issues.length, issues.length ? '结论需结合来源缺口' : '本次范围未发现来源问题', Boolean(issues.length)),
    metric('完整体积差量 · m³', number(summary.complete_delta_m3), summary.complete_delta_m3 == null ? '来源不完整，不能给出完整差量' : '当前版本 − 基准版本', summary.complete_delta_m3 == null)
  );
  $('summary-grid').firstElementChild.id = 'summary-objects';
  $('identity-note').textContent = summary.complete_delta_m3 == null ? '来源或可比口径仍有缺口，完整差量不可确定。' : '来源完整不等于工程数量准确，仍需专业复核。';
  $('model-boundaries').textContent = `${display(report.notice, '模型数量不等于采购量。')} 跨版本对象按 GlobalId 对应；新增、删除与标识重建仍需结合模型复核。已知子集差量：${number(summary.known_delta_m3)} m³，不代表完整差量。`;
  $('issue-count').textContent = `${issues.length} 项`;
  $('source-count').textContent = `${sources.length} 条`;
  renderIssues(issues);
  renderMaterials(report.materials || []);
  renderObjects(report.objects || []);
  renderSources();
}

function renderIssues(issues) {
  const list = $('issues-list');
  list.replaceChildren();
  if (!issues.length) { list.append(node('p', '未发现本次范围内的数量来源问题。仍须人工确认模型和导出设置是否符合实际工程。', 'no-issues')); return; }
  issues.forEach((issue, index) => {
    const button = node('button', undefined, 'issue-button');
    button.type = 'button';
    button.dataset.guid = issue.guid || '';
    button.dataset.version = issue.version;
    const copy = node('span', undefined, 'issue-copy');
    copy.append(node('strong', issue.message), node('small', `${versionLabel(issue.version)} · ${entity(issue.element_entity)} · ${display(issue.guid, '无 GlobalId')} · ${display(issue.code)}`));
    button.append(node('span', String(index + 1).padStart(2, '0'), 'issue-number'), copy, node('span', '↓', 'issue-arrow'));
    button.addEventListener('click', () => locateIssue(issue));
    list.append(button);
  });
}

function quantityCell(value) {
  const cell = node('td', undefined, 'numeric');
  cell.append(node('span', number(value)));
  if (value != null) cell.append(node('span', 'm³', 'number-unit'));
  return cell;
}

function renderMaterials(materials) {
  $('materials-body').replaceChildren();
  for (const material of materials) {
    const row = node('tr');
    const complete = material.complete_delta_m3 != null;
    const status = node('td');
    status.append(node('span', complete ? '可给出完整差量' : '仅已知小计', `badge${complete ? '' : ' warning'}`));
    row.append(node('td', display(material.material, '材料未确定')), quantityCell(material.old_known_m3), quantityCell(material.new_known_m3), quantityCell(material.complete_delta_m3), status);
    $('materials-body').append(row);
  }
  if (!materials.length) emptyRow($('materials-body'), 5, '所选范围没有可归属材料的体积来源。请查看数量和材料缺口。');
}

function renderObjects(objects) {
  $('objects-body').replaceChildren();
  for (const object of objects) {
    const row = node('tr');
    const identity = node('td');
    identity.append(node('span', display(object.new_name || object.old_name, '未命名对象'), 'cell-main'), node('span', display(object.guid, '无 GlobalId'), 'cell-detail'), node('span', `${entity(object.old_entity)} → ${entity(object.new_entity)}`, 'cell-detail'));
    row.append(identity, node('td', display(object.status)), quantityCell(object.old_value_m3), quantityCell(object.new_value_m3), quantityCell(object.delta_m3));
    $('objects-body').append(row);
  }
  if (!objects.length) emptyRow($('objects-body'), 5, '没有可按 GlobalId 对应的对象。请检查构件范围及身份问题。');
}

function rowIssues(source) {
  return (state.report.issues || []).filter((issue) => issue.version === source.version && issue.element_entity === source.element_entity);
}

function renderSources() {
  if (!state.report) return;
  const query = $('source-search').value.trim().toLocaleLowerCase();
  const version = $('filter-version').value;
  const issueFilter = $('filter-issue').value;
  const all = state.report.sources || [];
  const filtered = all.filter((source) => {
    const issues = rowIssues(source);
    return (version === 'all' || source.version === version) && (issueFilter === 'all' || (issueFilter === 'issues' ? issues.length > 0 : issues.length === 0 && source.selected && source.value_m3 != null)) && (!query || [source.name, source.guid, source.tag, source.material, source.qset_name, source.quantity_name, source.element_type, source.element_entity].some((value) => String(value ?? '').toLocaleLowerCase().includes(query)));
  });
  $('filter-status').textContent = `显示 ${filtered.length} / ${all.length} 条来源。两版选定数量字段：${state.report.selection.quantity_name}。非选定字段保留在底稿中，不计入小计。`;
  $('sources-body').replaceChildren();
  for (const source of filtered) {
    const row = node('tr');
    row.dataset.version = source.version;
    row.dataset.guid = source.guid || '';
    row.dataset.element = String(source.element_entity);
    row.tabIndex = -1;
    const identity = node('td');
    identity.append(node('span', `${versionLabel(source.version)} · ${display(source.name, '未命名对象')}`, 'cell-main'), node('span', `${entity(source.element_entity)} · ${display(source.element_type)}`, 'cell-detail'), node('span', display(source.guid, '无 GlobalId'), 'cell-detail'));
    const material = node('td');
    material.append(node('span', display(source.material, '未确定材料'), 'cell-main'), node('span', `材料实体 ${entity(source.material_entity)}`, 'cell-detail'));
    if (source.material_raw) {
      const details = node('details', undefined, 'raw-details');
      details.append(node('summary', '查看材料原定义'), node('pre', typeof source.material_raw === 'string' ? source.material_raw : JSON.stringify(source.material_raw, null, 2)));
      material.append(details);
    }
    const quantity = node('td');
    quantity.append(node('span', `${display(source.qset_name, '无数量集')} / ${display(source.quantity_name, '无数量字段')}`, 'cell-main'), node('span', `${source.scope === 'type' ? '类型级' : '实例级'} · 数量集 ${entity(source.qset_entity)} · 数量 ${entity(source.quantity_entity)}`, 'cell-detail'), node('span', `关系 ${entity(source.relation_entity)} · 计量依据 ${display(source.measurement_basis, '未声明')}`, 'cell-detail'));
    const value = node('td', undefined, 'numeric');
    value.append(node('span', source.value_m3 == null ? '不可确定' : `${number(source.value_m3)} m³`, 'cell-main'), node('span', `原值 ${display(source.raw_value, '缺失')} ${display(source.unit_name, '')}${display(source.unit_prefix, '')}`, 'cell-detail'), node('span', `${source.unit_origin === 'quantity-explicit' ? '数量显式单位' : source.unit_origin === 'project-volume' ? '项目体积单位' : '单位未确定'} · ${entity(source.unit_entity)}`, 'cell-detail'));
    const status = node('td');
    const issues = rowIssues(source);
    status.append(node('span', display(source.status), `badge${issues.length ? ' warning' : ''}`));
    if (!source.selected) status.append(node('span', '非选定字段', 'badge'));
    issues.forEach((issue) => status.append(node('span', issue.message, 'cell-detail')));
    row.append(identity, material, quantity, value, status);
    $('sources-body').append(row);
  }
  if (!filtered.length) emptyRow($('sources-body'), 5, '没有匹配的来源。试着重置筛选，或检查构件范围。');
}

function emptyRow(body, columns, message) {
  const row = node('tr');
  const cell = node('td', message, 'empty-table');
  cell.colSpan = columns;
  row.append(cell);
  body.append(row);
}

function resetFilters() {
  $('filter-version').value = 'all';
  $('filter-issue').value = 'all';
  $('source-search').value = '';
}

function locateIssue(issue) {
  resetFilters();
  if (issue.element_entity == null && !issue.guid) {
    renderSources();
    $('sources-title').scrollIntoView({ behavior: 'smooth', block: 'center' });
    feedback(`这是版本或范围层级的问题：${issue.message}。没有单一对应的来源行，请核对两版导出范围、计量依据与项目设置。`);
    return;
  }
  $('filter-version').value = ['old', 'new'].includes(issue.version) ? issue.version : 'all';
  $('source-search').value = issue.guid || String(issue.element_entity || '');
  renderSources();
  const target = Array.from($('sources-body').rows).find((row) => (row.dataset.element === String(issue.element_entity) || (issue.guid && row.dataset.guid === issue.guid)) && (!['old', 'new'].includes(issue.version) || row.dataset.version === issue.version));
  if (target) {
    target.classList.add('focus-row');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.focus({ preventScroll: true });
  } else {
    $('sources-title').scrollIntoView({ behavior: 'smooth', block: 'center' });
    feedback('该问题没有数量来源行（例如缺少数量或对象身份）。问题清单中的版本和实体编号可用于回到建模工具定位。');
  }
}

for (const id of ['filter-version', 'filter-issue']) $(id).addEventListener('change', renderSources);
$('source-search').addEventListener('input', renderSources);
$('clear-filters').addEventListener('click', () => { resetFilters(); renderSources(); });

function csvCell(value) {
  let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (typeof value === 'string' && /^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function download(filename, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = node('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('export-json').addEventListener('click', () => {
  if (state.report) download('量源复核-完整底稿.json', JSON.stringify(state.report, null, 2), 'application/json;charset=utf-8');
});

$('export-csv').addEventListener('click', () => {
  if (!state.report) return;
  const report = state.report;
  const columns = ['记录类别', '版本', '对象实体', 'GlobalId', '对象名称', '材料', '数量集', '数量字段', '作用层级', '关系实体', '数量集实体', '数量实体', '原始值', '原始单位', '单位来源', '换算系数', '体积m³', '基准已知小计m³', '当前已知小计m³', '已知子集差量m³', '完整差量m³', '状态或问题', '完整原始记录'];
  const lines = [columns];
  lines.push(['复核摘要', '', '', '', '', '', '', report.selection.quantity_name, '', '', '', '', '', '', '', '', '', '', '', report.summary.known_delta_m3, report.summary.complete_delta_m3, report.notice, { selection: report.selection, versions: report.versions, summary: report.summary }]);
  for (const source of report.sources || []) lines.push(['数量来源', versionLabel(source.version), source.element_entity, source.guid, source.name, source.material, source.qset_name, source.quantity_name, source.scope, source.relation_entity, source.qset_entity, source.quantity_entity, source.raw_value, source.unit_raw || source.unit_name, source.unit_origin, source.factor_to_m3, source.value_m3, '', '', '', '', source.status, source]);
  for (const issue of report.issues || []) lines.push(['复核问题', versionLabel(issue.version), issue.element_entity, issue.guid, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', issue.message, issue]);
  for (const material of report.materials || []) lines.push(['材料小计', '', '', '', '', material.material, '', '', '', '', '', '', '', '', '', '', '', material.old_known_m3, material.new_known_m3, material.known_delta_m3, material.complete_delta_m3, material.complete_delta_m3 == null ? '仅已知小计' : '可给出完整差量', material]);
  for (const object of report.objects || []) lines.push(['对象对应', '', object.new_entity || object.old_entity, object.guid, object.new_name || object.old_name, object.new_material || object.old_material, '', '', '', '', '', '', '', '', '', '', '', object.old_value_m3, object.new_value_m3, '', object.delta_m3, object.status, object]);
  download('量源复核-完整底稿.csv', '\ufeff' + lines.map((line) => line.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
});

$('reset-button').addEventListener('click', () => {
  if (state.busy) return;
  state.old = null;
  state.new = null;
  state.synthetic = false;
  state.requestId++;
  $('analysis-form').reset();
  resetFilters();
  invalidate('工作台已清空。请选择新的版本，或载入合成样例。');
  updateInputs();
  $('old-file').focus();
});

async function loadCases() {
  try {
    const { cases } = await request('/api/demo');
    if (!Array.isArray(cases) || !cases.length) return;
    $('demo-case').replaceChildren();
    for (const item of cases) {
      const option = node('option', item.label);
      option.value = item.id;
      option.title = item.description || item.label;
      $('demo-case').append(option);
    }
  } catch { feedback('未能载入样例目录。请确认本机服务正在运行；仍可选择自己的 IFC 文件。', 'error'); }
}

loadCases();
