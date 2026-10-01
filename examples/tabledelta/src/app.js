import { LIMITS, parseCsvBytes, compareTables, serializeReport } from './core.js';

const PAGE_SIZE = 25;
const sides = ['before', 'after'];
const sideNames = { before: '旧版', after: '新版' };
const typeNames = { added: '新增', deleted: '删除', modified: '修改', unchanged: '未变' };
const state = {
  inputs: {
    before: { token: 0, table: null, name: '', pending: false, error: '' },
    after: { token: 0, table: null, name: '', pending: false, error: '' },
  },
  key: '',
  result: null,
  comparisonError: '',
  filter: 'all',
  page: 1,
};
const $ = (id) => document.getElementById(id);

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function announce(message) {
  $('activity').textContent = message;
}

function invalidateResult() {
  state.result = null;
  state.comparisonError = '';
  state.filter = 'all';
  state.page = 1;
  $('result-filter').value = 'all';
  $('download').disabled = true;
  $('report').hidden = true;
  $('empty-state').hidden = false;
  $('records').replaceChildren();
  $('result-description').textContent = '变化有据，核对有序。';
  $('empty-message').textContent = '放入两个版本并选择唯一键，变化会在这里展开。';
}

function schemaError() {
  const before = state.inputs.before.table;
  const after = state.inputs.after.table;
  if (!before || !after) return '';
  const context = `旧版文件“${before.name}”与新版文件“${after.name}”的表头（逻辑记录 1）`;
  if (before.columns.length !== after.columns.length) {
    return `${context}列数不同：旧版 ${before.columns.length} 列，新版 ${after.columns.length} 列。请使用列名及顺序完全相同的文件。`;
  }
  const index = before.columns.findIndex((column, i) => column !== after.columns[i]);
  return index < 0 ? '' : `${context}第 ${index + 1} 列不同：旧版“${before.columns[index]}”，新版“${after.columns[index]}”。请使用列名及顺序完全相同的文件。`;
}

function renderErrors() {
  const messages = sides.map((side) => state.inputs[side].error).filter(Boolean);
  const mismatch = schemaError();
  if (mismatch) messages.push(mismatch);
  if (state.comparisonError) messages.push(state.comparisonError);
  $('input-errors').replaceChildren(...messages.map((message) => element('p', '', message)));
  $('input-errors').hidden = messages.length === 0;
}

function renderInput(side) {
  const input = state.inputs[side];
  const zone = $(`${side}-zone`);
  zone.dataset.state = input.pending ? 'loading' : input.error ? 'error' : input.table ? 'ready' : 'empty';
  zone.setAttribute('aria-busy', String(input.pending));
  $(`${side}-name`).textContent = input.name || `选择${sideNames[side]} CSV`;
  $(`${side}-detail`).textContent = input.pending ? '正在读取并检查 CSV…' : input.error ? '未通过校验，请重新选择文件' : input.table ? `${input.table.rows.length.toLocaleString('zh-CN')} 条数据记录 · ${input.table.columns.length} 列` : '点击选择，或将文件拖到这里';
  $(`${side}-status`).textContent = input.pending ? '读取中' : input.error ? '需要修正' : input.table ? '✓ 已读取' : '等待文件';
}

function syncControls() {
  const before = state.inputs.before.table;
  const after = state.inputs.after.table;
  const ready = Boolean(before && after && !schemaError() && !sides.some((side) => state.inputs[side].pending));
  const select = $('key-column');
  select.replaceChildren(element('option', '', ready ? '请选择唯一键列' : '请先放入两份有效 CSV'));
  select.firstElementChild.value = '';
  if (ready) {
    before.columns.forEach((column) => {
      const option = element('option', '', column);
      option.value = column;
      select.append(option);
    });
  }
  select.disabled = !ready;
  select.value = ready ? state.key : '';
  $('compare').disabled = !ready || !state.key;
  if (ready && !state.key) $('empty-message').textContent = '两份文件已就位。请选择唯一键，再开始核对。';
  renderErrors();
}

async function loadSource(side, source) {
  const input = state.inputs[side];
  const token = ++input.token;
  input.table = null;
  input.error = '';
  input.name = source.name;
  input.pending = true;
  state.key = '';
  invalidateResult();
  renderInput(side);
  syncControls();
  try {
    if (source.size !== undefined && source.size > LIMITS.bytes) {
      throw new Error(`${sideNames[side]}文件“${source.name}”超过 2 MiB（${LIMITS.bytes.toLocaleString('zh-CN')} 字节）上限，请缩小文件后重试。`);
    }
    const bytes = await source.read();
    if (token !== input.token) return;
    input.table = parseCsvBytes(bytes, { name: source.name, side: `${sideNames[side]}文件` });
    announce(`${sideNames[side]}文件已读取，共 ${input.table.rows.length} 条数据记录。`);
  } catch (error) {
    if (token !== input.token) return;
    input.error = error instanceof Error ? error.message : `${sideNames[side]}文件无法读取，请重新选择。`;
    announce(`${sideNames[side]}文件未通过校验。`);
  } finally {
    if (token === input.token) {
      input.pending = false;
      renderInput(side);
      syncControls();
    }
  }
}

function loadFile(side, file) {
  return loadSource(side, { name: file.name, size: file.size, read: () => file.arrayBuffer() });
}

function rejectDrop(side) {
  return loadSource(side, {
    name: '',
    read: () => { throw new Error(`${sideNames[side]}一次只能放入一个 CSV 文件，请重新选择。`); },
  });
}

function renderValue(value) {
  if (value === '') return element('span', 'empty-value', '（空字符串）');
  return element('code', 'value', value);
}

function valueTable(headers, rows, modified = false) {
  const table = element('table', 'value-table');
  const thead = element('thead');
  const heading = element('tr');
  headers.forEach((header) => {
    const th = element('th', '', header);
    th.scope = 'col';
    heading.append(th);
  });
  thead.append(heading);
  const tbody = element('tbody');
  rows.forEach((values) => {
    const row = element('tr');
    const label = element('th', '', values[0]);
    label.scope = 'row';
    row.append(label);
    values.slice(1).forEach((value, index) => {
      const cell = element('td', modified ? index === 0 ? 'value-old' : 'value-new' : '');
      cell.append(renderValue(value));
      row.append(cell);
    });
    tbody.append(row);
  });
  table.append(thead, tbody);
  return table;
}

function renderRecord({ type, record }) {
  const article = element('article', 'record');
  const header = element('div', 'record-header');
  const key = element('h3', 'record-key');
  key.append(element('small', '', state.result.key), element('code', 'value', record.key));
  header.append(element('span', `type-label type-${type}`, typeNames[type]), key);
  if (type === 'modified') header.append(element('span', 'record-meta', `${record.changes.length} 个字段有变化`));
  article.append(header);
  if (type === 'modified') {
    article.append(valueTable(['变化字段', '旧版值', '新版值'], record.changes.map((change) => [change.column, change.before, change.after]), true));
    const detail = element('details', 'record-details');
    detail.append(element('summary', '', `查看完整记录（${state.result.columns.length} 个字段）`));
    detail.append(valueTable(['全部字段', '旧版值', '新版值'], state.result.columns.map((column, index) => [column, record.before[index], record.after[index]])));
    article.append(detail);
  } else {
    const detail = element('details', 'record-details');
    detail.append(element('summary', '', `查看完整记录（${state.result.columns.length} 个字段）`));
    detail.append(valueTable(['字段', type === 'deleted' ? '旧版值' : type === 'added' ? '新版值' : '字段值'], state.result.columns.map((column, index) => [column, record.values[index]])));
    article.append(detail);
  }
  return article;
}

function filteredRecords() {
  const types = state.filter === 'all' ? Object.keys(typeNames) : [state.filter];
  return types.flatMap((type) => state.result[type].map((record) => ({ type, record })));
}

function renderRecords() {
  if (!state.result) return;
  const records = filteredRecords();
  const totalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  state.page = Math.min(state.page, totalPages);
  const start = (state.page - 1) * PAGE_SIZE;
  const visible = records.slice(start, start + PAGE_SIZE);
  $('records').replaceChildren(...visible.map(renderRecord));
  if (!visible.length) $('records').append(element('p', 'no-records', state.filter === 'all' ? '没有数据记录。两份文件的表头已通过核对。' : `没有${typeNames[state.filter]}记录。`));
  $('visible-count').textContent = records.length ? `${start + 1}–${start + visible.length} / ${records.length.toLocaleString('zh-CN')} 条` : '共 0 条';
  $('page-label').textContent = `第 ${state.page} / ${totalPages} 页`;
  $('previous-page').disabled = state.page <= 1;
  $('next-page').disabled = state.page >= totalPages;
  $('result-filter').value = state.filter;
  document.querySelectorAll('.stat').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.filter === state.filter)));
}

function showResult(result) {
  state.result = result;
  $('empty-state').hidden = true;
  $('report').hidden = false;
  $('download').disabled = false;
  Object.keys(typeNames).forEach((type) => { $(`count-${type}`).textContent = result.counts[type].toLocaleString('zh-CN'); });
  const summary = `旧版 ${result.inputs.before.rows.toLocaleString('zh-CN')} 条 → 新版 ${result.inputs.after.rows.toLocaleString('zh-CN')} 条 · 唯一键：${result.key}`;
  $('result-description').textContent = summary;
  renderRecords();
  announce(`核对完成。新增 ${result.counts.added}，删除 ${result.counts.deleted}，修改 ${result.counts.modified}，未变 ${result.counts.unchanged}。`);
  $('result-heading').focus({ preventScroll: true });
  $('results').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
}

for (const side of sides) {
  const input = $(`${side}-file`);
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) void loadFile(side, file);
    input.value = '';
  });
  const zone = $(`${side}-zone`);
  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', (event) => {
    if (!zone.contains(event.relatedTarget)) zone.classList.remove('drag-over');
  });
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('drag-over');
    const files = event.dataTransfer?.files;
    if (files?.length === 1) void loadFile(side, files[0]);
    else void rejectDrop(side);
  });
}

$('load-example').addEventListener('click', () => {
  for (const side of sides) {
    void loadSource(side, {
      name: `${side}.csv`,
      read: async () => {
        const response = await fetch(`examples/${side}.csv`);
        if (!response.ok) throw new Error(`${sideNames[side]}示例读取失败（HTTP ${response.status}），请检查本地服务或手动选择 CSV。`);
        return response.arrayBuffer();
      },
    });
  }
});

$('key-column').addEventListener('change', (event) => {
  state.key = event.target.value;
  invalidateResult();
  syncControls();
  if (state.key) $('empty-message').textContent = '唯一键已选定。点击“开始核对”，查看这个版本的变化。';
  announce('唯一键已变更，请重新开始核对。');
});

$('compare').addEventListener('click', () => {
  invalidateResult();
  try {
    const result = compareTables(state.inputs.before.table, state.inputs.after.table, state.key);
    showResult(result);
  } catch (error) {
    state.comparisonError = error instanceof Error ? error.message : '核对失败，请检查输入文件和唯一键。';
    announce('核对未完成，请查看错误说明。');
  }
  renderErrors();
});

function changeFilter(filter) {
  if (!state.result) return;
  state.filter = filter;
  state.page = 1;
  renderRecords();
}

$('result-filter').addEventListener('change', (event) => changeFilter(event.target.value));
document.querySelectorAll('.stat').forEach((button) => button.addEventListener('click', () => changeFilter(button.dataset.filter)));

function changePage(delta) {
  if (!state.result) return;
  state.page += delta;
  renderRecords();
  $('records').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
}
$('previous-page').addEventListener('click', () => changePage(-1));
$('next-page').addEventListener('click', () => changePage(1));

$('download').addEventListener('click', () => {
  if (!state.result) return;
  try {
    const blob = new Blob([serializeReport(state.result)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = element('a');
    link.href = url;
    link.download = 'tabledelta-report.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce('已下载完整 JSON 报告，包含全部变化；未变记录仅保留计数。');
  } catch (error) {
    invalidateResult();
    state.comparisonError = error instanceof Error ? error.message : '报告下载失败，请重新核对后重试。';
    renderErrors();
  }
});

syncControls();
