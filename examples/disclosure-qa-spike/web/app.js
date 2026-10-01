'use strict';

const $ = (id) => document.getElementById(id);
const SESSION_KEY = 'disclosure-review-session-v1';
const MAX_FILE = 10 * 1024 * 1024;
const MAX_TOTAL = 25 * 1024 * 1024;
let selectedFiles = [];
let report = null;
let reviews = {};
let busy = false;
let previewUrl = null;
let storageWarning = false;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined && text !== null) element.textContent = String(text);
  if (className) element.className = className;
  return element;
}

function notice(message, isError = false) {
  $('notice').textContent = message;
  $('notice').className = isError ? 'notice error' : 'notice';
  $('notice').hidden = !message;
}

function lines(id) {
  return $(id).value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
}

function currentRules() {
  return {version: $('rule-version').value.trim(), approved_by: $('approved-by').value.trim(), remove: lines('remove-rules'), retain: lines('retain-rules')};
}

function validRules(rules) {
  if (!rules || typeof rules !== 'object' || typeof rules.version !== 'string' || typeof rules.approved_by !== 'string' || !Array.isArray(rules.remove) || !Array.isArray(rules.retain)) throw new Error('规则文件格式不正确：需要版本、批准人和删除／保留词列表。');
  if (!rules.version.trim() || !rules.approved_by.trim()) throw new Error('请填写规则版本和规则批准人。');
  for (const [key, title] of [['remove', '删除'], ['retain', '保留']]) {
    if (!rules[key].length || rules[key].length > 100 || rules[key].some((value) => typeof value !== 'string' || !value.trim() || value.length > 300 || /[\u0000-\u001f]/.test(value))) throw new Error(`${title}规则需要 1–100 项，每项为不超过 300 字、不含控制字符的非空文字。`);
    const normalized = rules[key].map((value) => value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ''));
    if (new Set(normalized).size !== normalized.length) throw new Error(`${title}规则存在重复项，请合并后再检查。`);
  }
  const normalize = (value) => value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '');
  for (const remove of rules.remove) for (const retain of rules.retain) {
    const a = normalize(remove), b = normalize(retain);
    if (a.includes(b) || b.includes(a)) throw new Error('删除与保留规则存在相同或包含关系，可能彼此矛盾；请核对批准规则。');
  }
  return rules;
}

function putRules(rules) {
  $('rule-version').value = rules.version;
  $('approved-by').value = rules.approved_by;
  $('remove-rules').value = rules.remove.join('\n');
  $('retain-rules').value = rules.retain.join('\n');
}

function saveSession() {
  try {
    if (!$('remember-session').checked) { sessionStorage.removeItem(SESSION_KEY); return; }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({batch_name: $('batch-name').value, rules: currentRules(), report, reviews}));
  } catch (_) {
    if (!storageWarning) { storageWarning = true; notice('浏览器无法临时保存记录；当前工作仍可继续，请及时导出报告。', true); }
  }
}

function invalidate(message = '批次、规则或文件已改变，原检查与复核记录已失效。请重新检查。') {
  if (report) { report = null; reviews = {}; renderReport(); notice(message); }
  saveSession();
}

function setBusy(value, label = '正在检查 PDF…') {
  busy = value;
  document.querySelectorAll('#check-form input, #check-form textarea, #check-form button').forEach((element) => { element.disabled = value; });
  $('run-check').querySelector('span').textContent = value ? label : '开始双向检查';
  $('check-form').setAttribute('aria-busy', String(value));
  $('result-stamp').textContent = value ? '处理中' : report ? '检查已记录' : '尚未检查';
}

function fileSize(size) {
  return size < 1024 * 1024 ? `${(size / 1024).toFixed(0)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function renderFiles() {
  $('file-list').replaceChildren();
  selectedFiles.forEach((file, index) => {
    const item = node('li');
    item.append(node('span', file.name, 'file-name'), node('span', fileSize(file.size), 'file-size'));
    const button = node('button', '移除', 'remove-file');
    button.type = 'button';
    button.setAttribute('aria-label', `移除 ${file.name}`);
    button.addEventListener('click', () => { if (busy) return; selectedFiles.splice(index, 1); invalidate(); renderFiles(); });
    item.append(button); $('file-list').append(item);
  });
  $('file-count').textContent = selectedFiles.length ? `${selectedFiles.length} 份 PDF · ${fileSize(selectedFiles.reduce((sum, file) => sum + file.size, 0))}` : '尚未选择文件';
  $('clear-files').hidden = !selectedFiles.length;
}

function addFiles(files) {
  if (busy) return;
  const incoming = Array.from(files);
  const invalid = incoming.find((file) => !/\.pdf$/i.test(file.name) || file.size === 0 || file.size > MAX_FILE);
  if (invalid) { notice(`文件「${invalid.name}」无法加入：请选择非空 PDF，每份不超过 10 MB。`, true); return; }
  const combined = [...selectedFiles];
  let changed = false;
  let replaced = false;
  for (const file of incoming) {
    const existingIndex = combined.findIndex((existing) => existing.name.toLocaleLowerCase() === file.name.toLocaleLowerCase());
    if (existingIndex < 0) { combined.push(file); changed = true; }
    else { combined[existingIndex] = file; changed = true; replaced = true; }
  }
  if (combined.length > 20 || combined.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL) { notice('单批最多 20 份 PDF，总大小不超过 25 MB。请拆分为多个批次。', true); return; }
  if (changed) { selectedFiles = combined; invalidate(); renderFiles(); if (replaced) notice('同名 PDF 已替换，原检查和复核记录已失效。请重新检查修复后的文件。'); }
}

async function encodeFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  return {name: file.name, data: btoa(binary)};
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(url, {...options, signal: controller.signal});
    let data;
    try { data = await response.json(); } catch (_) { throw new Error('本机服务返回了无法读取的结果，请确认服务仍在运行后重试。'); }
    if (!response.ok) throw new Error(data.error || `本机检查失败（${response.status}），请检查输入后重试。`);
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('检查等待超时。请拆分批次或确认本机服务仍在运行，再重新检查。');
    if (error instanceof TypeError) throw new Error('无法连接本机服务。请确认启动命令已运行，再重试；已选择的文件仍保留。');
    throw error;
  } finally { clearTimeout(timeout); }
}

function validReport(value) {
  return value && value.schema_version === '1.0' && typeof value.batch_name === 'string' && typeof value.created_at === 'string' && value.rules && Array.isArray(value.files) && value.files.length > 0 && value.files.every((file) => file && typeof file.name === 'string' && Array.isArray(file.findings) && Array.isArray(file.coverage));
}

function reviewItems(file) {
  const items = file.findings.map((finding) => ({...finding}));
  // 某些引擎版本在 coverage 中单独列出人工边界，将它们也纳入强制复核。
  const manual = file.coverage.filter((coverage) => coverage.status === 'manual');
  if (!items.some((finding) => finding.kind === 'coverage')) manual.forEach((coverage, index) => items.push({id: `manual-${coverage.id || index}`, kind: 'coverage', severity: 'warning', page: null, location: '人工覆盖边界', message: coverage.message, rule_index: null}));
  return items;
}

function reviewKey(fileIndex, finding) { return `${fileIndex}:${finding.id}`; }

function allItems() {
  if (!report) return [];
  return report.files.flatMap((file, index) => reviewItems(file).map((finding) => ({key: reviewKey(index, finding), finding})));
}

function decision() {
  const entries = allItems();
  const completed = entries.filter(({key}) => reviews[key]?.status === 'confirmed' && reviews[key].note?.trim()).length;
  const issues = report?.files.some((file) => file.status === 'issues' || file.status === 'error' || file.error || file.findings.some((finding) => finding.severity === 'error'));
  const rework = entries.some(({key}) => reviews[key]?.status === 'rework');
  const ready = Boolean(report && !issues && !rework && entries.length > 0 && completed === entries.length);
  return {status: ready ? 'ready' : 'pending', label: ready ? '可交接 · 非安全认证' : issues ? '需修复 PDF 后重新检查' : rework ? '人工复核标记需返工' : '等待完成逐项人工复核', completed, total: entries.length, issues: Boolean(issues)};
}

function updateDecision() {
  if (!report) return;
  const state = decision();
  $('handoff-status').className = `handoff-banner${state.status === 'ready' ? '' : ' blocked'}`;
  $('handoff-status').replaceChildren(node('strong', state.label), node('p', state.status === 'ready' ? '本批次已完成工具检查与人工覆盖复核；该结论只代表交接流程完成，不能认证文件安全。' : state.issues ? '明确漏删、过删、脱敏错误或文件处理错误无法用人工确认消除。修复原文件，更新批次并重新检查。' : '每项选择“已确认”并填写实际复核备注；“待复核”或“需返工”均不能完成交接。'));
  $('review-progress').textContent = `已完成 ${state.completed} / ${state.total} 项`;
  $('result-stamp').textContent = state.status === 'ready' ? '复核已完成' : '待交接';
}

function locationText(finding) {
  const labels = {
    'visual-ocr': '图像与视觉覆盖',
    'old-revisions': '旧修订与对象恢复',
    'human-approval': '规则与披露批准',
    'object-text': '对象文字覆盖',
    'page-text': '页面文字覆盖',
    'metadata-annotations': '元数据与批注覆盖',
  };
  return `${finding.page ? `第 ${finding.page} 页 · ` : ''}${labels[finding.location] || finding.location || '文件级检查'}`;
}

function renderFinding(fileIndex, finding) {
  const key = reviewKey(fileIndex, finding);
  const value = reviews[key] || {status: 'pending', note: ''};
  const issue = finding.severity === 'error';
  const section = node('section', null, `finding${issue ? ' issue' : ''}`);
  section.dataset.reviewKey = key;
  const heading = node('div', null, 'finding-heading');
  heading.append(node('span', finding.kind === 'remove' ? '漏删线索' : finding.kind === 'retain' ? (issue ? '保留缺失' : '保留待核') : (issue ? '脱敏待修复' : '覆盖复核'), 'finding-label'), node('p', finding.message));
  section.append(heading, node('p', locationText(finding), 'finding-location'));
  if (Number.isInteger(finding.rule_index) && ['remove', 'retain'].includes(finding.kind)) {
    section.append(node('p', `对应规则：${report.rules[finding.kind]?.[finding.rule_index] || '请查看批准规则'}`, 'finding-rule'));
  }
  const fields = node('div', null, 'review-fields');
  const statusWrap = node('div');
  const statusLabel = node('label', '人工复核状态');
  const status = node('select'); status.id = `status-${fileIndex}-${finding.id}`; statusLabel.htmlFor = status.id;
  [['pending', '待复核'], ['confirmed', '已确认'], ['rework', '需返工']].forEach(([code, title]) => { const option = node('option', title); option.value = code; status.append(option); });
  status.value = ['pending', 'confirmed', 'rework'].includes(value.status) ? value.status : 'pending';
  status.setAttribute('aria-label', `${finding.message}：人工复核状态`);
  statusWrap.append(statusLabel, status);
  const noteWrap = node('div'); const noteLabel = node('label', '复核备注（必填）'); const note = node('textarea');
  note.id = `note-${fileIndex}-${finding.id}`; noteLabel.htmlFor = note.id; note.value = value.note || ''; note.maxLength = 2000; note.rows = 2;
  note.placeholder = issue ? '记录问题及修复计划；确认不能替代修复' : '记录已核对的内容、范围和实际结论';
  note.setAttribute('aria-label', `${finding.message}：复核备注`);
  noteWrap.append(noteLabel, note); fields.append(statusWrap, noteWrap); section.append(fields);
  if (issue) section.append(node('p', '此问题需要修改 PDF 后重新检查。选择“已确认”仍不能完成交接。', 'issue-warning'));
  else section.append(node('p', '确认覆盖项仅记录人工核对，不构成文件安全认证。', 'muted'));
  const persist = () => { reviews[key] = {status: status.value, note: note.value, updated_at: new Date().toISOString()}; updateDecision(); saveSession(); };
  status.addEventListener('change', () => { persist(); applyFilter(); }); note.addEventListener('input', persist);
  return section;
}

function applyFilter() {
  const filter = $('review-filter').value;
  document.querySelectorAll('.finding').forEach((element) => { const status = reviews[element.dataset.reviewKey]?.status || 'pending'; element.hidden = filter !== 'all' && status !== filter; });
}

function openPreview(file, page = 1) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  $('preview-title').textContent = file.name;
  $('pdf-preview').src = `${previewUrl}#page=${Number.isInteger(page) ? page : 1}`;
  $('preview-download').href = previewUrl; $('preview-download').download = file.name;
  $('preview-dialog').showModal();
}

function renderReport() {
  $('empty-state').hidden = Boolean(report); $('result-panel').hidden = !report;
  $('result-stamp').textContent = report ? '检查已记录' : '尚未检查';
  if (!report) { $('file-results').replaceChildren(); return; }
  $('report-title').textContent = report.batch_name;
  const date = new Date(report.created_at);
  $('report-meta').textContent = `规则 ${report.rules.version} · 批准人 ${report.rules.approved_by} · ${Number.isNaN(date.getTime()) ? report.created_at : date.toLocaleString('zh-CN', {hour12: false})}`;
  $('summary').replaceChildren();
  const issueCount = report.files.filter((file) => file.status === 'issues' || file.findings.some((finding) => finding.severity === 'error')).length;
  const errorCount = report.files.filter((file) => file.status === 'error' || file.error).length;
  const metrics = [['文件总数', report.files.length], ['发现问题', issueCount], ['处理错误', errorCount], ['复核项目', allItems().length]];
  metrics.forEach(([label, value], index) => { const metric = node('div', null, `metric${[1, 2].includes(index) && value ? ' alert' : ''}`); metric.append(node('strong', value), node('span', label)); $('summary').append(metric); });
  $('file-results').replaceChildren();
  report.files.forEach((file, index) => {
    const section = node('article', null, 'result-file'); section.dataset.fileIndex = index;
    const header = node('div', null, 'file-header'); const heading = node('div', null, 'file-heading'); heading.append(node('h4', file.name));
    const facts = node('div', null, 'file-facts'); facts.append(node('span', file.pages === null || file.pages === undefined ? '页数未知' : `${file.pages} 页`));
    const original = selectedFiles[index]?.name === file.name ? selectedFiles[index] : selectedFiles.find((candidate) => candidate.name === file.name);
    if (original) { const preview = node('button', '预览原 PDF', 'text-button'); preview.type = 'button'; preview.addEventListener('click', () => openPreview(original)); facts.append(preview); }
    else facts.append(node('span', '恢复的报告不包含 PDF，请从原文件核对'));
    heading.append(facts);
    const alert = file.status === 'issues' || file.status === 'error';
    const tag = node('span', file.status === 'error' ? '处理失败' : alert ? '有待修复' : '需人工复核', `file-tag${alert ? ' alert' : ''}`);
    header.append(node('span', String(index + 1).padStart(2, '0'), 'file-sequence'), heading, tag); section.append(header);
    section.append(node('span', `SHA-256  ${file.sha256 || '未生成'}`, 'file-hash'));
    if (file.error) section.append(node('p', file.error, 'file-error'));
    if (file.coverage.length) { const details = node('details', null, 'coverage-details'); details.append(node('summary', '查看检查范围与未覆盖项')); const list = node('ul'); file.coverage.forEach((coverage) => list.append(node('li', `${coverage.status === 'checked' ? '已检查' : '需人工'} · ${coverage.message}`))); details.append(list); section.append(details); }
    const items = reviewItems(file);
    items.forEach((finding) => section.append(renderFinding(index, finding)));
    if (!items.length) section.append(node('p', file.error ? '处理失败：请修复文件或更换 PDF，再重新检查此批次。' : '没有可复核项，请检查服务返回的覆盖记录。', 'no-items'));
    $('file-results').append(section);
  });
  updateDecision(); applyFilter();
}

function filename(suffix) { return `${(report?.batch_name || '披露审校').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 70)}-${suffix}`; }

function download(content, type, name) {
  const url = URL.createObjectURL(new Blob([content], {type})); const link = node('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportRecord() {
  return {...report, human_review: structuredClone(reviews), handoff: {...decision(), disclaimer: '交接流程完成不代表文件安全认证。明确漏删、过删、脱敏错误与文件处理错误必须修复并重新检查；扫描内容须实际人工核对。'}, exported_at: new Date().toISOString()};
}

function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char])); }

function printableReport() {
  const record = exportRecord(); const e = escapeHtml;
  const statusNames = {review: '等待人工复核', checked: '工具检查完成', issues: '存在待修复问题', error: '文件处理失败'};
  const files = record.files.map((file, index) => {
    const findings = reviewItems(file).map((finding) => {
      const review = reviews[reviewKey(index, finding)] || {status: 'pending', note: ''};
      const issue = finding.severity === 'error';
      const title = finding.kind === 'remove' ? '漏删线索' : finding.kind === 'retain' ? (issue ? '保留缺失' : '保留待核') : (issue ? '脱敏待修复' : '覆盖复核');
      return `<article><h3>${e(title)}</h3><p>${e(finding.message)}</p><p>定位：${e(locationText(finding))}</p><p>人工状态：${e({pending: '待复核', confirmed: '已确认', rework: '需返工'}[review.status] || '待复核')}</p><p>复核备注：${e(review.note || '未填写')}</p><p>记录时间：${e(review.updated_at || '未记录')}</p>${issue ? '<p class="warning">必须修复 PDF 并重新检查；人工确认不能消除此问题。</p>' : '<p>实际人工核对仅记录覆盖确认，不构成文件安全认证。</p>'}</article>`;
    }).join('');
    return `<section><h2>${e(index + 1)}. ${e(file.name)}</h2><p>状态：${e(statusNames[file.status] || '未知状态')} · 页数：${e(file.pages ?? '未知')}</p><p class="hash">SHA-256：${e(file.sha256 || '未生成')}</p>${file.error ? `<p class="warning">${e(file.error)}</p>` : ''}<h3>检查覆盖</h3><ul>${file.coverage.map((item) => `<li>${e(item.status === 'checked' ? '已检查' : '需人工')}：${e(item.message)}</li>`).join('')}</ul>${findings}</section>`;
  }).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(record.batch_name)} · 批次交接记录</title><style>body{font-family:"Noto Serif CJK SC","SimSun",serif;max-width:900px;margin:40px auto;padding:0 24px;line-height:1.7;color:#203b33}h1{font-size:28px}h2{font-size:20px;border-top:1px solid #abb5a2;padding-top:20px}h3{font-size:14px}p,li{font-size:12px;overflow-wrap:anywhere}.warning{color:#9c3927}.hash{font-family:monospace;font-size:10px;overflow-wrap:anywhere}article{border:1px solid #ccd2c3;padding:12px;margin:12px 0;break-inside:avoid}.banner{background:#edf0e5;padding:18px}.foot{font-size:10px;color:#65735e}@media print{body{margin:0;max-width:none}.print-hint{display:none}section{break-inside:auto}}</style></head><body><p class="print-hint">可使用浏览器的“打印”功能保存或打印此报告。</p><h1>${e(record.batch_name)}</h1><div class="banner"><strong>${e(record.handoff.label)}</strong><p>${e(record.handoff.disclaimer)}</p><p>已完成复核：${e(record.handoff.completed)} / ${e(record.handoff.total)} 项</p></div><p>检查时间：${e(record.created_at)} · 导出时间：${e(record.exported_at)}</p><p>规则版本：${e(record.rules.version)} · 批准人：${e(record.rules.approved_by)}</p><p class="hash">规则 SHA-256：${e(record.rule_hash)}</p><h2>批准规则</h2><h3>必须删除</h3><ul>${record.rules.remove.map((value) => `<li>${e(value)}</li>`).join('')}</ul><h3>必须保留（每份文件）</h3><ul>${record.rules.retain.map((value) => `<li>${e(value)}</li>`).join('')}</ul>${files}<p class="foot">披露审校台 · 本机处理 · 报告包含敏感规则与复核备注，请按照自身资料管理要求保管。报告不是安全认证，不能证明未覆盖的内容不存在泄漏。</p></body></html>`;
}

$('check-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (busy) return;
  let rules;
  try { rules = validRules(currentRules()); if (!$('batch-name').value.trim()) throw new Error('请填写批次名称。'); if (!selectedFiles.length) throw new Error('请先选择至少一份 PDF。'); } catch (error) { notice(error.message, true); $('notice').scrollIntoView({block: 'nearest'}); return; }
  report = null; reviews = {}; renderReport(); saveSession(); setBusy(true); notice('正在本机读取 PDF 并执行双向检查，请等待。');
  try {
    const files = [];
    for (const file of selectedFiles) files.push(await encodeFile(file));
    const data = await request('/api/check', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({batch_name: $('batch-name').value.trim(), rules, files})});
    if (!validReport(data)) throw new Error('检查结果格式不完整，请重试或查看本机服务日志。');
    report = data; reviews = {}; renderReport(); saveSession(); notice('检查已完成。请查看每份文件的问题与覆盖边界，填写实际人工复核记录。');
  } catch (error) { notice(error.message, true); } finally { setBusy(false); }
});

$('load-demo').addEventListener('click', async () => {
  if (busy) return; setBusy(true, '正在准备合成演示…');
  try {
    const demo = await request('/api/demo'); validRules(demo.rules);
    const files = demo.files.map((file) => { const raw = atob(file.data); const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0)); return new File([bytes], file.name, {type: 'application/pdf'}); });
    report = null; reviews = {}; selectedFiles = files; $('batch-name').value = demo.batch_name; putRules(demo.rules); renderFiles(); renderReport(); saveSession(); notice('已载入四份中文合成 PDF。点击“开始双向检查”体验真实检查与复核；演示不是真实业务证据。');
  } catch (error) { notice(error.message || '演示加载失败，请稍后重试。', true); } finally { setBusy(false); }
});

$('pdf-files').addEventListener('change', (event) => { addFiles(event.target.files); event.target.value = ''; });
$('clear-files').addEventListener('click', () => { if (busy) return; selectedFiles = []; invalidate(); renderFiles(); });
const dropZone = document.querySelector('.upload-zone');
dropZone.addEventListener('dragover', (event) => { event.preventDefault(); if (!busy) dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (event) => { event.preventDefault(); dropZone.classList.remove('dragover'); addFiles(event.dataTransfer.files); });
['batch-name', 'rule-version', 'approved-by', 'remove-rules', 'retain-rules'].forEach((id) => $(id).addEventListener('input', () => invalidate()));
$('remember-session').addEventListener('change', () => { saveSession(); notice($('remember-session').checked ? '已启用当前标签页临时保存。规则和报告可在刷新后恢复；PDF 不会保存。' : '已关闭临时保存，并清除当前标签页已保存的记录。'); });
$('review-filter').addEventListener('change', applyFilter);
$('forget-report').addEventListener('click', () => { report = null; reviews = {}; renderReport(); saveSession(); notice('检查报告与人工复核记录已清除，文件和规则仍可继续使用。'); });
$('export-rules').addEventListener('click', () => { try { const rules = validRules(currentRules()); download(JSON.stringify({schema_version: '1.0', rules}, null, 2), 'application/json', '披露审校-批准规则.json'); notice('规则已导出，文件包含敏感词与批准记录，请妥善保管。'); } catch (error) { notice(error.message, true); } });
$('import-rules').addEventListener('click', () => $('rule-file').click());
$('rule-file').addEventListener('change', async (event) => {
  const file = event.target.files[0]; if (!file) return;
  try { if (file.size > 1024 * 1024) throw new Error('规则文件过大，请选择不超过 1 MB 的 JSON。'); const data = JSON.parse(await file.text()); const rules = validRules(data.rules || data); putRules(rules); invalidate('已导入新规则，原检查记录失效。请核对版本与批准人后重新检查。'); saveSession(); notice('规则已导入，请核对实际批准版本和适用范围。'); } catch (error) { notice(error instanceof SyntaxError ? '规则文件不是有效 JSON，请修正文件后重新导入。' : error.message, true); } finally { event.target.value = ''; }
});
$('export-json').addEventListener('click', () => { if (report) download(JSON.stringify(exportRecord(), null, 2), 'application/json', filename('审校记录.json')); });
$('export-html').addEventListener('click', () => { if (report) download(printableReport(), 'text/html;charset=utf-8', filename('可打印交接.html')); });
$('close-preview').addEventListener('click', () => $('preview-dialog').close());
$('preview-dialog').addEventListener('close', () => { $('pdf-preview').removeAttribute('src'); $('preview-download').removeAttribute('href'); if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; } });

try {
  const saved = sessionStorage.getItem(SESSION_KEY);
  if (saved) {
    const state = JSON.parse(saved); validRules(state.rules);
    $('remember-session').checked = true; $('batch-name').value = typeof state.batch_name === 'string' ? state.batch_name : ''; putRules(state.rules);
    if (state.report && validReport(state.report)) { report = state.report; reviews = state.reviews && typeof state.reviews === 'object' ? state.reviews : {}; renderReport(); }
    notice('已恢复当前标签页临时保存的规则和报告。PDF 不会保存在浏览器；检查新文件需要重新选择，任何输入变更均使原结果失效。');
  }
} catch (_) { try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {} notice('临时保存记录无法恢复，已忽略损坏记录。请重新选择文件和规则。', true); }
renderFiles();
