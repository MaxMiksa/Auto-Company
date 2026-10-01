// 所有处理在本地进行；身份、范围与转换授权由使用者明确声明。
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 20000;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export function parseCSV(text) {
  if (typeof text !== 'string') throw new Error('CSV 必须是文本。');
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('CSV 超过 5 MB 上限，请拆分导出。');
  text = text.replace(/^\uFEFF/, '');
  if (!text.length) throw new Error('CSV 文件为空。');
  if (text.includes('\0')) throw new Error('CSV 包含无效的空字符，请重新导出为 UTF-8 文本。');
  const records = [];
  let row = [], cell = '', quoted = false, closed = false, atStart = true;
  const finishCell = () => { row.push(cell); cell = ''; closed = false; atStart = true; };
  const finishRow = () => {
    finishCell(); records.push(row); row = [];
    if (records.length > MAX_ROWS + 1) throw new Error('CSV 超过每表 20,000 行上限，请拆分导出。');
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; closed = true; }
      } else cell += char;
      continue;
    }
    if (char === '"') {
      if (!atStart || closed) throw new Error(`CSV 第 ${records.length + 1} 行引号格式错误。`);
      quoted = true; atStart = false;
    } else if (char === ',') finishCell();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      finishRow();
    } else {
      if (closed) throw new Error(`CSV 第 ${records.length + 1} 行关闭引号后含有多余字符。`);
      cell += char; atStart = false;
    }
  }
  if (quoted) throw new Error('CSV 引号未闭合，请检查多行字段。');
  if (row.length || cell.length || closed || !atStart) finishRow();
  if (!records.length) throw new Error('CSV 文件为空。');
  const headers = records.shift();
  if (headers.some(header => !header.trim())) throw new Error('CSV 表头不能为空。');
  if (new Set(headers).size !== headers.length) throw new Error('CSV 包含重复表头，请使用唯一列名。');
  const rows = records.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`CSV 第 ${index + 2} 行有 ${values.length} 列，表头为 ${headers.length} 列。`);
    return Object.fromEntries(headers.map((header, i) => [header, values[i]]));
  });
  return { headers, rows };
}

function decimal(value) {
  const text = value.trim();
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(text)) throw new Error('金额不是普通十进制字符串（不接受逗号、指数或货币符号）');
  const negative = text[0] === '-';
  const [whole, fraction = ''] = text.replace(/^[+-]/, '').split('.');
  const integer = whole.replace(/^0+(?=\d)/, '');
  const tail = fraction.replace(/0+$/, '');
  const zero = integer === '0' && !tail;
  return `${negative && !zero ? '-' : ''}${integer}${tail ? '.' + tail : ''}`;
}

function normalized(value, type, precision = 2) {
  const text = value.trim();
  if (!text) return '';
  if (type === 'text') return text;
  if (type === 'email') return text.toLowerCase();
  if (type === 'money') {
    const canonical = decimal(text);
    if ((canonical.split('.')[1] || '').length > precision) throw new Error(`金额超出已声明的 ${precision} 位小数精度，不允许舍入`);
    return canonical;
  }
  if (type === 'date') {
    const match = /^(\d{4})([-/])(\d{2})\2(\d{2})$/.exec(text);
    if (!match) throw new Error('日期须为 YYYY-MM-DD 或 YYYY/MM/DD');
    const year = Number(match[1]), month = Number(match[3]), day = Number(match[4]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) throw new Error('日期不是有效日历日期');
    return `${match[1]}-${match[3]}-${match[4]}`;
  }
  throw new Error('不支持的字段类型');
}

export function audit(config = {}) {
  if (!config || typeof config !== 'object') config = {};
  const report = {
    version: 1, status: 'unknown', project: typeof config.project === 'string' ? config.project : '未命名项目',
    summary: { sourceRows: 0, targetRows: 0, issues: 0, unknowns: 0 },
    checks: [], issues: [], unknowns: [], scope: config.scope || {}, generatedAt: new Date().toISOString(),
    limitation: '结果仅覆盖所提供的表、明确的字段映射及声明的快照；不是 CRM 全系统或实际授权的独立证明。',
  };
  const unknown = message => { if (!report.unknowns.includes(message)) report.unknowns.push(message); };
  try { report.config = JSON.parse(JSON.stringify(config)); }
  catch { report.config = null; unknown('输入配置不能保存为 JSON，请移除循环引用或非 JSON 值。'); }
  report.scope = report.config?.scope || {};
  const issue = (object, kind, key, field, source, target, message) => {
    report.issues.push({ object, kind, key: String(key ?? ''), field: String(field ?? ''), source: String(source ?? ''), target: String(target ?? ''), message });
  };
  const check = (name, issueStart, unknownStart, detail) => report.checks.push({
    name, status: report.issues.length > issueStart ? 'fail' : report.unknowns.length > unknownStart ? 'unknown' : 'pass', detail,
  });
  const scope = config.scope || {};
  for (const [key, message] of [
    ['complete', '尚未确认源端和目标端导出范围完整一致。'],
    ['identity', '尚未确认稳定身份或经核实的旧 ID 映射，不能猜测记录身份。'],
    ['rules', '尚未确认字段转换与值映射已获授权。'],
    ['snapshot', '尚未确认源端和目标端快照可比。'],
  ]) {
    const valid = scope[key] === true;
    if (!valid) unknown(message);
    report.checks.push({ name: `契约：${{ complete: '导出范围', identity: '稳定身份', rules: '转换授权', snapshot: '可比快照' }[key]}`, status: valid ? 'pass' : 'unknown', detail: valid ? '使用者已明确声明；工具未独立验证该声明。' : message });
  }
  function table(value, label, columns) {
    if (!value || !Array.isArray(value.headers) || !Array.isArray(value.rows)) { unknown(`${label}缺少可读取的数据表。`); return false; }
    if (!value.headers.length || value.headers.some(h => typeof h !== 'string' || !h.trim()) || new Set(value.headers).size !== value.headers.length) { unknown(`${label}表头无效或重复。`); return false; }
    if (value.rows.length > MAX_ROWS) { unknown(`${label}超过每表 20,000 行上限。`); return false; }
    const missing = columns.filter(column => typeof column !== 'string' || !column || !value.headers.includes(column));
    if (missing.length) { unknown(`${label}缺少已指定的列：${missing.map(v => v || '未选择').join('、')}。`); return false; }
    if (value.rows.some(row => !row || typeof row !== 'object' || value.headers.some(header => !own(row, header) || typeof row[header] !== 'string'))) { unknown(`${label}行值须与表头对应，且每格必须是字符串。`); return false; }
    return true;
  }
  const indexes = new Map();
  const objects = Array.isArray(config.objects) ? config.objects : [];
  if (!objects.length) unknown('尚未配置任何待验收对象。');
  const names = new Set();
  for (const object of objects) {
    if (!object || typeof object.name !== 'string' || !object.name.trim()) { unknown('对象名称缺失。'); continue; }
    const name = object.name;
    if (names.has(name)) { unknown(`对象名称重复：${name}。`); indexes.delete(name); continue; }
    names.add(name);
    const issueStart = report.issues.length, unknownStart = report.unknowns.length;
    const sourceOK = table(object.source, `${name}源表`, [object.key?.source]);
    const targetOK = table(object.target, `${name}目标表`, [object.key?.target]);
    if (sourceOK) report.summary.sourceRows += object.source.rows.length;
    if (targetOK) report.summary.targetRows += object.target.rows.length;
    if (!sourceOK || !targetOK || scope.identity !== true) {
      report.checks.push({ name: `${name}：记录身份核验`, status: 'unknown', detail: '缺少稳定身份或必要输入，未以邮件、顺序或数值猜测配对。' });
      continue;
    }
    function index(rows, column, side) {
      const map = new Map();
      for (const [i, row] of rows.entries()) {
        const key = row[column];
        if (!key.trim()) { issue(name, 'empty-key', '', column, side === 'source' ? key : '', side === 'target' ? key : '', `${side === 'source' ? '源端' : '目标端'}第 ${i + 2} 行身份为空。`); continue; }
        if (map.has(key)) { issue(name, 'duplicate-key', key, column, side === 'source' ? key : '', side === 'target' ? key : '', `${side === 'source' ? '源端' : '目标端'}身份重复，不能唯一配对。`); map.set(key, null); }
        else map.set(key, row);
      }
      return map;
    }
    const source = index(object.source.rows, object.key.source, 'source');
    const target = index(object.target.rows, object.key.target, 'target');
    indexes.set(name, { source, target });
    for (const key of source.keys()) if (!target.has(key)) issue(name, 'missing-record', key, '', key, '', '目标端缺少源记录。');
    for (const key of target.keys()) if (!source.has(key)) issue(name, 'extra-record', key, '', '', key, '目标端存在源端没有的记录。');
    const fields = Array.isArray(object.fields) ? object.fields : [];
    if (!fields.length) unknown(`${name}未配置任何待核验字段，仅检查身份不能形成完整字段验收。`);
    const usableFields = fields.filter(field => {
      if (!field || !['text', 'email', 'money', 'date'].includes(field.type)) { unknown(`${name}含未配置或不支持的字段类型。`); return false; }
      if (field.map !== undefined && (!field.map || typeof field.map !== 'object' || Array.isArray(field.map) || Object.values(field.map).some(v => typeof v !== 'string'))) { unknown(`${name}字段 ${field.source} 的值映射必须是字符串到字符串的对象。`); return false; }
      if (field.type === 'money' && field.precision !== undefined && (!Number.isInteger(field.precision) || field.precision < 0 || field.precision > 8)) { unknown(`${name}字段 ${field.source} 的金额精度必须是 0 至 8 的整数。`); return false; }
      return table(object.source, `${name}源表`, [field.source]) && table(object.target, `${name}目标表`, [field.target]);
    });
    if (usableFields.some(field => field.type === 'money') && !object.currency) unknown(`${name}金额字段尚未指定币种列。`);
    const currencyOK = object.currency && table(object.source, `${name}源表`, [object.currency.source]) && table(object.target, `${name}目标表`, [object.currency.target]);
    if (scope.rules === true) {
      for (const [key, sourceRow] of source) {
        const targetRow = target.get(key);
        if (!sourceRow || !targetRow) continue;
        for (const field of usableFields) {
          const left = sourceRow[field.source], right = targetRow[field.target];
          let mapped = right;
          if (field.map !== undefined) {
            if (own(field.map, right)) mapped = field.map[right];
          }
          try {
            // 授权值映射不能掩盖原始金额格式或精度错误。
            if (field.type === 'money') normalized(right, field.type, field.precision);
            if (normalized(left, field.type, field.precision) !== normalized(mapped, field.type, field.precision)) issue(name, 'field-mismatch', key, `${field.source} → ${field.target}`, left, right, '字段值不符合已声明的转换与值映射。');
          } catch (error) { issue(name, 'invalid-field', key, `${field.source} → ${field.target}`, left, right, error.message); }
        }
        if (currencyOK) {
          const left = sourceRow[object.currency.source], right = targetRow[object.currency.target];
          if (!left.trim() || !right.trim()) issue(name, 'invalid-field', key, '币种', left, right, '金额记录的币种不能为空。');
          else if (left !== right) issue(name, 'currency-mismatch', key, '币种', left, right, '逐记录币种发生变化；不同币种不能相加抵消。');
        }
      }
    } else unknown(`${name}字段比较需要先确认转换授权。`);
    check(`${name}：记录与字段核验`, issueStart, unknownStart, `源 ${object.source.rows.length} 行，目标 ${object.target.rows.length} 行；按字符串身份配对，逐字段核验。`);
  }
  const requiresRelationships = scope.relationships !== false;
  if (!requiresRelationships) unknown('本次明确排除关联验收，关联迁移正确性未验证。');
  if (requiresRelationships && (!Array.isArray(config.relationships) || !config.relationships.length)) unknown('本次包含关联验收，但尚未配置源端和目标端关联表。');
  if (config.relationships !== undefined && !Array.isArray(config.relationships)) unknown('关联配置必须是数组。');
  report.checks.push({ name: '契约：关联范围', status: !requiresRelationships || !Array.isArray(config.relationships) || !config.relationships.length ? 'unknown' : 'pass', detail: requiresRelationships ? '本次需要逐关联对核验；必须提供两端关联表。' : '使用者明确排除关联验收；本报告不能证明关联迁移正确。' });
  for (const relation of requiresRelationships && Array.isArray(config.relationships) ? config.relationships : []) {
    const name = relation?.name || '未命名关联';
    const issueStart = report.issues.length, unknownStart = report.unknowns.length;
    const sourceOK = table(relation?.source, `${name}源关联表`, [relation?.from?.source, relation?.to?.source]);
    const targetOK = table(relation?.target, `${name}目标关联表`, [relation?.from?.target, relation?.to?.target]);
    const from = indexes.get(relation?.from?.object), to = indexes.get(relation?.to?.object);
    if (!from || !to) unknown(`${name}缺少可核实的关联端点对象身份。`);
    if (!sourceOK || !targetOK || !from || !to) {
      report.checks.push({ name: `${name}：关联核验`, status: 'unknown', detail: '须提供两端关联表，并先将目标关联端点还原为对象使用的旧 ID 身份。' });
      continue;
    }
    let roleOK = false;
    if (relation.role) {
      const columnsOK = table(relation.source, `${name}源关联表`, [relation.role.source]) && table(relation.target, `${name}目标关联表`, [relation.role.target]);
      const map = relation.role.map;
      const mappingOK = map === undefined || (map && typeof map === 'object' && !Array.isArray(map) && Object.values(map).every(v => typeof v === 'string'));
      if (!mappingOK) unknown(`${name}关联角色值映射必须是字符串到字符串的对象。`);
      if (scope.rules !== true) unknown(`${name}关联角色比较需要确认转换授权。`);
      roleOK = columnsOK && mappingOK && scope.rules === true;
    }
    const tupleComplete = !relation.role || roleOK;
    function edges(rows, side) {
      const result = new Map();
      for (const row of rows) {
        const left = row[relation.from[side]], right = row[relation.to[side]];
        const identity = [left, right];
        if (roleOK) {
          let role = row[relation.role[side]];
          if (side === 'target' && relation.role.map && own(relation.role.map, role)) role = relation.role.map[role];
          identity.push(role.trim());
        }
        const id = JSON.stringify(identity);
        if (!from[side].get(left) || !to[side].get(right)) issue(name, 'orphan-relationship', `${left} → ${right}`, '', side === 'source' ? id : '', side === 'target' ? id : '', '关联端点不存在、为空或身份重复；请核对旧 ID 映射。');
        const count = (result.get(id) || 0) + 1;
        result.set(id, count);
        if (tupleComplete && count > 1) issue(name, 'duplicate-relationship', identity.join(' → '), '', side === 'source' ? id : '', side === 'target' ? id : '', `${side === 'source' ? '源端' : '目标端'}存在重复的关联对${roleOK ? '与角色' : ''}。`);
      }
      return result;
    }
    const source = edges(relation.source.rows, 'source'), target = edges(relation.target.rows, 'target');
    if (tupleComplete) {
      for (const [key, count] of source) if (count > (target.get(key) || 0)) issue(name, 'missing-relationship', JSON.parse(key).join(' → '), '', String(count), String(target.get(key) || 0), '目标缺少关联或该关联出现次数减少。');
      for (const [key, count] of target) if (count > (source.get(key) || 0)) issue(name, 'extra-relationship', JSON.parse(key).join(' → '), '', String(source.get(key) || 0), String(count), '目标出现新增关联、错挂关联或额外重复。');
    }
    check(`${name}：多对多关联核验`, issueStart, unknownStart, `源 ${relation.source.rows.length} 对，目标 ${relation.target.rows.length} 对；逐关联对及出现次数比较。${roleOK ? '已包含声明的关联角色。' : '未核验关系角色，仅核验端点；未配置角色列时不包含角色语义。'}`);
  }
  report.summary.issues = report.issues.length;
  report.summary.unknowns = report.unknowns.length;
  report.status = report.issues.length ? 'fail' : report.unknowns.length ? 'unknown' : 'pass';
  return report;
}

export function toCSV(report) {
  const columns = ['object', 'kind', 'key', 'field', 'source', 'target', 'message'];
  const labels = ['对象', '异常类型', '身份或关联', '字段', '源值', '目标值', '说明'];
  const escape = value => {
    let text = String(value ?? '');
    if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const lines = [labels.map(escape).join(',')];
  for (const item of report.issues || []) lines.push(columns.map(column => escape(item[column])).join(','));
  for (const message of report.unknowns || []) lines.push(['证据范围', 'unknown', '', '', '', '', message].map(escape).join(','));
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

export function demoConfig(mode = 'valid') {
  const contacts = {
    name: '联系人', key: { source: 'contact_id', target: 'legacy_id' },
    source: parseCSV('contact_id,name,email,stage\n001, 张晨 ,Chen@EXAMPLE.invalid,active\n002,李明,ming@example.invalid,active\n003,王青,qing@example.invalid,inactive'),
    target: parseCSV('record_id,legacy_id,display_name,email,status\nC12,002,李明,ming@example.invalid,A\nC11,001,张晨,chen@example.invalid,A\nC13,003,王青,qing@example.invalid,I'),
    fields: [{ source: 'name', target: 'display_name', type: 'text' }, { source: 'email', target: 'email', type: 'email' }, { source: 'stage', target: 'status', type: 'text', map: { A: 'active', I: 'inactive' } }],
  };
  const deals = {
    name: '交易', key: { source: 'deal_id', target: 'legacy_id' },
    source: parseCSV('deal_id,amount,currency,close_date\nD1,100.10,CNY,2026-09-30\nD2,200.20,USD,2026-09-30\nD3,-50.00,CNY,2026-10-01'),
    target: parseCSV('record_id,legacy_id,value,money,closed_on\nT13,D3,-50,CNY,2026/10/01\nT11,D1,100.1,CNY,2026/09/30\nT12,D2,200.200,USD,2026/09/30'),
    fields: [{ source: 'amount', target: 'value', type: 'money' }, { source: 'close_date', target: 'closed_on', type: 'date' }], currency: { source: 'currency', target: 'money' },
  };
  const config = {
    project: '构造示例 · CRM 迁移核验',
    scope: { complete: true, identity: true, rules: true, snapshot: true, relationships: true, note: '完全合成数据；目标 record_id 已通过 legacy_id 还原，目标关联端点也已还原旧 ID。不是实际客户或真实迁移证据。' },
    objects: [contacts, deals],
    relationships: [{ name: '交易—联系人', source: parseCSV('deal_id,contact_id,role\nD1,001,primary\nD1,002,primary\nD2,002,primary\nD3,003,primary'), target: parseCSV('old_deal_id,old_contact_id,role\nD3,003,P\nD2,002,P\nD1,002,P\nD1,001,P'), from: { object: '交易', source: 'deal_id', target: 'old_deal_id' }, to: { object: '联系人', source: 'contact_id', target: 'old_contact_id' }, role: { source: 'role', target: 'role', map: { P: 'primary' } } }],
  };
  if (mode === 'broken') {
    contacts.target.rows[1].legacy_id = '1';
    contacts.target.rows[0].status = 'I';
    contacts.target.rows.push({ ...contacts.target.rows[2] });
    deals.target.rows[1].value = '100.101';
    deals.target.rows[2].money = 'CNY';
    config.relationships[0].target.rows[3].old_contact_id = '999';
    config.relationships[0].target.rows.push({ ...config.relationships[0].target.rows[1] });
  } else if (mode === 'unknown') {
    config.scope.complete = false;
    config.scope.snapshot = false;
    config.relationships[0].target = null;
  } else if (mode !== 'valid') throw new Error('示例模式必须为 valid、broken 或 unknown。');
  return config;
}
