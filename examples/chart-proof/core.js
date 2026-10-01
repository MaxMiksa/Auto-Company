(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ChartProof = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const KINDS = ['observed', 'approximate', 'interpolated', 'missing', 'unconfirmed'];
  const LABELS = { observed: '观测值', approximate: '近似值', interpolated: '插值', missing: '缺测', unconfirmed: '未确认' };
  const MAX_POINTS = 5000;
  const MAX_TEXT = 10000;
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const clone = value => JSON.parse(JSON.stringify(value));
  const emptyReview = () => ({ name: '', date: '', note: '' });
  const fail = message => { throw new Error(message); };
  const text = (value, label, limit = MAX_TEXT) => {
    if (typeof value !== 'string' || value.length > limit) fail(`${label}必须是长度不超过 ${limit} 的文本。`);
    return value;
  };
  const object = (value, label) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}格式不正确。`);
  };
  const keys = (value, allowed, label) => {
    Object.keys(value).forEach(key => { if (!allowed.includes(key)) fail(`${label}包含未知字段：${key}。`); });
  };
  const number = (value, label) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label}必须是有限数值。`);
    return value;
  };
  const parseNumber = (value, label) => {
    const input = value.trim();
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(input)) fail(`${label}不是有效数值：${value}。`);
    return number(Number(input), label);
  };
  const isoDate = (value, label) => {
    text(value, label, 100);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) fail(`${label}必须是 UTC ISO 时间。`);
    const canonical = value.includes('.') ? value.replace(/\.(\d{1,3})Z$/, (_, digits) => '.' + digits.padEnd(3, '0') + 'Z') : value.replace('Z', '.000Z');
    if (new Date(value).toISOString() !== canonical) fail(`${label}不是有效日期。`);
    return value;
  };

  function normalizePoint(input, position) {
    object(input, `第 ${position + 1} 个点`);
    keys(input, ['id', 'series', 'x', 'y', 'kind', 'evidence', 'note', 'review'], '数据点');
    const point = {
      id: text(input.id, '数据点标识', 100),
      series: text(input.series, '系列名称', 200).trim(),
      x: number(input.x, '横轴值'),
      y: input.y === null ? null : number(input.y, '纵轴值'),
      kind: input.kind,
      evidence: text(input.evidence, '数值出处'),
      note: text(input.note, '数据备注'),
      review: emptyReview()
    };
    if (!point.id.trim()) fail('数据点标识不能为空。');
    if (!point.series) fail('系列名称不能为空。');
    if (!KINDS.includes(point.kind)) fail(`未知数据类型：${point.kind}。`);
    if (point.kind === 'missing' && point.y !== null) fail('缺测点不能包含数值。');
    if (point.kind !== 'missing' && point.y === null) fail('空值必须标记为缺测。');
    object(input.review, '复核记录');
    keys(input.review, ['name', 'date', 'note'], '复核记录');
    point.review.name = text(input.review.name, '复核人', 200).trim();
    point.review.date = text(input.review.date, '复核时间', 100);
    point.review.note = text(input.review.note, '复核备注');
    if (point.review.name || point.review.date) {
      if (!point.review.name || !point.review.date || !point.evidence.trim()) fail('已复核点必须保留复核人、时间和出处。');
      isoDate(point.review.date, '复核时间');
    } else if (point.review.note) fail('未署名复核不能包含复核备注。');
    return point;
  }

  function normalizeMeta(input = {}) {
    object(input, '项目说明');
    keys(input, ['title', 'source', 'xLabel', 'yLabel', 'xScale', 'yScale', 'description'], '项目说明');
    const defaults = { title: '未命名图表资料', source: '', xLabel: '横轴', yLabel: '纵轴', xScale: 'linear', yScale: 'linear', description: '' };
    const meta = {};
    Object.keys(defaults).forEach(key => { meta[key] = own(input, key) ? text(input[key], `项目 ${key}`) : defaults[key]; });
    if (!meta.title.trim()) fail('资料标题不能为空。');
    if (!['linear', 'log'].includes(meta.xScale) || !['linear', 'log'].includes(meta.yScale)) fail('轴尺度仅支持 linear（线性）或 log（对数）。');
    return meta;
  }

  function validateProject(input) {
    object(input, '项目');
    keys(input, ['version', 'meta', 'points', 'history'], '项目');
    if (input.version !== 1) fail('不支持此项目版本，请使用版本 1。');
    object(input.meta, '项目说明');
    if (!['title', 'source', 'xLabel', 'yLabel', 'xScale', 'yScale', 'description'].every(key => own(input.meta, key))) fail('项目说明缺少必需字段。');
    if (!Array.isArray(input.points) || !input.points.length || input.points.length > MAX_POINTS) fail(`项目需包含 1 至 ${MAX_POINTS} 个数据点。`);
    const meta = normalizeMeta(input.meta);
    const points = input.points.map(normalizePoint);
    const ids = new Set();
    const coordinates = new Set();
    points.forEach(point => {
      if (ids.has(point.id)) fail(`数据点标识重复：${point.id}。`);
      ids.add(point.id);
      const coordinate = JSON.stringify([point.series, point.x]);
      if (coordinates.has(coordinate)) fail(`系列「${point.series}」的横轴值 ${point.x} 重复。`);
      coordinates.add(coordinate);
      if (meta.xScale === 'log' && point.x <= 0) fail('对数横轴的数据必须大于 0。');
      if (meta.yScale === 'log' && point.y !== null && point.y <= 0) fail('对数纵轴的非缺测数据必须大于 0。');
    });
    if (!Array.isArray(input.history) || input.history.length > 20000) fail('变更记录必须是最多 20000 条的数组。');
    const historyIds = new Set();
    const history = input.history.map((entry, index) => {
      object(entry, '变更记录');
      keys(entry, ['id', 'date', 'action', 'pointId', 'actor', 'before', 'after', 'revokedReviews'], '变更记录');
      const id = text(entry.id, '变更标识', 100);
      if (!id.trim() || historyIds.has(id)) fail('变更标识为空或重复。');
      historyIds.add(id);
      if (!['update', 'review', 'meta'].includes(entry.action)) fail('未知变更操作。');
      const pointId = text(entry.pointId, '变更数据点', 100);
      const date = isoDate(entry.date, '变更时间');
      const actor = text(entry.actor, '操作人', 200);
      if (!actor.trim()) fail('变更操作人不能为空。');
      if (entry.action === 'meta') {
        if (pointId !== '') fail('资料说明变更不能指定单个数据点。');
        const before = normalizeMeta(entry.before);
        const after = normalizeMeta(entry.after);
        if (!Array.isArray(entry.revokedReviews) || entry.revokedReviews.length > MAX_POINTS) fail('资料说明变更必须记录撤销的复核。');
        const revokedReviews = entry.revokedReviews.map(revoked => {
          object(revoked, '撤销复核');
          keys(revoked, ['pointId', 'review'], '撤销复核');
          if (!ids.has(revoked.pointId)) fail('撤销复核引用了不存在的数据点。');
          const reference = points.find(point => point.id === revoked.pointId);
          const review = normalizePoint({ ...reference, evidence: reference.evidence || '历史复核出处详见旧记录', review: revoked.review }, index).review;
          if (!review.name) fail('撤销复核记录必须包含原复核人。');
          return { pointId: revoked.pointId, review };
        });
        return { id, date, action: 'meta', pointId, actor, before, after, revokedReviews };
      }
      if (own(entry, 'revokedReviews')) fail('逐点变更不能包含资料说明复核撤销字段。');
      if (!ids.has(pointId)) fail('变更记录引用了不存在的数据点。');
      const before = normalizePoint(entry.before, index);
      const after = normalizePoint(entry.after, index);
      if (before.id !== pointId || after.id !== pointId) fail('变更记录的数据点标识不一致。');
      if (entry.action === 'review') {
        if (after.review.name !== actor || after.review.date !== date) fail('复核签署与变更操作人、时间不一致。');
        const oldData = { ...before, review: emptyReview() };
        const newData = { ...after, review: emptyReview() };
        if (JSON.stringify(oldData) !== JSON.stringify(newData)) fail('复核操作不能同时改动数据。');
      } else if (after.review.name) fail('修改数据后必须撤销旧复核。');
      return { id, date, action: entry.action, pointId, actor, before, after };
    });
    return { version: 1, meta, points, history };
  }

  function createProject(points, meta = {}) {
    if (!Array.isArray(points)) fail('数据点必须是数组。');
    return validateProject({ version: 1, meta: normalizeMeta(meta), points: points.map((point, index) => ({ ...point, id: point.id || `p${index + 1}`, evidence: point.evidence || '', note: point.note || '', review: point.review || emptyReview() })), history: [] });
  }

  function importProject(input) {
    if (typeof input !== 'string' || input.length > 30000000) fail('项目文件必须是大小不超过 30 MB 的 JSON 文本。');
    let parsed;
    try { parsed = JSON.parse(input); } catch (_) { fail('项目文件不是有效 JSON，请重新选择保存的项目文件。'); }
    return validateProject(parsed);
  }

  function csvRows(input) {
    if (typeof input !== 'string' || input.length > 5000000) fail('CSV 必须是大小不超过 5 MB 的文本。');
    input = input.replace(/^\uFEFF/, '');
    const rows = [];
    let row = [], field = '', quoted = false, closed = false;
    const finish = () => { row.push(field); field = ''; closed = false; };
    for (let i = 0; i < input.length; i++) {
      const char = input[i];
      if (quoted) {
        if (char === '"' && input[i + 1] === '"') { field += '"'; i++; }
        else if (char === '"') { quoted = false; closed = true; }
        else field += char;
      } else if (char === '"') {
        if (field || closed) fail('CSV 引号位置不正确。');
        quoted = true;
      } else if (char === ',') { finish(); }
      else if (char === '\n' || char === '\r') {
        if (char === '\r' && input[i + 1] === '\n') i++;
        finish(); rows.push(row); row = [];
      } else {
        if (closed) fail('CSV 引号关闭后只能出现分隔符或换行。');
        field += char;
      }
    }
    if (quoted) fail('CSV 存在未关闭的引号。');
    if (field || row.length || closed) { finish(); rows.push(row); }
    return rows.filter(values => values.some(value => value.trim()));
  }

  const ALIASES = {
    series: 'series', '系列': 'series', '系列名称': 'series',
    x: 'x', '横轴': 'x', '横轴值': 'x',
    y: 'y', '纵轴': 'y', '纵轴值': 'y',
    kind: 'kind', '类型': 'kind', '数据类型': 'kind',
    evidence: 'evidence', '出处': 'evidence', '证据': 'evidence', '数值出处': 'evidence',
    note: 'note', '备注': 'note',
    review_name: 'review_name', '复核人': 'review_name',
    review_date: 'review_date', '复核时间': 'review_date',
    review_note: 'review_note', '复核备注': 'review_note'
  };
  const KIND_ALIASES = { '观测值': 'observed', '观测': 'observed', '实测': 'observed', '近似值': 'approximate', '近似': 'approximate', '插值': 'interpolated', '缺测': 'missing', '未确认': 'unconfirmed' };
  const unsafeText = value => /^[\s]*[=+\-@\t\r\n]/.test(value);
  const restoreCSVText = value => value.startsWith("'") && unsafeText(value.slice(1)) ? value.slice(1) : value;

  function parseCSV(input) {
    const rows = csvRows(input);
    if (rows.length < 2) fail('CSV 需要表头和至少一行数据。');
    const headers = rows[0].map(value => {
      const name = value.trim().toLowerCase();
      return own(ALIASES, name) ? ALIASES[name] : undefined;
    });
    if (headers.some(value => !value)) fail('CSV 含未知列名；请使用系列、横轴、纵轴、类型、出处、备注。');
    if (new Set(headers).size !== headers.length) fail('CSV 列名重复。');
    if (!['series', 'x', 'y'].every(key => headers.includes(key))) fail('CSV 缺少必需列：series、x、y（或系列、横轴、纵轴）。');
    if (rows.length - 1 > MAX_POINTS) fail(`CSV 最多支持 ${MAX_POINTS} 个数据点。`);
    const points = rows.slice(1).map((row, index) => {
      if (row.length !== headers.length) fail(`CSV 第 ${index + 2} 行列数与表头不同。`);
      const values = Object.fromEntries(headers.map((key, column) => [key, row[column]]));
      const rawY = values.y.trim();
      const y = !rawY || rawY.toLowerCase() === 'null' ? null : parseNumber(rawY, `第 ${index + 2} 行纵轴值`);
      const rawKind = (values.kind || '').trim().toLowerCase();
      const kind = (own(KIND_ALIASES, rawKind) ? KIND_ALIASES[rawKind] : rawKind) || (y === null ? 'missing' : 'unconfirmed');
      return {
        id: `p${index + 1}`, series: restoreCSVText(values.series).trim(), x: parseNumber(values.x, `第 ${index + 2} 行横轴值`), y, kind,
        evidence: restoreCSVText(values.evidence || ''), note: restoreCSVText(values.note || ''),
        review: { name: restoreCSVText(values.review_name || ''), date: values.review_date || '', note: restoreCSVText(values.review_note || '') }
      };
    });
    return createProject(points).points;
  }

  function addHistory(project, action, before, after, actor) {
    const entry = { id: `h${project.history.length + 1}-${Date.now()}`, date: new Date().toISOString(), action, pointId: before.id, actor, before: clone(before), after: clone(after) };
    project.history.push(entry);
    return validateProject(project);
  }

  function updatePoint(input, id, patch, reviewer = '') {
    const project = validateProject(input);
    object(patch, '修改内容');
    keys(patch, ['series', 'x', 'y', 'kind', 'evidence', 'note'], '修改内容');
    text(reviewer, '操作人', 200);
    const index = project.points.findIndex(point => point.id === id);
    if (index < 0) fail('未找到要修改的数据点。');
    const before = clone(project.points[index]);
    const after = { ...before, ...patch, review: clone(before.review) };
    if (own(patch, 'kind') && patch.kind === 'missing' && !own(patch, 'y')) after.y = null;
    if (own(patch, 'y') && patch.y === null && !own(patch, 'kind')) after.kind = 'missing';
    const changed = Object.keys(patch).some(key => JSON.stringify(after[key]) !== JSON.stringify(before[key]));
    if (!changed) return project;
    if (['series', 'x', 'y', 'kind', 'evidence', 'note'].some(key => JSON.stringify(after[key]) !== JSON.stringify(before[key]))) after.review = emptyReview();
    project.points[index] = normalizePoint(after, index);
    return addHistory(project, 'update', before, project.points[index], reviewer.trim() || '未署名编辑');
  }

  function reviewPoint(input, id, reviewer, note = '') {
    const project = validateProject(input);
    const name = text(reviewer, '复核人', 200).trim();
    if (!name) fail('请填写复核人，由使用者明确签署复核。');
    text(note, '复核备注');
    const index = project.points.findIndex(point => point.id === id);
    if (index < 0) fail('未找到要复核的数据点。');
    const before = clone(project.points[index]);
    if (!before.evidence.trim()) fail('请先记录数值或缺测出处，再签署复核。');
    const date = new Date().toISOString();
    project.points[index].review = { name, date, note };
    project.history.push({ id: `h${project.history.length + 1}-${Date.now()}`, date, action: 'review', pointId: id, actor: name, before, after: clone(project.points[index]) });
    return validateProject(project);
  }

  function updateMeta(input, patch, actor = '资料制作者') {
    const project = validateProject(input);
    object(patch, '资料说明修改');
    keys(patch, ['title', 'source', 'xLabel', 'yLabel', 'xScale', 'yScale', 'description'], '资料说明修改');
    const name = text(actor, '操作人', 200).trim();
    if (!name) fail('操作人不能为空。');
    const before = clone(project.meta);
    const after = normalizeMeta({ ...before, ...patch });
    if (JSON.stringify(before) === JSON.stringify(after)) return project;
    const revokedReviews = project.points.filter(point => point.review.name).map(point => ({ pointId: point.id, review: clone(point.review) }));
    project.points.forEach(point => { point.review = emptyReview(); });
    project.meta = after;
    project.history.push({ id: `h${project.history.length + 1}-${Date.now()}`, date: new Date().toISOString(), action: 'meta', pointId: '', actor: name, before, after: clone(after), revokedReviews });
    return validateProject(project);
  }

  function getSummary(input) {
    const project = validateProject(input);
    const counts = Object.fromEntries(KINDS.map(kind => [kind, 0]));
    const groups = new Map();
    let reviewed = 0;
    project.points.forEach(point => {
      counts[point.kind]++;
      if (point.review.name) reviewed++;
      if (!groups.has(point.series)) groups.set(point.series, []);
      groups.get(point.series).push(point);
    });
    const series = Array.from(groups, ([name, points]) => {
      points.sort((a, b) => a.x - b.x);
      const segments = [];
      let current = [];
      const finish = () => {
        if (current.length) {
          const delta = current[current.length - 1].y - current[0].y;
          segments.push({ start: current[0].x, end: current[current.length - 1].x, count: current.length, delta: Number.isFinite(delta) ? delta : null, points: clone(current) });
        }
        current = [];
      };
      points.forEach(point => { if (point.kind === 'missing') finish(); else current.push(point); });
      finish();
      return { name, total: points.length, missing: points.filter(point => point.kind === 'missing').length, segments };
    });
    return { total: project.points.length, counts, reviewed, unreviewed: project.points.length - reviewed, series };
  }

  function exportCSV(input) {
    const project = validateProject(input);
    const cell = (value, numeric = false) => {
      let output = value === null ? '' : String(value);
      if (!numeric && unsafeText(output)) output = "'" + output;
      return '"' + output.replace(/"/g, '""') + '"';
    };
    const lines = ['series,x,y,kind,evidence,note,review_name,review_date,review_note'];
    project.points.forEach(point => lines.push([cell(point.series), cell(point.x, true), cell(point.y, true), cell(point.kind), cell(point.evidence), cell(point.note), cell(point.review.name), cell(point.review.date), cell(point.review.note)].join(',')));
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }

  const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const valueLabel = point => point.kind === 'missing' ? '缺测（没有数值）' : `${point.y}${point.kind === 'approximate' ? '（近似）' : point.kind === 'interpolated' ? '（插值）' : point.kind === 'unconfirmed' ? '（未确认）' : ''}`;
  const boundary = '本资料保留使用者输入的数据、出处和人工复核记录，不自动提取图片数值，不验证原始来源真实性，也不构成读屏适用性或真实用户验证。近似值、插值与未确认值均保持标注。缺测不按零值处理，不跨缺测推断趋势；未列出的横轴位置不自动判定为缺测。人工署名是本地记录，可编辑项目文件，并非数字签名或独立认证。';
  const scaleLabel = scale => scale === 'log' ? '对数' : '线性';
  const reviewLabel = review => review.name ? `复核人：${review.name}；时间：${review.date}；复核备注：${review.note || '无'}` : '未复核';
  const historyState = (entry, state) => {
    const value = entry[state];
    if (entry.action === 'meta') return `标题：${value.title}；来源：${value.source || '未记录'}；横轴：${value.xLabel}（${scaleLabel(value.xScale)}）；纵轴：${value.yLabel}（${scaleLabel(value.yScale)}）；说明：${value.description || '无'}`;
    return `系列：${value.series}；横轴值：${value.x}；纵轴值：${valueLabel(value)}；类型：${LABELS[value.kind]}；出处：${value.evidence || '未记录'}；备注：${value.note || '无'}；${reviewLabel(value.review)}`;
  };
  const revokedLabel = entry => entry.revokedReviews.length ? entry.revokedReviews.map(item => `数据点 ${item.pointId}：${reviewLabel(item.review)}`).join('；') : '当时没有已签署的复核';

  function exportHTML(input) {
    const project = validateProject(input);
    const summary = getSummary(project);
    const e = escapeHTML;
    const row = point => `<tr><th scope="row">${e(point.series)}</th><td>${e(point.x)}</td><td>${e(valueLabel(point))}</td><td>${e(LABELS[point.kind])}</td><td>${e(point.evidence || '未记录')}</td><td>${e(point.note || '无')}</td><td>${point.review.name ? `${e(point.review.name)}；${e(point.review.date)}；${e(point.review.note || '无备注')}` : '未复核'}</td></tr>`;
    const changes = project.history.map(entry => `<li>时间：${e(entry.date)}；操作人：${e(entry.actor)}；操作：${entry.action === 'meta' ? '修改资料说明并撤销复核' : entry.action === 'review' ? '签署复核' : '修改数据'}${entry.pointId ? `；数据点：${e(entry.pointId)}` : ''}<dl><dt>修改前</dt><dd>${e(historyState(entry, 'before'))}</dd><dt>修改后</dt><dd>${e(historyState(entry, 'after'))}</dd>${entry.action === 'meta' ? `<dt>被撤销的原复核</dt><dd>${e(revokedLabel(entry))}</dd>` : ''}</dl></li>`).join('');
    const segments = summary.series.map(series => `<li>${e(series.name)}：${series.total} 个点，${series.missing} 个缺测。${series.segments.map(segment => `连续非缺测段 ${e(segment.start)} 至 ${e(segment.end)}：${segment.count} 个点，段内首尾差 ${segment.delta === null ? '超出可计算范围（未计算）' : e(segment.delta)}。`).join(' ')} 不跨缺测计算首尾差；差值只是输入数值的算术结果，不代表已核实的趋势。</li>`).join('');
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(project.meta.title)}</title><style>body{font:17px/1.6 system-ui,sans-serif;color:#182c38;max-width:1100px;margin:40px auto;padding:0 20px;overflow-wrap:anywhere}.table-scroll{max-width:100%;overflow-x:auto}table{width:100%;border-collapse:collapse}th,td{border:1px solid #a6b9c2;padding:10px;text-align:left;vertical-align:top;overflow-wrap:anywhere}caption{text-align:left;font-weight:bold;margin:12px 0}dl{font-size:14px}dd{overflow-wrap:anywhere;margin:0 0 10px}a{color:#164e63}h1,h2{line-height:1.3}@media print{body{margin:0;font-size:12px}tr{break-inside:avoid}}</style></head><body><main><h1>${e(project.meta.title)}</h1><p>${e(project.meta.description || '图表非视觉资料')}</p><h2>来源与轴说明</h2><p>原始来源：${e(project.meta.source || '未记录')}</p><p>横轴：${e(project.meta.xLabel)}（${scaleLabel(project.meta.xScale)}）；纵轴：${e(project.meta.yLabel)}（${scaleLabel(project.meta.yScale)}）。轴尺度由使用者声明；本资料没有校准或换算图片轴。</p><h2>资料概况</h2><p>共 ${summary.total} 个点；${KINDS.map(kind => `${LABELS[kind]} ${summary.counts[kind]}`).join('，')}。人工已复核 ${summary.reviewed} 个，未复核 ${summary.unreviewed} 个。</p><ul>${segments}</ul><h2>逐点数据与复核</h2><div class="table-scroll" role="region" aria-label="逐点数据表，可横向滚动" tabindex="0"><table><caption>${e(project.meta.title)}数据表：缺测明确列出，近似与插值分别标记</caption><thead><tr><th scope="col">系列</th><th scope="col">${e(project.meta.xLabel)}</th><th scope="col">${e(project.meta.yLabel)}</th><th scope="col">类型</th><th scope="col">出处</th><th scope="col">备注</th><th scope="col">人工复核</th></tr></thead><tbody>${project.points.map(row).join('')}</tbody></table></div><h2>变更记录</h2>${changes ? `<ol>${changes}</ol>` : '<p>尚无修改或复核操作记录。</p>'}<h2>使用边界</h2><p>${e(boundary)}</p></main></body></html>`;
  }

  function exportMarkdown(input) {
    const project = validateProject(input);
    const summary = getSummary(project);
    const m = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\\/g, '\\\\').replace(/[|`*_[\]#]/g, char => '\\' + char).replace(/\r?\n/g, '<br>');
    const lines = [`# ${m(project.meta.title)}`, '', m(project.meta.description), '', '## 来源与轴说明', '', `原始来源：${m(project.meta.source || '未记录')}`, '', `横轴：${m(project.meta.xLabel)}（${scaleLabel(project.meta.xScale)}）；纵轴：${m(project.meta.yLabel)}（${scaleLabel(project.meta.yScale)}）。轴尺度为使用者声明。`, '', '## 资料概况', '', `共 ${summary.total} 个点；${KINDS.map(kind => `${LABELS[kind]} ${summary.counts[kind]}`).join('，')}；已复核 ${summary.reviewed} 个，未复核 ${summary.unreviewed} 个。`, ''];
    summary.series.forEach(series => lines.push(`- ${m(series.name)}：${series.total} 个点，${series.missing} 个缺测；${series.segments.map(segment => `连续非缺测段 ${segment.start} 至 ${segment.end}，${segment.count} 个点，首尾差 ${segment.delta === null ? '超出可计算范围（未计算）' : segment.delta}`).join('；')}。差值只是输入数值的算术结果，不跨缺测推断趋势。`));
    lines.push('', '## 逐点数据与复核', '', `| 系列 | ${m(project.meta.xLabel)} | ${m(project.meta.yLabel)} | 类型 | 出处 | 备注 | 人工复核 |`, '| --- | --- | --- | --- | --- | --- | --- |');
    project.points.forEach(point => lines.push(`| ${m(point.series)} | ${point.x} | ${m(valueLabel(point))} | ${LABELS[point.kind]} | ${m(point.evidence || '未记录')} | ${m(point.note || '无')} | ${point.review.name ? m(`${point.review.name}；${point.review.date}；${point.review.note || '无备注'}`) : '未复核'} |`));
    lines.push('', '## 变更记录', '');
    if (!project.history.length) lines.push('尚无修改或复核操作记录。');
    project.history.forEach(entry => {
      lines.push(`- 时间：${m(entry.date)}；操作人：${m(entry.actor)}；操作：${entry.action === 'meta' ? '修改资料说明并撤销复核' : entry.action === 'review' ? '签署复核' : '修改数据'}${entry.pointId ? `；数据点：${m(entry.pointId)}` : ''}`, `  - 修改前：${m(historyState(entry, 'before'))}`, `  - 修改后：${m(historyState(entry, 'after'))}`);
      if (entry.action === 'meta') lines.push(`  - 被撤销的原复核：${m(revokedLabel(entry))}`);
    });
    lines.push('', '## 使用边界', '', boundary, '');
    return lines.join('\n');
  }

  return { KINDS: Object.freeze(KINDS.slice()), LABELS: Object.freeze({ ...LABELS }), MAX_POINTS, parseCSV, createProject, validateProject, importProject, updatePoint, reviewPoint, updateMeta, getSummary, exportCSV, exportHTML, exportMarkdown };
});
