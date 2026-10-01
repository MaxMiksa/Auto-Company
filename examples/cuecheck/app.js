import {
  LIMITS, DEFAULT_RULES, parseSrt, parseTime, formatTime,
  analyze, validateRules, serializeSrt, createReport,
} from './core.js';

const $ = (id) => document.getElementById(id);
let cues = [];
let rules = { ...DEFAULT_RULES };
let result = null;
let fileName = '';
let selectedId = null;
let filter = 'all';
let visibleCount = 100;
let editDirty = false;
let rulesDirty = false;
let unsaved = false;
let busy = false;
let loadToken = 0;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function notice(message = '') { $('notice').textContent = message; }
function showError(message = '') {
  $('error-banner').hidden = !message;
  $('error-banner').textContent = message;
}
function issueList(id) { return result?.issues.filter((item) => item.cueId === id) ?? []; }
function selectedCue() { return cues.find((cue) => cue.id === selectedId); }
function hasPendingWork() { return editDirty || unsaved; }
function mayReplace() {
  return !hasPendingWork() || window.confirm('当前有未下载的修改。继续会丢弃这些修改，是否继续？');
}

function updateExport() {
  const unavailable = !result || busy || editDirty || rulesDirty;
  $('download-srt').disabled = unavailable || result.stats.errors > 0;
  $('download-report').disabled = unavailable;
  $('draft-status').textContent = editDirty ? '有待应用的修改' : '与检查结果一致';
  $('apply-edit').disabled = !editDirty || busy;
  $('discard-edit').disabled = !editDirty || busy;
  if (busy) $('export-hint').textContent = '正在读取字幕…';
  else if (!result) $('export-hint').textContent = '导入字幕后生成可下载的检查结果。';
  else if (editDirty) $('export-hint').textContent = '请先应用或放弃编辑，再下载当前结果。';
  else if (rulesDirty) $('export-hint').textContent = '检查规则已变更，请先应用规则并重新检查。';
  else if (result.stats.errors) $('export-hint').textContent = '请修复全部错误后下载 SRT；现在可下载问题报告。';
  else if (result.stats.warnings) $('export-hint').textContent = '复核提示不会阻止下载。请结合音视频确认后交付。';
  else $('export-hint').textContent = '未发现本工具覆盖的问题；仍需人工核对音视频。';
}

function setBusy(value) {
  busy = value;
  for (const id of ['file-input', 'load-example', 'load-clean', 'apply-rules',
    'edit-start', 'edit-end', 'edit-text', 'min-duration', 'max-duration', 'max-cps', 'max-lines']) $(id).disabled = value;
  updateExport();
}

function matchingCues() {
  const ids = new Set((result?.issues ?? [])
    .filter((issue) => filter === 'issues' || (filter === 'errors' ? issue.severity === 'error' : issue.severity === 'warning'))
    .map((issue) => issue.cueId));
  return filter === 'all' ? cues : cues.filter((cue) => ids.has(cue.id));
}

function renderList() {
  const list = $('cue-list');
  list.replaceChildren();
  const matches = matchingCues();
  const selectedIndex = matches.findIndex((cue) => cue.id === selectedId);
  if (selectedIndex >= visibleCount) visibleCount = Math.ceil((selectedIndex + 1) / 100) * 100;
  for (const key of ['all', 'issues', 'errors', 'warnings']) {
    $(`filter-${key}`).setAttribute('aria-pressed', String(filter === key));
  }
  $('empty-state').hidden = cues.length > 0;
  $('list-caption').textContent = cues.length
    ? `共 ${cues.length} 条字幕 · 当前显示 ${Math.min(visibleCount, matches.length)} / ${matches.length} 条`
    : '等待导入 · 从左侧打开文件或试用样例';
  const issueMap = new Map();
  for (const issue of result?.issues ?? []) {
    if (!issueMap.has(issue.cueId)) issueMap.set(issue.cueId, []);
    issueMap.get(issue.cueId).push(issue);
  }
  for (const cue of matches.slice(0, visibleCount)) {
    const issues = issueMap.get(cue.id) ?? [];
    const errors = issues.filter((item) => item.severity === 'error').length;
    const button = node('button', `cue-row${cue.id === selectedId ? ' is-selected' : ''}${errors ? ' has-error' : issues.length ? ' has-warning' : ''}`);
    button.type = 'button';
    button.dataset.cueId = cue.id;
    button.setAttribute('aria-pressed', String(cue.id === selectedId));
    const body = node('span', 'cue-body');
    body.append(node('span', 'cue-time', `${formatTime(cue.startMs)} → ${formatTime(cue.endMs)}`));
    body.append(node('span', 'cue-text', cue.text || '（空字幕）'));
    button.append(node('span', 'cue-index', String(cue.id).padStart(2, '0')), body,
      node('span', 'cue-badge', errors ? `错误 ${errors}` : issues.length ? `提示 ${issues.length}` : '无提示'));
    button.addEventListener('click', () => selectCue(cue.id));
    list.append(button);
  }
  if (cues.length && !matches.length) list.append(node('p', 'list-empty', '这一类没有待检查的字幕。'));
  if (matches.length > visibleCount) {
    const more = node('button', 'load-more', `再显示 ${Math.min(100, matches.length - visibleCount)} 条`);
    more.type = 'button';
    more.addEventListener('click', () => { visibleCount += 100; renderList(); });
    list.append(more);
  }
  const selectedRow = list.querySelector('.is-selected');
  if (selectedRow) {
    const rowBox = selectedRow.getBoundingClientRect();
    const listBox = list.getBoundingClientRect();
    if (rowBox.top < listBox.top || rowBox.bottom > listBox.bottom) {
      list.scrollTop += rowBox.top - listBox.top;
    }
  }
}

function draftMetrics() {
  const text = $('edit-text').value;
  const characters = [...text].filter((value) => !/\s/u.test(value)).length;
  try {
    const duration = (parseTime($('edit-end').value) - parseTime($('edit-start').value)) / 1000;
    $('edit-metrics').textContent = `${characters} 字符 · ${text.split('\n').length} 行 · ${duration.toFixed(3)} 秒 · ${duration > 0 ? (characters / duration).toFixed(1) : '—'} 字符/秒`;
  } catch {
    $('edit-metrics').textContent = `${characters} 字符 · 请按 HH:MM:SS,mmm 填写合法时码`;
  }
  $('preview-text').textContent = text || '（空字幕）';
  $('preview-time').textContent = `${$('edit-start').value} — ${$('edit-end').value}`;
}

function renderEditor() {
  const cue = selectedCue();
  $('editor-empty').hidden = Boolean(cue);
  $('editor-form').hidden = !cue;
  if (!cue) {
    $('preview-text').textContent = '让每一句，都从容上场。';
    $('preview-time').textContent = '00:00:00,000 — 00:00:00,000';
    return;
  }
  $('selected-number').textContent = `字幕 ${String(cue.id).padStart(2, '0')}`;
  $('selected-source').textContent = `原序号 ${cue.sourceNumber} · 源文件第 ${cue.line} 行`;
  $('edit-start').value = formatTime(cue.startMs);
  $('edit-end').value = formatTime(cue.endMs);
  $('edit-text').value = cue.text;
  const issues = $('selected-issues');
  issues.replaceChildren();
  for (const issue of issueList(cue.id)) {
    issues.append(node('li', `issue-item ${issue.severity}`, `${issue.severity === 'error' ? '错误' : '复核'} · ${issue.message}`));
  }
  if (!issues.children.length) issues.append(node('li', 'issue-item clear', '这一条未发现本工具覆盖的问题。'));
  draftMetrics();
}

function render() {
  $('stat-cues').textContent = result?.stats.cues ?? '—';
  $('stat-errors').textContent = result?.stats.errors ?? '—';
  $('stat-warnings').textContent = result?.stats.warnings ?? '—';
  $('stat-duration').textContent = result ? formatTime(result.stats.durationMs).slice(0, 8) : '—';
  $('file-name').textContent = fileName || '尚未打开文件';
  $('file-meta').textContent = result ? `${cues.length} 条字幕 · ${result.stats.affected} 条需处理或复核${unsaved ? ' · 修改未下载' : ''}` : 'UTF-8 SRT · 最大 2 MiB / 5,000 条';
  renderList();
  renderEditor();
  updateExport();
}

function selectCue(id) {
  if (busy || id === selectedId) return;
  if (editDirty && !window.confirm('这条字幕有未应用的修改。放弃修改并切换？')) return;
  selectedId = id;
  editDirty = false;
  showError();
  renderList();
  renderEditor();
  updateExport();
}

function clearDocument(name = '') {
  cues = [];
  result = null;
  fileName = name;
  selectedId = null;
  editDirty = false;
  unsaved = false;
  filter = 'all';
  visibleCount = 100;
  render();
}

async function openFile(file, approved = false) {
  if (busy || (!approved && !mayReplace())) return;
  const token = ++loadToken;
  clearDocument(file.name);
  showError();
  notice();
  setBusy(true);
  try {
    if (file.size > LIMITS.maxBytes) throw new Error('文件超过 2 MiB 上限，请拆分字幕后再试。');
    const buffer = await file.arrayBuffer();
    if (token !== loadToken) return;
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
    catch { throw new Error('无法按 UTF-8 读取。请将文件另存为 UTF-8 SRT 后重新导入。'); }
    const parsed = parseSrt(text);
    if (parsed.errors.length) {
      const details = parsed.errors.slice(0, 6).map((error) => `第 ${error.line} 行：${error.message}`).join('\n');
      throw new Error(`未能完整解析，已阻止导出。请在原文件修正后重新导入。\n${details}${parsed.errors.length > 6 ? `\n另有 ${parsed.errors.length - 6} 项格式问题。` : ''}`);
    }
    cues = parsed.cues;
    result = analyze(cues, rules);
    selectedId = result.issues[0]?.cueId ?? cues[0]?.id ?? null;
    render();
    notice(`已检查 ${cues.length} 条字幕。${result.stats.errors} 项错误，${result.stats.warnings} 项复核提示。`);
  } catch (error) {
    if (token === loadToken) {
      clearDocument(file.name);
      showError(error.message || '文件读取失败，请重新选择。');
    }
  } finally {
    if (token === loadToken) setBusy(false);
  }
}

async function loadExample(name) {
  if (busy || !mayReplace()) return;
  showError();
  setBusy(true);
  try {
    const response = await fetch(`./examples/${name}.srt`);
    if (!response.ok) throw new Error('样例读取失败，请确认已从本地 HTTP 服务打开页面。');
    const buffer = await response.arrayBuffer();
    setBusy(false);
    await openFile(new File([buffer], `${name === 'problem' ? '示例-交付前复核' : '示例-干净字幕'}.srt`, { type: 'text/plain' }), true);
  } catch (error) {
    setBusy(false);
    showError(error.message);
  }
}

$('file-input').addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (file) openFile(file);
  event.target.value = '';
});
$('load-example').addEventListener('click', () => loadExample('problem'));
$('load-clean').addEventListener('click', () => loadExample('clean'));
$('drop-zone').addEventListener('dragover', (event) => { event.preventDefault(); $('drop-zone').classList.add('is-dragover'); });
$('drop-zone').addEventListener('dragleave', () => $('drop-zone').classList.remove('is-dragover'));
$('drop-zone').addEventListener('drop', (event) => {
  event.preventDefault();
  $('drop-zone').classList.remove('is-dragover');
  if (busy) return;
  if (event.dataTransfer.files.length !== 1) { showError('请一次拖入一份 SRT 文件。'); return; }
  openFile(event.dataTransfer.files[0]);
});

for (const name of ['all', 'issues', 'errors', 'warnings']) {
  $(`filter-${name}`).addEventListener('click', () => { filter = name; visibleCount = 100; renderList(); });
}

for (const id of ['edit-start', 'edit-end', 'edit-text']) {
  $(id).addEventListener('input', () => {
    const cue = selectedCue();
    editDirty = Boolean(cue) && ($('edit-start').value !== formatTime(cue.startMs)
      || $('edit-end').value !== formatTime(cue.endMs) || $('edit-text').value !== cue.text);
    draftMetrics();
    updateExport();
  });
}
$('editor-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const cue = selectedCue();
  if (!cue || busy) return;
  try {
    const replacement = { ...cue, startMs: parseTime($('edit-start').value), endMs: parseTime($('edit-end').value), text: $('edit-text').value };
    cues = cues.map((item) => item.id === cue.id ? replacement : item);
    result = analyze(cues, rules);
    editDirty = false;
    unsaved = true;
    if (!matchingCues().some((item) => item.id === cue.id)) filter = 'all';
    showError();
    render();
    notice(`字幕 ${cue.id} 已应用并重新检查。修改仅在当前页面，记得下载 SRT。`);
  } catch (error) { showError(error.message); }
});
$('discard-edit').addEventListener('click', () => { editDirty = false; showError(); renderEditor(); updateExport(); notice('已放弃这条字幕尚未应用的修改。'); });

for (const [id, key] of [['min-duration', 'minDuration'], ['max-duration', 'maxDuration'], ['max-cps', 'maxCps'], ['max-lines', 'maxLines']]) {
  $(id).value = rules[key];
  $(id).addEventListener('input', () => { rulesDirty = true; updateExport(); });
}
$('rules-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (busy) return;
  if (editDirty) { showError('请先应用或放弃字幕编辑，再更新检查规则。'); return; }
  try {
    rules = validateRules({ minDuration: Number($('min-duration').value), maxDuration: Number($('max-duration').value), maxCps: Number($('max-cps').value), maxLines: Number($('max-lines').value) });
    if (cues.length) result = analyze(cues, rules);
    rulesDirty = false;
    showError();
    render();
    notice('规则已应用，当前字幕已按新阈值重新检查。');
  } catch (error) { showError(error.message); updateExport(); }
});

function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = node('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function stem() { return (fileName.replace(/\.srt$/i, '') || 'subtitles').replace(/[\\/:*?"<>|]/g, '_'); }
$('download-srt').addEventListener('click', () => {
  if ($('download-srt').disabled) return;
  try {
    download(serializeSrt(cues), `${stem()}-checked.srt`, 'application/x-subrip;charset=utf-8');
    unsaved = false;
    $('file-meta').textContent = `${cues.length} 条字幕 · ${result.stats.affected} 条需处理或复核`;
    notice('已生成 SRT 下载，按当前顺序重新编号；请在下载目录确认文件。');
  } catch (error) { showError(error.message); }
});
$('download-report').addEventListener('click', () => {
  if ($('download-report').disabled) return;
  download(JSON.stringify(createReport(cues, rules, fileName), null, 2), `${stem()}-report.json`, 'application/json;charset=utf-8');
  notice('已生成当前规则下的 JSON 检查报告。');
});
window.addEventListener('beforeunload', (event) => {
  if (hasPendingWork()) { event.preventDefault(); event.returnValue = ''; }
});
render();
