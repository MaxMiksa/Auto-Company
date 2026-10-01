import { parseCSV, audit, toCSV, reportHTML, validateArchive } from './core.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'spec-evidence-project-v1';
const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
const labels = { old: '旧版规格', new: '新版规格', requirements: '采购要求' };
const severityLabels = { block: '阻断', review: '待复核', clear: '未发现差异' };
const decisionLabels = { accepted: '人工接受', rejected: '人工拒绝', 'needs-info': '需补充信息' };
const inputElements = { old: $('old-input'), new: $('new-input'), requirements: $('requirements-input') };
let state = emptyProject();
let findings = [];
let selectedId = null;
let filter = 'all';
let auditedAt = '';
let storageAvailable = true;

function emptyProject() {
  return { version: 1, title: '未命名核验项目', inputs: { old: '', new: '', requirements: '' }, reviews: {}, attachments: [], savedAt: new Date().toISOString() };
}

function announce(message, kind = '') {
  $('status').textContent = message;
  $('status').className = `status ${kind}`;
}

function errorText(error) {
  return error instanceof Error ? error.message : '操作未完成，请检查输入并重试。';
}

function byteSize(text) {
  return new Blob([text]).size;
}

function archiveText(candidate = state) {
  const archive = { ...candidate, title: candidate.title.trim() || '未命名核验项目', savedAt: new Date().toISOString() };
  validateArchive(archive);
  const text = JSON.stringify(archive, null, 2);
  if (byteSize(text) > MAX_BACKUP_BYTES) throw new Error('项目备份超过 10 MB。请减少原件或输入后重试。');
  return text;
}

function saveLocal() {
  state.savedAt = new Date().toISOString();
  try {
    localStorage.setItem(STORAGE_KEY, archiveText());
    storageAvailable = true;
    $('storage-state').textContent = '已保存到此浏览器 · 建议另存备份';
  } catch {
    storageAvailable = false;
    $('storage-state').textContent = '本机保存不可用或空间不足 · 请下载项目备份';
    announce('当前修改仍在工作区，但无法保存到浏览器。关闭前请下载项目备份。', 'error');
  }
}

function clearComputed(clearReviews = true) {
  findings = [];
  if (clearReviews) state.reviews = {};
  selectedId = null;
  auditedAt = '';
  renderResults();
  renderEvidence();
}

function changedInput(key, text) {
  state.inputs[key] = text;
  clearComputed();
  $(`${key}-count`).textContent = text.trim() ? '待核验' : '未载入';
  announce('输入已变更，旧结论与旧复核已作废。请重新执行核验。');
  saveLocal();
}

function compute(candidate) {
  const rows = {};
  for (const key of Object.keys(labels)) {
    try { rows[key] = parseCSV(candidate.inputs[key]); }
    catch (error) { throw new Error(`${labels[key]}：${errorText(error)}`); }
  }
  return { rows, results: audit(rows.old, rows.new, rows.requirements) };
}

function executeAudit() {
  clearComputed(false);
  try {
    const { rows, results } = compute(state);
    findings = results;
    auditedAt = new Date().toLocaleString('zh-CN');
    Object.keys(labels).forEach((key) => { $(`${key}-count`).textContent = `${rows[key].length} 行`; });
    selectedId = findings[0]?.id ?? null;
    renderResults();
    renderEvidence();
    announce(`核验完成：${findings.length} 条，${findings.filter((item) => item.severity === 'block').length} 条机器阻断。请逐条查看原文并留下复核意见。`, 'success');
    saveLocal();
  } catch (error) {
    announce(`核验未完成。${errorText(error)} 原输入已保留。`, 'error');
  }
}

function addText(parent, tag, content, className = '') {
  const element = document.createElement(tag);
  element.textContent = content ?? '';
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function displayValue(value, unit) {
  return value === '' || value == null ? '未提供' : `${value}${unit ? ` ${unit}` : ''}`;
}

function renderResults() {
  const hasResults = findings.length > 0;
  $('total-count').textContent = hasResults ? findings.length : '—';
  $('block-count').textContent = hasResults ? findings.filter((item) => item.severity === 'block').length : '—';
  $('review-count').textContent = hasResults ? findings.filter((item) => item.severity === 'review').length : '—';
  $('unreviewed-count').textContent = hasResults ? findings.filter((item) => !state.reviews[item.id]).length : '—';
  $('audit-time').textContent = auditedAt ? `最近核验 ${auditedAt}` : '尚未核验';
  $('export-csv').disabled = !hasResults;
  $('print-report').disabled = !hasResults;
  const shown = findings.filter((item) => filter === 'all' || item.severity === filter);
  $('visible-count').textContent = `${shown.length} 条`;
  const tbody = $('finding-rows');
  tbody.replaceChildren();
  shown.forEach((finding) => {
    const number = findings.indexOf(finding) + 1;
    const row = document.createElement('tr');
    row.dataset.testid = 'finding-row';
    row.dataset.findingId = finding.id;
    if (selectedId === finding.id) row.className = 'selected-row';
    const nameCell = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'finding-button';
    button.setAttribute('aria-label', `查看证据 ${finding.mpn} ${finding.parameter}`);
    addText(button, 'small', `${String(number).padStart(3, '0')} / ${finding.mpn}`);
    addText(button, 'strong', finding.parameter);
    button.addEventListener('click', () => {
      selectedId = finding.id;
      renderResults();
      renderEvidence();
      $('evidence').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      $('evidence-title').focus({ preventScroll: true });
    });
    nameCell.append(button);
    row.append(nameCell);
    [['oldValue', 'oldRevision', 'oldUnit'], ['newValue', 'newRevision', 'newUnit']].forEach(([value, revision, unit]) => {
      const cell = document.createElement('td');
      cell.className = 'value-cell';
      addText(cell, 'span', displayValue(finding[value], finding[unit] ?? finding.unit));
      addText(cell, 'small', finding[revision] ? `版次 ${finding[revision]}` : '版次未提供');
      row.append(cell);
    });
    const severityCell = document.createElement('td');
    const badge = addText(severityCell, 'span', severityLabels[finding.severity], `badge ${finding.severity}`);
    badge.dataset.testid = 'severity';
    row.append(severityCell);
    const reviewCell = document.createElement('td');
    reviewCell.className = 'review-state';
    const review = state.reviews[finding.id];
    if (review) {
      addText(reviewCell, 'span', decisionLabels[review.decision]);
      addText(reviewCell, 'small', review.reviewer);
    } else addText(reviewCell, 'span', '未复核');
    row.append(reviewCell);
    tbody.append(row);
  });
  $('results-empty').hidden = shown.length > 0;
  if (hasResults && !shown.length) {
    $('results-empty').querySelector('p').textContent = '当前筛选没有条目';
    $('results-empty').querySelector('small').textContent = '切换其他筛选，继续查看核验结果。';
  } else {
    $('results-empty').querySelector('p').textContent = '对照台已就绪';
    $('results-empty').querySelector('small').textContent = '载入旧版、新版与要求，执行核验后在这里查看变更。';
  }
}

function renderEvidence() {
  const finding = findings.find((item) => item.id === selectedId);
  $('evidence-empty').hidden = Boolean(finding);
  $('evidence-content').hidden = !finding;
  if (!finding) return;
  $('evidence-number').textContent = `证据 ${String(findings.indexOf(finding) + 1).padStart(3, '0')} / ${finding.mpn}`;
  $('evidence-title').textContent = finding.parameter;
  $('evidence-title').tabIndex = -1;
  $('evidence-severity').textContent = severityLabels[finding.severity];
  $('evidence-severity').className = `badge ${finding.severity}`;
  ['old', 'new'].forEach((key) => {
    const evidence = finding[`${key}Evidence`] ?? {};
    ['source', 'locator', 'quote'].forEach((field) => {
      $(`${key}-${field}`).textContent = evidence[field] || '未提供';
    });
  });
  $('evidence-requirement').textContent = finding.requirement || '未提供对应采购要求；未发现差异不代表合格或可以采购。';
  $('evidence-reasons').replaceChildren();
  (finding.reasons ?? []).forEach((reason) => addText($('evidence-reasons'), 'li', reason));
  const review = state.reviews[finding.id];
  $('reviewer').value = review?.reviewer ?? '';
  $('decision').value = review?.decision ?? 'needs-info';
  $('review-note').value = review?.note ?? '';
}

function syncWorkspace() {
  $('project-title').value = state.title;
  Object.keys(inputElements).forEach((key) => {
    inputElements[key].value = state.inputs[key];
    $(`${key}-count`).textContent = state.inputs[key].trim() ? '待核验' : '未载入';
  });
  renderResults();
  renderEvidence();
  renderAttachments();
}

function download(text, type, filename) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function filename(suffix) {
  return `${(state.title || '规格核验').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 80)}-${suffix}`;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 8192) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  }
  return btoa(binary);
}

function attachmentBlob(attachment) {
  const binary = atob(attachment.data);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: attachment.type });
}

async function addAttachments(files) {
  if (!files.length) return;
  try {
    const additions = [];
    for (const file of files) {
      const lower = file.name.toLowerCase();
      if (!lower.endsWith('.pdf') && !lower.endsWith('.txt')) throw new Error('原件仅支持 PDF 或 TXT。');
      if (file.size > MAX_BACKUP_BYTES) throw new Error(`原件「${file.name}」超过 10 MB，请使用更小文件。`);
      if (!crypto.subtle) throw new Error('当前浏览器无法计算原件摘要。请通过 localhost 打开本机工作台。');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      const sha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
      additions.push({ name: file.name, type: lower.endsWith('.pdf') ? 'application/pdf' : 'text/plain', size: file.size, sha256, data: bytesToBase64(bytes) });
    }
    const candidate = { ...state, attachments: [...state.attachments, ...additions] };
    archiveText(candidate);
    validateArchive({ ...candidate, title: candidate.title.trim() || '未命名核验项目' });
    state.attachments = candidate.attachments;
    renderAttachments();
    announce(`已附上 ${additions.length} 份原件。附件未参与自动核验，请核对证据行的来源与位置。`, 'success');
    saveLocal();
  } catch (error) {
    announce(`未添加原件。${errorText(error)} 当前项目已保留。`, 'error');
  }
}

function renderAttachments() {
  const list = $('attachment-list');
  list.replaceChildren();
  state.attachments.forEach((attachment, index) => {
    const li = document.createElement('li');
    const info = document.createElement('div');
    info.className = 'attachment-info';
    addText(info, 'strong', `${attachment.name} · ${(attachment.size / 1024).toFixed(1)} KB`);
    addText(info, 'small', `SHA-256 ${attachment.sha256}`);
    li.append(info);
    const preview = addText(li, 'button', attachment.type === 'application/pdf' ? '预览 PDF ↗' : '查看正文', 'button secondary');
    preview.type = 'button';
    preview.addEventListener('click', async () => {
      try {
        const blob = attachmentBlob(attachment);
        if (attachment.type === 'application/pdf') {
          const url = URL.createObjectURL(blob);
          const tab = window.open(url, '_blank');
          if (!tab) { URL.revokeObjectURL(url); throw new Error('浏览器阻止了新窗口，请允许此本机页面打开预览。'); }
          tab.opener = null;
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        } else {
          $('text-dialog-title').textContent = attachment.name;
          $('text-dialog-content').textContent = await blob.text();
          $('text-dialog').showModal();
        }
      } catch (error) { announce(`原件预览失败。${errorText(error)}`, 'error'); }
    });
    const remove = addText(li, 'button', '移除', 'button secondary');
    remove.type = 'button';
    remove.setAttribute('aria-label', `移除原件 ${attachment.name}`);
    remove.addEventListener('click', () => {
      state.attachments.splice(index, 1);
      renderAttachments();
      announce('原件已移除。证据行与核验结果仍保留，请确认其来源仍有效。');
      saveLocal();
    });
    list.append(li);
  });
}

async function prepareArchive(data) {
  const candidate = validateArchive(data);
  archiveText(candidate);
  for (const attachment of candidate.attachments ?? []) {
    if (!crypto.subtle) throw new Error('无法核对备份原件的摘要，请通过 localhost 打开工作台后重试。');
    const bytes = await attachmentBlob(attachment).arrayBuffer();
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const actual = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (actual !== attachment.sha256.toLowerCase()) throw new Error(`原件「${attachment.name}」的 SHA-256 摘要不匹配，备份可能损坏。`);
  }
  let results = [];
  let rows = null;
  if (Object.values(candidate.inputs).some((text) => text.trim())) {
    try {
      const computed = compute(candidate);
      results = computed.results;
      rows = computed.rows;
    } catch (error) {
      if (Object.keys(candidate.reviews).length) throw error;
    }
  }
  const validIds = new Set(results.map((finding) => finding.id));
  if (Object.keys(candidate.reviews).some((id) => !validIds.has(id))) throw new Error('备份中的复核记录与输入不匹配，不能恢复。');
  return { candidate: { ...candidate, attachments: candidate.attachments ?? [] }, results, rows };
}

function applyPrepared(prepared) {
  state = prepared.candidate;
  findings = prepared.results;
  selectedId = findings[0]?.id ?? null;
  auditedAt = findings.length ? new Date().toLocaleString('zh-CN') : '';
  filter = 'all';
  document.querySelectorAll('[data-filter]').forEach((button) => {
    const active = button.dataset.filter === filter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  syncWorkspace();
  if (prepared.rows) Object.keys(labels).forEach((key) => { $(`${key}-count`).textContent = `${prepared.rows[key].length} 行`; });
}

Object.entries(inputElements).forEach(([key, element]) => element.addEventListener('input', () => changedInput(key, element.value)));
$('project-title').addEventListener('input', () => { state.title = $('project-title').value; saveLocal(); });
document.querySelectorAll('[data-input]').forEach((element) => element.addEventListener('change', async () => {
  const file = element.files[0];
  if (!file) return;
  try {
    if (file.size > MAX_BACKUP_BYTES) throw new Error('CSV 超过 10 MB，请提取需要核验的证据行。');
    const text = await file.text();
    parseCSV(text);
    inputElements[element.dataset.input].value = text;
    changedInput(element.dataset.input, text);
    announce(`已载入「${file.name}」。请确认三份输入后执行核验。`);
    if (!storageAvailable) announce('CSV 已载入，但浏览器无法保存。关闭前请下载项目备份。', 'error');
  } catch (error) { announce(`文件读取失败。${errorText(error)} 原输入已保留。`, 'error'); }
  element.value = '';
}));
$('run-audit').addEventListener('click', executeAudit);
$('load-example').addEventListener('click', async () => {
  const button = $('load-example');
  button.disabled = true;
  $('run-audit').disabled = true;
  try {
    const response = await fetch('samples/example.json');
    if (!response.ok) throw new Error('示例文件无法读取，请检查本机启动目录。');
    const inputs = await response.json();
    const candidate = { ...emptyProject(), title: '采购规格变更 · 合成示例', inputs };
    const prepared = await prepareArchive(candidate);
    applyPrepared(prepared);
    announce('已载入合成示例并完成核验。这些记录仅用于演示，不是真实供应商或客户证据。', 'success');
    saveLocal();
  } catch (error) { announce(`示例载入失败。${errorText(error)} 当前项目未被替换。`, 'error'); }
  finally { button.disabled = false; $('run-audit').disabled = false; }
});
document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
  filter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach((item) => {
    const active = item === button;
    item.classList.toggle('active', active);
    item.setAttribute('aria-pressed', String(active));
  });
  renderResults();
}));
$('review-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!findings.some((finding) => finding.id === selectedId)) return;
  const reviewer = $('reviewer').value.trim();
  const note = $('review-note').value.trim();
  if (!reviewer || !note) { announce('请填写复核姓名和复核说明。', 'error'); return; }
  state.reviews[selectedId] = { decision: $('decision').value, reviewer, note };
  renderResults();
  announce('本条人工复核已保存。机器结论仍保留在对照台与导出报告中。', 'success');
  saveLocal();
});
$('export-csv').addEventListener('click', () => {
  if (!findings.length) return;
  try { download(toCSV(findings, state.reviews), 'text/csv;charset=utf-8', filename('核验.csv')); announce('已下载全部核验结果与复核记录。', 'success'); }
  catch (error) { announce(`导出失败。${errorText(error)}`, 'error'); }
});
$('print-report').addEventListener('click', () => {
  if (!findings.length) return;
  try {
    const html = reportHTML(findings, state.reviews, state.title || '规格核验报告');
    const tab = window.open('', '_blank');
    if (!tab) throw new Error('浏览器阻止了新窗口，请允许此本机页面打开报告。');
    tab.opener = null;
    tab.document.open();
    tab.document.write(html);
    tab.document.close();
    setTimeout(() => { tab.focus(); tab.print(); }, 150);
    announce('已打开完整报告，可在打印窗口中保存为 PDF。', 'success');
  } catch (error) { announce(`报告未打开。${errorText(error)}`, 'error'); }
});
$('backup-project').addEventListener('click', () => {
  try { download(archiveText(), 'application/json;charset=utf-8', filename('项目备份.json')); announce('项目备份已下载，包含输入、复核与原件。请妥善保管采购资料。', 'success'); }
  catch (error) { announce(`备份失败。${errorText(error)} 当前项目仍在工作区。`, 'error'); }
});
$('restore-project').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > MAX_BACKUP_BYTES) throw new Error('备份超过 10 MB，无法恢复。');
    let data;
    try { data = JSON.parse(await file.text()); }
    catch { throw new Error('文件不是有效的项目 JSON。'); }
    const prepared = await prepareArchive(data);
    applyPrepared(prepared);
    announce(prepared.results.length ? '项目已恢复，核验结果已根据备份输入重新计算。' : '项目草稿已恢复，原输入已保留。请完善 CSV 后执行核验。', 'success');
    saveLocal();
  } catch (error) { announce(`恢复失败。${errorText(error)} 当前项目未被替换。`, 'error'); }
  event.target.value = '';
});
$('attachment-files').addEventListener('change', async (event) => {
  await addAttachments(Array.from(event.target.files));
  event.target.value = '';
});
$('clear-project').addEventListener('click', () => $('clear-dialog').showModal());
$('cancel-clear').addEventListener('click', () => $('clear-dialog').close());
$('confirm-clear').addEventListener('click', () => {
  state = emptyProject();
  clearComputed();
  syncWorkspace();
  $('clear-dialog').close();
  try { localStorage.removeItem(STORAGE_KEY); $('storage-state').textContent = '项目已清空 · 输入仅在本机使用'; }
  catch { $('storage-state').textContent = '浏览器不允许访问本机存储'; }
  announce('当前项目已清空，可开始新的核验。');
});
$('close-text').addEventListener('click', () => $('text-dialog').close());
const testIds = { 'old-input': 'input-old', 'new-input': 'input-new', 'requirements-input': 'input-requirements', 'run-audit': 'audit-button', decision: 'review-decision', reviewer: 'reviewer', 'review-note': 'note', 'export-csv': 'export-csv', 'backup-project': 'export-json', 'restore-project': 'import-json', status: 'status' };
Object.entries(testIds).forEach(([id, testId]) => { $(id).dataset.testid = testId; });
$('review-form').querySelector('button').dataset.testid = 'save-review';
syncWorkspace();
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    const data = validateArchive(JSON.parse(saved));
    const prepared = await prepareArchive(data);
    applyPrepared(prepared);
    announce(prepared.results.length ? '已恢复此浏览器保存的项目。核验结果已由当前输入重新计算。' : '已恢复此浏览器保存的项目草稿。请完善输入后执行核验。', 'success');
    $('storage-state').textContent = '已恢复此浏览器项目 · 建议另存备份';
  }
} catch {
  $('storage-state').textContent = '无法读取本机保存 · 可以恢复已下载备份';
  announce('本机保存未通过校验或无法读取，未应用其中的数据。原保存仍保留；可恢复其他备份，或开始新项目。', 'error');
}
