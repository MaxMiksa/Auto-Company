// Shared, dependency-free evidence checks. Parameter names define their meaning.
const ALIASES = {
  mpn: ['mpn', '料号', '型号', '制造商料号'],
  parameter: ['parameter', '参数', '参数名', '规格参数'],
  value: ['value', '值', '数值', '规格值', '需求值'],
  unit: ['unit', '单位'], revision: ['revision', '版本', '修订', '修订号'],
  source: ['source', '来源', '源文件', '文件名'],
  locator: ['locator', '定位', '页码', '页码或章节', '位置'],
  quote: ['quote', '原文', '摘录', '证据原文'],
  operator: ['operator', '运算符', '条件', '比较符']
};
const NUMERIC = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const UNITS = {
  Pa: ['pressure', 1], kPa: ['pressure', 1000], MPa: ['pressure', 1000000], bar: ['pressure', 100000],
  V: ['voltage', 1], mV: ['voltage', 0.001], A: ['current', 1], mA: ['current', 0.001],
  Hz: ['frequency', 1], kHz: ['frequency', 1000], MHz: ['frequency', 1000000],
  '°C': ['temperature', 1], C: ['temperature', 1], '1': ['dimensionless', 1]
};
const LABELS = { block: '阻断', review: '待复核', clear: '未发现变化风险' };
const DECISIONS = { accepted: '人工接受', rejected: '人工拒绝', 'needs-info': '需要补充资料' };
const MAX_CSV = 5 * 1024 * 1024;
const str = value => value == null ? '' : String(value).trim();
const keyFor = row => JSON.stringify([row.mpn, row.parameter]);
const idFor = row => `${encodeURIComponent(row.mpn)}::${encodeURIComponent(row.parameter)}`;
const canonicalHeader = header => {
  const clean = header.trim().toLowerCase();
  return Object.keys(ALIASES).find(key => ALIASES[key].some(alias => alias.toLowerCase() === clean)) || header.trim();
};

export function parseCSV(text) {
  if (typeof text !== 'string') throw new Error('CSV 必须是文本。');
  if (text.length > MAX_CSV) throw new Error('CSV 超过 5 MB，请拆分后导入。');
  text = text.replace(/^\uFEFF/, '');
  if (!text.trim()) return [];
  const records = [];
  let record = [], cell = '', state = 'start';
  const endCell = () => { record.push(cell); cell = ''; state = 'start'; };
  const endRecord = () => {
    endCell();
    if (record.length > 1 || record.some(value => value.trim())) records.push(record);
    record = [];
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (state === 'quoted') {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else state = 'closed';
      } else cell += char;
      continue;
    }
    if (char === ',') { endCell(); continue; }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      endRecord(); continue;
    }
    if (state === 'closed') throw new Error(`CSV 第 ${records.length + 1} 行：引号闭合后存在多余字符。`);
    if (char === '"') {
      if (state !== 'start') throw new Error(`CSV 第 ${records.length + 1} 行：未转义的引号。`);
      state = 'quoted';
    } else { cell += char; state = 'plain'; }
  }
  if (state === 'quoted') throw new Error('CSV 引号未闭合。');
  if (cell || record.length || state === 'closed') endRecord();
  if (!records.length) return [];
  const headers = records.shift().map(canonicalHeader);
  if (headers.some(header => !header)) throw new Error('CSV 列名不能为空。');
  if (new Set(headers).size !== headers.length) throw new Error('CSV 存在重复列名或同义列名。');
  if (records.length > 10000) throw new Error('CSV 超过 10,000 行，请拆分后导入。');
  return records.map((row, index) => {
    if (row.length !== headers.length) throw new Error(`CSV 第 ${index + 2} 行有 ${row.length} 列，应有 ${headers.length} 列。`);
    const result = Object.create(null);
    headers.forEach((header, i) => { result[header] = row[i].trim(); });
    if ((headers.includes('mpn') && !result.mpn) || (headers.includes('parameter') && !result.parameter)) throw new Error(`CSV 第 ${index + 2} 行的料号或参数为空。`);
    return result;
  });
}

function number(value) {
  const text = str(value);
  return NUMERIC.test(text) && Number.isFinite(Number(text)) ? Number(text) : null;
}
function quantity(row) {
  if (!row) return null;
  const value = number(row.value), unit = Object.hasOwn(UNITS, str(row.unit)) ? UNITS[str(row.unit)] : null;
  if (value === null || !unit) return null;
  const normalized = value * unit[1];
  return Number.isFinite(normalized) ? { value: normalized, dimension: unit[0] } : null;
}
function nearlyEqual(a, b) { return Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * 1e-10; }
function equivalent(a, b) {
  const qa = quantity(a), qb = quantity(b);
  if (qa && qb && qa.dimension === qb.dimension) return nearlyEqual(qa.value, qb.value);
  return a.value === b.value && a.unit === b.unit;
}
function normalizeRows(rows, kind) {
  if (!Array.isArray(rows)) throw new Error(`${kind}必须是数据行数组。`);
  if (rows.length > 10000) throw new Error(`${kind}超过 10,000 行。`);
  return rows.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`${kind}第 ${index + 1} 行无效。`);
    if (!Object.hasOwn(row, 'value')) throw new Error(`${kind}第 ${index + 1} 行缺少关键列 value。`);
    const clean = {};
    for (const field of Object.keys(ALIASES)) {
      if (row[field] != null && typeof row[field] !== 'string' && typeof row[field] !== 'number') throw new Error(`${kind}第 ${index + 1} 行的 ${field} 无效。`);
      clean[field] = str(row[field]);
    }
    if (!clean.mpn || !clean.parameter) throw new Error(`${kind}第 ${index + 1} 行的料号或参数为空。`);
    if (kind === '需求') {
      if (!['min', 'max', 'equals'].includes(clean.operator)) throw new Error(`需求第 ${index + 1} 行的 operator 无效，仅支持 min、max、equals。`);
      if (number(clean.value) === null) throw new Error(`需求第 ${index + 1} 行的数值无效，请使用有限数字或科学计数法。`);
      if (!clean.unit) throw new Error(`需求第 ${index + 1} 行缺少单位；无量纲数值使用 1。`);
    }
    return clean;
  });
}
function group(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFor(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}
function evidence(rows) {
  return Object.fromEntries(['source', 'locator', 'quote'].map(field => [field, [...new Set(rows.map(row => row[field]).filter(Boolean))].join('\n') ]));
}

export function audit(oldRows, newRows, requirementRows = []) {
  const old = group(normalizeRows(oldRows, '旧版规格'));
  const current = group(normalizeRows(newRows, '新版规格'));
  const requirements = group(normalizeRows(requirementRows, '需求'));
  if (!old.size && !current.size && !requirements.size) throw new Error('规格和需求均无数据，请先导入资料。');
  for (const rows of requirements.values()) {
    if (new Set(rows.map(row => row.operator)).size !== rows.length) throw new Error(`需求重复：${rows[0].mpn} / ${rows[0].parameter} 存在重复 operator；请核对后合并，不能覆盖。`);
    const low = rows.find(row => row.operator === 'min'), high = rows.find(row => row.operator === 'max');
    const qLow = quantity(low), qHigh = quantity(high);
    if (qLow && qHigh && qLow.dimension === qHigh.dimension && qLow.value > qHigh.value && !nearlyEqual(qLow.value, qHigh.value)) throw new Error(`需求矛盾：${low.mpn} / ${low.parameter} 的最小值大于最大值。`);
  }
  const keys = new Set([...old.keys(), ...current.keys(), ...requirements.keys()]);
  return [...keys].map(key => {
    const before = old.get(key) || [], after = current.get(key) || [], needs = requirements.get(key) || [];
    const first = after[0] || before[0] || needs[0];
    let severity = 'clear';
    const reasons = [];
    const mark = (level, reason) => {
      if (level === 'block' || (level === 'review' && severity === 'clear')) severity = level;
      reasons.push(reason);
    };
    for (const [label, rows] of [['旧版', before], ['新版', after]]) {
      if (rows.length > 1) {
        if (rows.some(row => !equivalent(row, rows[0]))) mark('block', `${label}同一料号和参数存在冲突规格，不能自动选择其中一行。`);
        else mark('review', `${label}存在重复规格行，请确认版本和证据归属。`);
      }
      for (const row of rows) {
        if (!row.value) mark('review', `${label}缺少参数值。`);
        else if (number(row.value) === null) mark('review', `${label}参数值不是可核验的有限数字，请人工提取范围、典型值或上下限。`);
        if (!Object.hasOwn(UNITS, row.unit)) mark('review', `${label}单位为空或不支持：${row.unit || '（空）'}。`);
        else if (number(row.value) !== null && !quantity(row)) mark('review', `${label}单位换算后数值超出可计算范围。`);
        if (!row.revision) mark('review', `${label}缺少修订版本。`);
        if (!row.source || !row.locator || !row.quote) mark('review', `${label}证据不完整，需同时提供来源、页码/章节和原文。`);
      }
    }
    if (!before.length && after.length) mark('review', '新增料号或参数；仅按完全相同料号匹配，不自动认定替代关系。');
    if (!after.length) mark('review', needs.length ? '新版缺少需求指定的料号或参数，不能证明满足需求。' : '新版缺少旧版料号或参数，请核对是否移除。');
    if (before.length && after.length) {
      const a = before[0], b = after[0];
      const qa = quantity(a), qb = quantity(b);
      if (qa && qb && qa.dimension !== qb.dimension) mark('review', '旧新版单位量纲不一致，无法比较。');
      else if (!equivalent(a, b)) mark('review', '参数值发生变化，请确认对采购需求的影响。');
      else if (a.value !== b.value || a.unit !== b.unit) reasons.push('数值表达或单位发生变化，换算后的数值等价。');
      if (a.revision !== b.revision) mark('review', '修订版本发生变化，需确认变更记录。');
    }
    if (!needs.length) mark('review', '未提供对应需求，本次仅核对变化与证据，不代表规格合格。');
    for (const need of needs) {
      const qNeed = quantity(need);
      if (!qNeed) { mark('review', `需求单位不支持或换算溢出：${need.unit}，不能自动判定。`); continue; }
      for (const row of after) {
        const q = quantity(row);
        if (!q || q.dimension !== qNeed.dimension) { mark('review', '新版与需求缺少可比较的数值/同量纲单位，需人工复核。'); continue; }
        const same = nearlyEqual(q.value, qNeed.value);
        const pass = need.operator === 'min' ? q.value > qNeed.value || same : need.operator === 'max' ? q.value < qNeed.value || same : same;
        if (!pass) mark('block', `新版不满足需求：${need.operator} ${need.value} ${need.unit}。`);
      }
    }
    if (severity === 'clear') reasons.push(needs.length ? '数值无变化，当前记录满足所列需求；证据真实性仍需人工确认。' : '记录无变化且证据字段齐全；尚未作需求符合性结论。');
    const display = (rows, field) => [...new Set(rows.map(row => row[field]))].join(' / ');
    return {
      id: idFor(first), mpn: first.mpn, parameter: first.parameter,
      oldValue: display(before, 'value'), newValue: display(after, 'value'),
      oldUnit: display(before, 'unit'), newUnit: display(after, 'unit'),
      unit: display(after.length ? after : before, 'unit'),
      oldRevision: display(before, 'revision'), newRevision: display(after, 'revision'),
      severity, reasons: [...new Set(reasons)], oldEvidence: evidence(before), newEvidence: evidence(after),
      requirement: needs.map(row => `${row.operator} ${row.value} ${row.unit}`).join('；') || '未提供'
    };
  });
}

function csvCell(value) {
  let text = String(value == null ? '' : value);
  // Spreadsheet formula injection protection, including leading whitespace.
  if (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
function reviewFor(reviews, id) { return reviews && Object.hasOwn(reviews, id) ? reviews[id] : {}; }
export function toCSV(findings, reviews = {}) {
  const headers = ['记录ID', '料号', '参数', '原始风险等级', '风险说明', '旧值', '旧单位', '新值', '新单位', '旧版本', '新版本', '需求', '原因', '旧来源', '旧定位', '旧原文', '新来源', '新定位', '新原文', '复核代码', '人工结论', '复核人', '复核备注'];
  const rows = findings.map(f => {
    const r = reviewFor(reviews, f.id);
    return [f.id, f.mpn, f.parameter, f.severity, LABELS[f.severity], f.oldValue, f.oldUnit || '', f.newValue, f.newUnit || f.unit, f.oldRevision, f.newRevision, f.requirement, f.reasons.join('；'), f.oldEvidence.source, f.oldEvidence.locator, f.oldEvidence.quote, f.newEvidence.source, f.newEvidence.locator, f.newEvidence.quote, r.decision || '', DECISIONS[r.decision] || '未复核', r.reviewer, r.note];
  });
  return '\uFEFF' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
}
const escapeHTML = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export function reportHTML(findings, reviews = {}, title = '规格变更核验') {
  const e = escapeHTML;
  const evidenceBlock = data => `<p><strong>来源：</strong>${e(data.source || '缺失')}<br><strong>定位：</strong>${e(data.locator || '缺失')}</p><blockquote>${e(data.quote || '原文缺失')}</blockquote>`;
  const sections = findings.map(f => {
    const r = reviewFor(reviews, f.id);
    return `<section data-severity="${e(f.severity)}"><h2>${e(f.mpn)} · ${e(f.parameter)} <small>${e(LABELS[f.severity])} (${e(f.severity)})</small></h2><table><tr><th>旧值 / 修订</th><th>新值 / 修订</th><th>需求</th></tr><tr><td>${e(f.oldValue || '缺失')} ${e(f.oldUnit || '')} / ${e(f.oldRevision || '缺失')}</td><td>${e(f.newValue || '缺失')} ${e(f.newUnit || f.unit || '')} / ${e(f.newRevision || '缺失')}</td><td>${e(f.requirement)}</td></tr></table><ul>${f.reasons.map(reason => `<li>${e(reason)}</li>`).join('')}</ul><div class="evidence"><div><h3>旧版证据</h3>${evidenceBlock(f.oldEvidence)}</div><div><h3>新版证据</h3>${evidenceBlock(f.newEvidence)}</div></div><p><strong>人工结论：</strong>${e(DECISIONS[r.decision] || '未复核')} ${r.decision ? '(' + e(r.decision) + ')' : ''} · ${e(r.reviewer || '未署名')}</p><p>${e(r.note || '无复核备注')}</p><small>记录ID：${e(f.id)}</small></section>`;
  }).join('');
  const counts = ['block', 'review', 'clear'].map(level => `${LABELS[level]} ${findings.filter(f => f.severity === level).length}`).join(' · ');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${e(title)}</title><style>body{font-family:Georgia,'Noto Serif CJK SC',serif;color:#21312d;max-width:1100px;margin:40px auto;padding:0 24px;line-height:1.6}h1{font-size:32px}h2{font-size:21px}small{font-size:13px}section{border-top:2px solid #21312d;padding:20px 0;margin:24px 0;break-inside:avoid}table{width:100%;border-collapse:collapse}th,td{text-align:left;border:1px solid #b9c4bd;padding:9px;overflow-wrap:anywhere}.evidence{display:grid;grid-template-columns:1fr 1fr;gap:24px}p,blockquote,li{white-space:pre-wrap;overflow-wrap:anywhere}blockquote{margin:8px 0;border-left:3px solid #b9c4bd;padding:8px 12px;background:#f4f6f2}@media print{body{margin:0;padding:0;font-size:11pt}section{break-inside:auto}h2{break-after:avoid}}@media(max-width:600px){.evidence{grid-template-columns:1fr}}</style></head><body><h1>${e(title)}</h1><p>${e(counts)}</p><p>这是输入资料的核验记录。人工接受不会抹去原始风险等级；未提供需求不代表合格。来源字段和摘录齐全不等于源文件真实，附件不自动证明摘录。请由有权限的工程/采购人员核对原始文件。</p>${sections}<footer>本地生成，无外部资源或可执行脚本。</footer></body></html>`;
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${label}必须是普通对象。`);
}
function keysOnly(value, allowed, label) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`${label}包含未知字段，请使用本工具导出的项目。`);
}
function stringField(value, label, max, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`${label}为空、类型错误或过长。`);
  return value;
}
export function validateArchive(data) {
  object(data, '项目');
  let encodedLength;
  try { encodedLength = new TextEncoder().encode(JSON.stringify(data)).length; } catch { throw new Error('项目无法编码为 JSON。'); }
  if (encodedLength > 10 * 1024 * 1024) throw new Error('项目备份超过 10 MB，请减少附件或拆分资料。');
  keysOnly(data, ['version', 'title', 'inputs', 'reviews', 'attachments', 'savedAt'], '项目');
  if (data.version !== 1) throw new Error('项目版本不支持，仅支持 version 1。');
  const title = stringField(data.title, '项目名称', 200);
  object(data.inputs, '项目输入');
  keysOnly(data.inputs, ['old', 'new', 'requirements'], '项目输入');
  const inputs = {};
  for (const field of ['old', 'new', 'requirements']) inputs[field] = stringField(data.inputs[field], `项目输入 ${field}`, MAX_CSV, false);
  object(data.reviews, '人工复核');
  // Drafts retain recoverable input errors. Signed reviews require valid inputs.
  const findings = Object.keys(data.reviews).length ? audit(parseCSV(inputs.old), parseCSV(inputs.new), parseCSV(inputs.requirements)) : [];
  const ids = new Set(findings.map(f => f.id));
  const reviews = {};
  for (const [id, review] of Object.entries(data.reviews)) {
    if (!ids.has(id)) throw new Error('项目复核引用了不存在的记录，拒绝导入。');
    object(review, '复核记录');
    keysOnly(review, ['decision', 'reviewer', 'note'], '复核记录');
    if (!Object.hasOwn(DECISIONS, review.decision)) throw new Error('复核结论无效。');
    reviews[id] = { decision: review.decision, reviewer: stringField(review.reviewer, '复核人', 200), note: stringField(review.note, '复核备注', 5000) };
  }
  const savedAt = stringField(data.savedAt, '保存时间', 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(savedAt) || !Number.isFinite(Date.parse(savedAt))) throw new Error('项目保存时间不是有效 UTC 日期。');
  const canonicalTime = savedAt.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction = '') => `.${fraction.padEnd(3, '0')}Z`);
  if (new Date(savedAt).toISOString() !== canonicalTime) throw new Error('项目保存时间包含不存在的日期。');
  const attachments = data.attachments === undefined ? [] : data.attachments;
  if (!Array.isArray(attachments) || attachments.length > 20) throw new Error('附件必须是数组且最多 20 个。');
  let totalSize = 0;
  const safeAttachments = attachments.map(item => {
    object(item, '附件');
    keysOnly(item, ['name', 'type', 'size', 'sha256', 'data'], '附件');
    const name = stringField(item.name, '附件名称', 200);
    if (/[\/\\\x00-\x1f]/.test(name) || name === '.' || name === '..') throw new Error('附件名称含不安全字符。');
    const type = stringField(item.type, '附件类型', 100);
    if (!['application/pdf', 'text/plain'].includes(type)) throw new Error('附件仅支持 PDF、TXT。');
    if (!Number.isInteger(item.size) || item.size < 1 || item.size > 10 * 1024 * 1024) throw new Error('单个附件必须在 1 字节至 10 MB 之间。');
    totalSize += item.size;
    if (totalSize > 10 * 1024 * 1024) throw new Error('附件总大小超过 10 MB。');
    const sha256 = stringField(item.sha256, '附件摘要', 64);
    if (!/^[a-f\d]{64}$/i.test(sha256)) throw new Error('附件 SHA-256 摘要格式无效。');
    const encoded = stringField(item.data, '附件内容', 14 * 1024 * 1024);
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('附件不是有效 Base64 内容。');
    const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
    if (encoded.length / 4 * 3 - padding !== item.size) throw new Error('附件声明大小与内容不符。');
    return { name, type, size: item.size, sha256, data: encoded };
  });
  return { version: 1, title, inputs, reviews, attachments: safeAttachments, savedAt };
}
