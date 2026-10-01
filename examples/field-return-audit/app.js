'use strict';

const $ = id => document.getElementById(id);
const MAX_BYTES = 100 * 1024 * 1024;
const state = {
  files: { baseline: null, field: null, target: null },
  attachments: { field: [], target: [] },
  demo: false,
  omitted: null,
  result: null,
  busy: false,
  generatedAt: null,
  revision: 0,
};
const labels = {
  passed: '通过', review: '需复核', deferred: '附件延后', unconfirmed: '未确认',
  baseline: '出发前基线', field: '现场采集', target: '回写后目标',
  insert: '新增', update: '修改', delete: '删除',
};
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
const size = bytes => bytes < 1024 ? `${bytes} 字节` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const descriptorBytes = item => item instanceof File ? item.size : Math.max(0, Math.floor((item?.data?.length || 0) * 3 / 4) - (item?.data?.endsWith('==') ? 2 : item?.data?.endsWith('=') ? 1 : 0));
const sumBytes = () => Object.values(state.files).reduce((sum, item) => sum + descriptorBytes(item), 0) + Object.values(state.attachments).flat().reduce((sum, item) => sum + descriptorBytes(item.file || item), 0);

function message(text, error = false) {
  $('form-message').textContent = text;
  $('form-message').classList.toggle('error', error);
}
function invalidate() {
  state.revision += 1;
  for (const id of ['export-json', 'export-csv', 'export-html']) $(id).disabled = true;
  if (!state.result) return;
  state.result = null;
  $('report-result').hidden = true;
  $('report-empty').hidden = false;
  message('输入已改变，上一份结果已失效。请重新验收。');
}
function refreshInputs() {
  for (const [slot, file] of Object.entries(state.files)) {
    $(`${slot}-detail`).textContent = file ? `${file.name} · ${size(descriptorBytes(file))}` : '尚未选择';
  }
  for (const slot of ['field', 'target']) {
    const items = state.attachments[slot];
    $(`${slot}-attachments-detail`).textContent = items.length ? `${items.length} 个附件 · ${size(items.reduce((sum, item) => sum + descriptorBytes(item.file || item), 0))} · ${items.slice(0, 3).map(item => item.path).join('、')}${items.length > 3 ? '…' : ''}` : '尚未选择附件';
  }
  $('demo-label').hidden = !state.demo;
  $('omit-attachment').hidden = !state.demo;
  $('omit-attachment').textContent = state.omitted ? '恢复合成示例的目标附件' : '模拟漏交目标附件';
  const bytes = sumBytes();
  $('size-note').textContent = `当前 ${size(bytes)} / 上限 100 MB。文件仅发送到本机服务。`;
  $('size-note').style.color = bytes > MAX_BYTES ? 'var(--red)' : '';
}
function setBusy(busy, text = '') {
  state.busy = busy;
  $('inputs').disabled = busy;
  for (const id of ['load-demo', 'reset', 'run-audit']) $(id).disabled = busy;
  $('run-audit').textContent = busy ? '正在核对证据…' : '开始验收 ↗';
  if (text) message(text);
}
function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error(`无法读取“${file.name}”，请重新选择文件。`));
    reader.readAsDataURL(file);
  });
}
async function databasePayload(file) {
  if (!file) return null;
  return file instanceof File ? { name: file.name, data: await readFile(file) } : { name: file.name, data: file.data };
}
async function attachmentPayload(items) {
  const result = [];
  for (const item of items) result.push({ path: item.path, data: item.file ? await readFile(item.file) : item.data });
  return result;
}
async function api(url, options = {}) {
  let response;
  try { response = await fetch(url, { ...options, cache: 'no-store' }); }
  catch { throw new Error('无法连接本机验收服务。请确认服务正在运行，再点击“开始验收”重试；输入已保留。'); }
  let data;
  try { data = await response.json(); }
  catch { throw new Error('本机服务返回了无法读取的结果。请检查启动终端后重试；输入已保留。'); }
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : typeof data.message === 'string' ? data.message : '验收请求未完成，请检查文件和配置后重试。');
  return data;
}

for (const picker of document.querySelectorAll('[data-file-input]')) {
  picker.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    const input = $(picker.dataset.fileInput);
    if (!input.disabled) input.click();
  });
}
for (const slot of ['baseline', 'field', 'target']) {
  $(slot).addEventListener('change', () => {
    invalidate();
    state.files[slot] = $(slot).files[0] || null;
    refreshInputs();
  });
}
for (const slot of ['field', 'target']) {
  for (const mode of ['directory', 'files']) {
    $(`${slot}-${mode}`).addEventListener('change', () => {
      invalidate();
      state.attachments[slot] = Array.from($(`${slot}-${mode}`).files).map(file => {
        const path = mode === 'directory' && file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(1).join('/') : file.name;
        return { path, file };
      });
      $(`${slot}-${mode === 'directory' ? 'files' : 'directory'}`).value = '';
      if (slot === 'target') state.omitted = null;
      refreshInputs();
    });
  }
}
for (const id of ['job-name', 'attachment-policy', 'evidence-complete', 'config']) {
  $(id).addEventListener('input', invalidate);
  $(id).addEventListener('change', invalidate);
}
$('load-demo').addEventListener('click', async () => {
  setBusy(true, '正在准备合成巡检数据…');
  try {
    const demo = await api('/api/demo');
    invalidate();
    for (const slot of ['baseline', 'field', 'target']) { state.files[slot] = demo[slot]; $(slot).value = ''; }
    for (const slot of ['field', 'target']) {
      state.attachments[slot] = demo[`${slot}_attachments`] || [];
      $(`${slot}-directory`).value = '';
      $(`${slot}-files`).value = '';
    }
    const config = demo.config || {};
    $('job-name').value = config.job_name || '合成巡检示例';
    $('attachment-policy').value = config.attachment_policy || 'required';
    $('config').value = JSON.stringify({ tables: config.tables || [], relations: config.relations || [], attachment_columns: config.attachment_columns || [] }, null, 2);
    $('evidence-complete').checked = false;
    state.demo = true;
    state.omitted = null;
    refreshInputs();
    message('合成示例已载入。请阅读并勾选现场完整声明，再开始验收；可模拟漏交附件练习恢复。');
  } catch (error) { message(error.message, true); }
  finally { setBusy(false); }
});
$('omit-attachment').addEventListener('click', () => {
  invalidate();
  if (state.omitted) {
    state.attachments.target = state.omitted;
    state.omitted = null;
    message('目标附件已恢复。请重新验收。');
  } else {
    state.omitted = state.attachments.target;
    state.attachments.target = [];
    message('已模拟漏交目标附件。验收后可定位欠项，再点击此处恢复并重试。');
  }
  refreshInputs();
});
$('reset').addEventListener('click', () => {
  invalidate();
  state.files = { baseline: null, field: null, target: null };
  state.attachments = { field: [], target: [] };
  state.demo = false;
  state.omitted = null;
  for (const id of ['baseline', 'field', 'target', 'field-directory', 'target-directory', 'field-files', 'target-files', 'job-name']) $(id).value = '';
  $('attachment-policy').value = 'required';
  $('evidence-complete').checked = false;
  $('config').value = JSON.stringify({ tables: [], relations: [], attachment_columns: [] }, null, 2);
  $('change-filter').value = '';
  refreshInputs();
  message('已清空。可以开始一份新作业。');
  $('job-name').focus();
});
$('run-audit').addEventListener('click', async () => {
  if (state.busy) return;
  if (sumBytes() > MAX_BYTES) { message('输入超过 100 MB。请缩小作业范围或减少附件后重试。', true); return; }
  let config;
  try {
    config = JSON.parse($('config').value);
    if (!config || Array.isArray(config) || typeof config !== 'object') throw new Error();
    for (const key of ['tables', 'relations', 'attachment_columns']) if (config[key] !== undefined && !Array.isArray(config[key])) throw new Error();
  } catch {
    message('高级配置格式不正确。请填写一个 JSON 对象，业务表、关联和附件列均使用数组。输入已保留。', true);
    $('config-section').open = true;
    $('config').focus();
    return;
  }
  if (!Object.values(state.files).some(Boolean)) { message('请至少选择一份数据副本，或先载入合成示例。', true); $('baseline').focus(); return; }
  invalidate();
  const revision = state.revision;
  setBusy(true, '正在读取文件并核对三方记录与附件；请保留此页面。');
  try {
    const payload = { config: { ...config, attachment_policy: $('attachment-policy').value, job_name: $('job-name').value.trim() || '未命名作业', evidence_complete: $('evidence-complete').checked } };
    for (const slot of ['baseline', 'field', 'target']) payload[slot] = await databasePayload(state.files[slot]);
    for (const slot of ['field', 'target']) payload[`${slot}_attachments`] = await attachmentPayload(state.attachments[slot]);
    const result = await api('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (revision !== state.revision) throw new Error('输入已改变，本次旧结果已丢弃。请重新验收。');
    if (!['passed', 'review', 'deferred', 'unconfirmed'].includes(result.status)) throw new Error('服务结果缺少有效验收结论。请检查启动终端后重试。');
    state.result = result;
    state.generatedAt = new Date().toLocaleString('zh-CN', { hour12: false });
    $('change-filter').value = '';
    renderReport();
    message('验收已完成。请查看右侧记录；修正输入后重新验收。');
  } catch (error) { message(error.message, true); }
  finally { setBusy(false); }
});

const isIntegerValue = value => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === 2 && value.type === 'integer' && typeof value.value === 'string' && /^-?(0|[1-9]\d*)$/.test(value.value);
function valueText(value, record = false) {
  if (value === undefined) return '∅';
  if (value === null) return '空值';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'object') {
    if (!record && isIntegerValue(value)) return `整数 · ${value.value}`;
    if (!record && value.type === 'blob') return `二进制 · ${size(value.bytes || 0)}\nSHA-256: ${value.sha256 || '未提供'}`;
    if (!record && 'bytes' in value && 'sha256' in value) return `附件 · ${size(value.bytes || 0)}\nSHA-256: ${value.sha256 || '未提供'}`;
    return JSON.stringify(value);
  }
  if (typeof value === 'string' && /^-?(0|[1-9]\d*)$/.test(value)) return `文本 · ${JSON.stringify(value)}`;
  return String(value);
}
function issueValueText(issue, side) {
  if (issue.kind === 'delete_not_applied') return side === 'expected' ? '记录不存在' : '记录仍存在';
  if (issue.kind === 'record_missing') return side === 'expected' ? '记录应存在' : '记录不存在';
  return valueText(issue[side]);
}
function table(headers, rows, classNames = []) {
  if (!rows.length) return '<p class="empty-note">本节没有待列出的记录。</p>';
  return `<div class="table-wrap"><table><thead><tr>${headers.map(header => `<th scope="col">${escapeHTML(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((cell, index) => `<td${classNames[index] ? ` class="${classNames[index]}"` : ''}>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function changesRows(result = state.result) {
  const rows = [];
  for (const change of result?.changes || []) {
    const fields = Array.isArray(change.fields) && change.fields.length ? change.fields : Array.from(new Set([...Object.keys(change.before || {}), ...Object.keys(change.expected || {}), ...Object.keys(change.actual || {})]));
    for (const field of fields.length ? fields : ['—']) {
      rows.push({ table: change.table, key: valueText(change.key, true), operation: labels[change.operation] || change.operation_label || '变更', operationCode: change.operation, field,
        before: change.before === null ? '∅' : valueText(change.before?.[field]),
        expected: change.expected === null ? '∅' : valueText(change.expected?.[field]),
        actual: change.actual === null ? '∅' : valueText(change.actual?.[field]), matched: change.matched });
    }
  }
  return rows;
}
function renderChanges() {
  const filter = $('change-filter').value.trim().toLowerCase();
  const rows = changesRows().filter(row => !filter || [row.table, row.key, row.field].some(value => String(value).toLowerCase().includes(filter)));
  $('changes-table').innerHTML = rows.length ? table(['业务表', '记录键', '操作', '字段', '出发基线', '现场应有', '目标实有', '核对'], rows.map(row => [escapeHTML(row.table), escapeHTML(row.key), `<span class="operation-tag ${['insert', 'update', 'delete'].includes(row.operationCode) ? row.operationCode : ''}">${escapeHTML(row.operation)}</span>`, escapeHTML(row.field), escapeHTML(row.before), escapeHTML(row.expected), escapeHTML(row.actual), row.matched === true ? '一致' : row.matched === false ? '不一致' : '未确认']), ['', 'mono', '', 'mono', 'value-cell', 'value-cell', 'value-cell']) : `<p class="empty-note">${filter ? '没有匹配的变更。请调整筛选条件。' : '未发现需要列出的现场变更。此项不代表整体通过。'}</p>`;
}
$('change-filter').addEventListener('input', renderChanges);
function evidenceRows(result = state.result) {
  const rows = [];
  const evidence = result?.evidence || {};
  for (const [slot, item] of Object.entries(evidence.databases || {})) {
    if (item) rows.push({ type: labels[slot] || slot, path: item.name || '未命名副本', bytes: item.bytes || 0, sha256: item.sha256 || '未提供' });
  }
  for (const slot of ['field', 'target']) {
    for (const [path, item] of Object.entries(evidence[`${slot}_attachments`] || {})) rows.push({ type: `${labels[slot]}附件`, path, bytes: item.bytes || 0, sha256: item.sha256 || '未提供' });
  }
  return rows;
}
function renderReport() {
  const result = state.result;
  const status = result.status;
  const label = labels[status];
  for (const id of ['export-json', 'export-csv', 'export-html']) $(id).disabled = false;
  $('report-empty').hidden = true;
  $('report-result').hidden = false;
  $('result-job').textContent = `${result.job_name || $('job-name').value || '未命名作业'}${state.demo ? ' / 含合成示例' : ''}`;
  $('status-label').textContent = label;
  $('status-stamp').className = `status-stamp ${status}`;
  $('status-stamp').textContent = label;
  $('result-time').textContent = `本机生成时间：${state.generatedAt}`;
  $('result-guidance').textContent = {
    passed: '已在本次配置与完整声明范围内核对一致。请保留报告和原始副本；该结论不证明现场真实性或未声明的业务规则。',
    review: '发现明确不一致，请按下方问题定位记录或附件，修正后导出新的目标副本，再重新验收。此报告不会改写数据。',
    deferred: '数据核对结果已列出，附件欠项延后单列。补齐附件并改为“必需”后重新验收，才能获得完整结论。',
    unconfirmed: '目前证据不足，无法确认完整结果。请补齐缺少的副本、有效配置与现场完整声明；已有差异仍保留在下方。',
  }[status];
  const changes = result.changes || [];
  const issues = result.issues || [];
  const deferred = result.deferred || [];
  $('summary').innerHTML = [[changes.length, '现场变更记录'], [issues.length, '待处理问题'], [deferred.length, '附件延后项']].map(([count, name]) => `<div class="summary-item"><strong>${count}</strong><span>${name}</span></div>`).join('');
  $('issues-count').textContent = `${issues.length} 项`;
  $('issues-table').innerHTML = issues.length ? table(['位置', '问题', '应有 / 实有', '恢复操作'], issues.map((issue, index) => [
    `${escapeHTML(issue.table || '作业证据')}<br><span class="mono">${escapeHTML(issue.key === undefined ? '' : valueText(issue.key, true))}${issue.field ? `<br>${escapeHTML(issue.field)}` : ''}</span>`,
    escapeHTML(issue.message || '请复核此项'),
    `应有：${escapeHTML(issueValueText(issue, 'expected'))}<br>实有：${escapeHTML(issueValueText(issue, 'actual'))}`,
    `<div class="issue-action">${escapeHTML(issue.action || '检查对应输入，修正后重新验收。')}<button type="button" class="text-button locate-button" data-issue="${index}">定位准备项 ↖</button></div>`,
  ])) : '<p class="empty-note">未发现明确问题。请结合验收结论和范围说明判断。</p>';
  $('deferred-list').innerHTML = deferred.length ? `<div class="deferred-note"><strong>附件延后清单</strong><ul>${deferred.map(item => `<li>${item.path ? `<strong class="mono">${escapeHTML(item.path)}</strong> · ` : ''}${escapeHTML(typeof item === 'string' ? item : item.message || valueText(item))}${item.action ? `；${escapeHTML(item.action)}` : ''}</li>`).join('')}</ul></div>` : '';
  renderChanges();
  $('evidence-table').innerHTML = table(['来源', '文件 / 相对路径', '大小', '内容摘要'], evidenceRows().map(row => [escapeHTML(row.type), escapeHTML(row.path), escapeHTML(size(row.bytes)), escapeHTML(row.sha256)]), ['', '', '', 'mono']);
  $('scope-table').innerHTML = table(['规则类型', '本次采用'], configurationRows().map(row => row.map(escapeHTML)));
  const limitations = [...(result.limitations || [])];
  if (state.demo) limitations.unshift('本报告包含合成示例，不代表真实用户、现场采集或业务验收。');
  limitations.push('验收只读取输入副本，不自动合并、修复或回写；源文件若仍有未提交写入或外部日志，本工具不能代表最终状态。');
  $('limitations-list').innerHTML = limitations.map(item => `<li>${escapeHTML(item)}</li>`).join('');
  $('report-heading').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$('issues-table').addEventListener('click', event => {
  const button = event.target.closest('[data-issue]');
  if (!button || !state.result) return;
  const issue = state.result.issues[Number(button.dataset.issue)];
  const kind = `${issue.kind || ''} ${issue.message || ''}`;
  let element;
  if (/attachment|附件/.test(kind)) element = $('attachment-inputs');
  else if (/declaration|complete|声明|完整/.test(kind)) element = $('evidence-complete');
  else if (/baseline|基线/.test(kind)) element = $('baseline');
  else if (/missing.*target|目标副本|目标库/.test(kind)) element = $('target');
  else if (/missing.*field|现场副本/.test(kind)) element = $('field');
  else { $('config-section').open = true; element = $('config'); }
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  element.classList.remove('flash');
  requestAnimationFrame(() => element.classList.add('flash'));
  if (element.matches('input,textarea')) element.focus({ preventScroll: true });
});

const translatedKeys = {
  table: '业务表', key: '记录键', operation: '操作', operation_label: '操作名称', fields: '变更字段', before: '出发基线', expected: '现场应有', actual: '目标实有', matched: '核对一致',
  kind: '问题类型', field: '字段', message: '说明', action: '恢复操作', path: '相对路径', references: '引用记录',
  databases: '数据副本', baseline: '出发前基线', target: '回写后目标', field_attachments: '现场附件', target_attachments: '目标附件',
  complete_declared: '已声明现场完整', tables: '已核对业务表', attachment_references: '附件引用', excluded_tables: '未纳入验收的业务表', name: '名称', bytes: '字节数', sha256: 'SHA-256',
  changes: '变更记录数', issues: '问题数', attachments: '附件数', deferred: '延后项数', inserts: '新增数', updates: '修改数', deletes: '删除数', inserted: '新增数', updated: '修改数', deleted: '删除数', type: '类型',
  configuration: '验收配置', relations: '关联规则', attachment_columns: '附件引用列', attachment_policy: '附件策略', evidence_complete: '现场完整声明', column: '引用列', parent_table: '父表', parent_column: '父列', key_source: '稳定键来源',
};
const issueKinds = {
  spatial_metadata_unconfirmed: '空间元数据未确认', spatial_metadata_changed: '空间元数据变化', missing_database: '缺少数据副本',
  incomplete_evidence: '证据完整性未声明', attachment_scope_unknown: '附件范围未声明', no_tables: '没有可验收业务表', partial_scope: '业务表范围不完整',
  schema_changed: '表结构变化', identity_unconfirmed: '稳定标识未确认', delete_not_applied: '删除未回写', record_missing: '变更记录缺失',
  value_mismatch: '字段值不一致', database_integrity: '数据库完整性问题', foreign_key: '外键悬空', relation_unconfirmed: '关联规则未确认',
  relation_orphan: '关联缺少父记录', attachment_scope_unconfirmed: '附件读取范围未确认', attachment_path: '附件路径不支持',
  field_attachment_missing: '现场附件缺失', target_attachment_missing: '目标附件缺失', attachment_missing: '附件缺失', attachment_hash_mismatch: '附件内容不一致',
};
function translated(value, translateKeys = true, context = '') {
  // 整数叶值保留协议标识，数据库字段名映射不当作协议对象。
  if (translateKeys && isIntegerValue(value)) return { type: 'integer', value: value.value };
  if (Array.isArray(value)) return value.map(item => translated(item, translateKeys, context));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    // User database keys, paths, column names and values remain exact evidence.
    const dynamic = ['before', 'expected', 'actual', 'field_attachments', 'target_attachments'].includes(key) || (key === 'key' && !Array.isArray(item));
    const humanKey = context === 'databases' ? labels[key] || key : translatedKeys[key] || key;
    return [translateKeys ? humanKey : key, translated(item, !dynamic, translateKeys ? key : '')];
  }));
  if (context === 'operation') return labels[value] || value;
  if (context === 'kind') return issueKinds[value] || value;
  if (context === 'key_source') return value === 'native' ? '数据库原生主键' : value === 'configured' ? '显式配置' : value;
  if (context === 'attachment_policy') return value === 'required' ? '必需' : value === 'deferred' ? '延后' : value;
  if (context === 'type' && value === 'blob') return '二进制';
  return value;
}
function configurationRows(result = state.result) {
  const config = result?.config || result?.evidence?.configuration || {};
  const rows = [];
  for (const item of config.tables || []) rows.push(['业务表与稳定键', `${item.name} · ${(item.key || []).join('、') || '自动发现主键'} · ${item.key_source === 'configured' ? '显式配置' : '原生主键'}`]);
  if (!(config.tables || []).length) rows.push(['业务表与稳定键', '自动发现有主键的业务表']);
  rows.push(['关联规则', (config.relations || []).length ? config.relations.map(item => `${item.table}.${item.column} → ${item.parent_table}.${item.parent_column}`).join('；') : '未声明关联规则']);
  rows.push(['附件引用列', config.attachment_columns == null ? '未配置，无法确认附件范围' : config.attachment_columns.length ? config.attachment_columns.map(item => `${item.table}.${item.column}`).join('；') : '已显式配置为空；由操作者确认没有附件引用']);
  rows.push(['附件验收方式', config.attachment_policy === 'deferred' ? '延后，欠项单列' : '必需，缺失需处理']);
  rows.push(['现场完整声明', config.evidence_complete === true ? '操作者已确认' : '尚未确认']);
  return rows;
}

function reportJSON() {
  const result = state.result;
  return {
    '产品': '归档验收台', '作业名称': result.job_name || $('job-name').value || '未命名作业', '本机生成时间': state.generatedAt,
    '含合成示例': state.demo, '验收结论': labels[result.status], '结论说明': $('result-guidance').textContent,
    '验收配置': translated(result.config || result.evidence?.configuration || {}),
    '摘要': translated(result.summary || {}), '三方变更': translated(result.changes || []), '待处理问题': translated(result.issues || []),
    '附件延后项': translated(result.deferred || []), '输入证据': translated(result.evidence || {}),
    '验收范围': Array.from($('limitations-list').children).map(item => item.textContent),
  };
}
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+@\-\t\r\n]|^\s+[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
function reportCSV() {
  const result = state.result;
  const rows = [['区段', '业务表 / 来源', '记录键 / 路径', '操作 / 结论', '字段', '出发基线 / 应有', '现场应有 / 实有', '目标实有 / 大小', '核对 / 摘要', '说明 / 恢复操作'],
    ['作业', '', result.job_name || $('job-name').value, labels[result.status], '', '', '', '', state.generatedAt, $('result-guidance').textContent],
    ['数据属性', '', '', state.demo ? '含合成示例' : '用户选择的本机文件', '', '', '', '', '', '本报告不代表现场真实性或业务规则完整性']];
  for (const row of changesRows()) rows.push(['三方变更', row.table, row.key, row.operation, row.field, row.before, row.expected, row.actual, row.matched === true ? '一致' : row.matched === false ? '不一致' : '未确认', '']);
  for (const issue of result.issues || []) rows.push(['待处理问题', issue.table || '作业证据', valueText(issue.key, true), '', issue.field || '', issueValueText(issue, 'expected'), issueValueText(issue, 'actual'), '', '', `${issue.message || ''}；${issue.action || ''}`]);
  for (const item of result.deferred || []) rows.push(['附件延后', item.table || '', item.path || '', '附件延后', item.field || '', '', '', '', '', typeof item === 'string' ? item : `${item.message || ''}；${item.action || ''}`]);
  for (const row of evidenceRows()) rows.push(['输入证据', row.type, row.path, '', '', '', '', row.bytes, row.sha256, '']);
  for (const row of configurationRows()) rows.push(['验收配置', row[0], '', '', '', '', '', '', '', row[1]]);
  for (const item of reportJSON()['验收范围']) rows.push(['验收范围', '', '', '', '', '', '', '', '', item]);
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
function reportHTML() {
  const result = state.result;
  const issueRows = (result.issues || []).map(issue => [escapeHTML(issue.table || '作业证据'), escapeHTML(valueText(issue.key, true)), escapeHTML(issue.field || ''), escapeHTML(issue.message || ''), escapeHTML(issueValueText(issue, 'expected')), escapeHTML(issueValueText(issue, 'actual')), escapeHTML(issue.action || '')]);
  const changeRows = changesRows().map(row => [escapeHTML(row.table), escapeHTML(row.key), escapeHTML(row.operation), escapeHTML(row.field), escapeHTML(row.before), escapeHTML(row.expected), escapeHTML(row.actual), row.matched === true ? '一致' : row.matched === false ? '不一致' : '未确认']);
  const title = `${reportJSON()['作业名称']} · 验收报告`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(title)}</title><style>body{max-width:1280px;margin:35px auto;padding:0 24px;color:#18392f;background:#fffdf7;font:14px/1.7 "Microsoft YaHei",sans-serif}h1,h2{font-family:"Songti SC","SimSun",serif}header{border-bottom:4px solid #18392f;margin-bottom:24px}h2{margin-top:32px;font-size:20px}.meta{color:#62736b;font-size:12px}.conclusion{padding:16px;border-left:4px solid #ce4f20;background:#f4f1e8}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;font-size:12px}th,td{padding:10px;border:1px solid #d6d8c9;text-align:left;vertical-align:top;overflow-wrap:anywhere;min-width:60px;max-width:220px}th{background:#e9ede1}.mono{font-family:monospace}footer{border-top:1px solid #d6d8c9;padding-top:20px;margin-top:35px;font-size:12px}@media print{body{max-width:none;margin:0;padding:0;font-size:10px}table{font-size:9px}th,td{padding:5px;min-width:0}thead{display:table-header-group}tr{break-inside:avoid}.table-wrap{overflow:visible}}@page{size:A4 landscape;margin:14mm}</style></head><body><header><p class="meta">归档验收台 / 本地独立报告</p><h1>${escapeHTML(title)}</h1><p class="meta">生成时间：${escapeHTML(state.generatedAt)}${state.demo ? ' · 包含合成示例，不代表真实作业' : ''}</p></header><div class="conclusion"><strong>验收结论：${escapeHTML(labels[result.status])}</strong><p>${escapeHTML($('result-guidance').textContent)}</p></div><h2>待处理与恢复</h2>${table(['业务表', '记录键', '字段', '问题', '应有', '实有', '恢复操作'], issueRows)}<h2>附件延后项</h2>${(result.deferred || []).length ? `<ul>${(result.deferred || []).map(item => `<li>${item.path ? `<strong class="mono">${escapeHTML(item.path)}</strong> · ` : ''}${escapeHTML(typeof item === 'string' ? item : item.message || valueText(item))}${item.action ? `；${escapeHTML(item.action)}` : ''}</li>`).join('')}</ul>` : '<p>没有附件延后项。</p>'}<h2>三方记录变更</h2>${table(['业务表', '记录键', '操作', '字段', '出发基线', '现场应有', '目标实有', '核对'], changeRows)}<h2>输入证据 · SHA-256</h2>${table(['来源', '文件 / 相对路径', '字节数', '内容摘要'], evidenceRows().map(row => [escapeHTML(row.type), escapeHTML(row.path), String(row.bytes), escapeHTML(row.sha256)]), ['', '', '', 'mono'])}<h2>验收配置与范围</h2>${table(['规则类型', '本次采用'], configurationRows().map(row => row.map(escapeHTML)))}<ul>${reportJSON()['验收范围'].map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul><footer>本报告只记录所提供输入的核对结果，不自动修复数据。请保留原始副本与附件以供追溯。</footer></body></html>`;
}
function download(extension, content, mime) {
  if (!state.result) return;
  const safeName = (state.result.job_name || $('job-name').value || '未命名作业').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 100);
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeName}-验收报告.${extension}`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('export-json').addEventListener('click', () => { if (state.result) download('json', JSON.stringify(reportJSON(), null, 2), 'application/json;charset=utf-8'); });
$('export-csv').addEventListener('click', () => { if (state.result) download('csv', reportCSV(), 'text/csv;charset=utf-8'); });
$('export-html').addEventListener('click', () => { if (state.result) download('html', reportHTML(), 'text/html;charset=utf-8'); });
refreshInputs();
