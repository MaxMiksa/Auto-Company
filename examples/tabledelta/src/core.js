export const LIMITS = Object.freeze({
  bytes: 2_097_152,
  rows: 10_000,
  columns: 100,
  cells: 200_000,
});

export class CsvError extends Error {
  constructor(message, { name = 'input.csv', side = '文件', record = 1, code = 'INVALID_CSV', firstRecord } = {}) {
    super(`${side}「${name}」·逻辑记录 ${record}：${message}`);
    this.name = 'CsvError';
    this.fileName = name;
    this.side = side;
    this.record = record;
    this.code = code;
    if (firstRecord !== undefined) this.firstRecord = firstRecord;
  }
}

function fail(file, record, code, message, details = {}) {
  throw new CsvError(message, { name: file.name, side: file.side, record, code, ...details });
}

// TextDecoder does not expose the bad byte position. Locate it only on decoding failure.
function invalidUtf8Offset(bytes) {
  for (let i = 0; i < bytes.length; i += 1) {
    const lead = bytes[i];
    if (lead < 0x80) continue;
    let width;
    let secondMin = 0x80;
    let secondMax = 0xbf;
    if (lead >= 0xc2 && lead <= 0xdf) {
      width = 2;
    } else if (lead >= 0xe0 && lead <= 0xef) {
      width = 3;
      if (lead === 0xe0) secondMin = 0xa0;
      if (lead === 0xed) secondMax = 0x9f;
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      width = 4;
      if (lead === 0xf0) secondMin = 0x90;
      if (lead === 0xf4) secondMax = 0x8f;
    } else {
      return i;
    }
    if (i + width > bytes.length || bytes[i + 1] < secondMin || bytes[i + 1] > secondMax) return i;
    for (let j = 2; j < width; j += 1) {
      if (bytes[i + j] < 0x80 || bytes[i + j] > 0xbf) return i;
    }
    i += width - 1;
  }
  return bytes.length;
}

function prefixRecord(text) {
  let record = 1;
  let quoted = false;
  let fieldStart = true;
  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];
    if (quoted) {
      if (character === '"') {
        if (text[i + 1] === '"') i += 1;
        else quoted = false;
      }
    } else if (character === '\n') {
      record += 1;
      fieldStart = true;
    } else if (character === ',') {
      fieldStart = true;
    } else {
      if (character === '"' && fieldStart) quoted = true;
      fieldStart = false;
    }
  }
  return record;
}

function decode(bytes, file) {
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let text;
  try {
    text = decoder.decode(bytes);
  } catch {
    const offset = invalidUtf8Offset(bytes);
    let prefix = decoder.decode(bytes.subarray(0, offset));
    if (prefix.startsWith('\uFEFF')) prefix = prefix.slice(1);
    fail(file, prefixRecord(prefix), 'INVALID_UTF8', `包含非法 UTF-8，首个非法字节位于第 ${offset + 1} 字节；请另存为 UTF-8 CSV。`);
  }
  // Keep any further BOM characters: they are part of the actual field value.
  return text.startsWith('\uFEFF') ? text.slice(1) : text;
}

export function parseCsvBytes(input, { name = 'input.csv', side = '旧文件' } = {}) {
  const file = { name, side };
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  if (!(bytes instanceof Uint8Array)) {
    fail(file, 1, 'INVALID_BYTES', '输入必须是 Uint8Array 或 ArrayBuffer。');
  }
  if (bytes.byteLength > LIMITS.bytes) {
    fail(file, 1, 'BYTE_LIMIT', `文件为 ${bytes.byteLength} 字节，超过每文件 ${LIMITS.bytes} 字节（2 MiB）上限；尚未解析数据。`);
  }

  const text = decode(bytes, file);
  if (text.length === 0) fail(file, 1, 'MISSING_HEADER', '文件为空，缺少表头。');

  let columns = null;
  const rows = [];
  let fields = [];
  let field = '';
  let state = 'start';
  let pending = false;
  const recordNumber = () => columns === null ? 1 : rows.length + 2;

  function finishField() {
    fields.push(field);
    field = '';
    state = 'start';
    const maximum = columns === null ? LIMITS.columns : columns.length;
    if (fields.length > maximum) {
      const code = columns === null ? 'COLUMN_LIMIT' : 'COLUMN_COUNT';
      const message = columns === null
        ? `表头超过 ${LIMITS.columns} 列上限。`
        : `本记录至少有 ${fields.length} 列，表头要求 ${columns.length} 列。`;
      fail(file, recordNumber(), code, message);
    }
  }

  function finishRecord() {
    finishField();
    const record = recordNumber();
    if (columns === null) {
      const seen = new Map();
      for (let i = 0; i < fields.length; i += 1) {
        const column = fields[i];
        if (column.trim() === '') fail(file, 1, 'EMPTY_HEADER', `第 ${i + 1} 列列名为空或全为空白。`);
        if (seen.has(column)) {
          fail(file, 1, 'DUPLICATE_HEADER', `列名 ${JSON.stringify(column)} 重复，首次位于第 ${seen.get(column) + 1} 列，冲突位于第 ${i + 1} 列。`);
        }
        seen.set(column, i);
      }
      columns = fields;
    } else {
      if (fields.length !== columns.length) {
        fail(file, record, 'COLUMN_COUNT', `本记录有 ${fields.length} 列，表头要求 ${columns.length} 列。`);
      }
      if (rows.length + 1 > LIMITS.rows) {
        fail(file, record, 'ROW_LIMIT', `数据记录超过每文件 ${LIMITS.rows} 条上限（表头不计）。`);
      }
      if ((rows.length + 1) * columns.length > LIMITS.cells) {
        fail(file, record, 'CELL_LIMIT', `数据单元格超过每文件 ${LIMITS.cells} 个上限（表头不计）。`);
      }
      rows.push(fields);
    }
    fields = [];
    pending = false;
  }

  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];
    pending = true;
    if (character === '\0') fail(file, recordNumber(), 'NUL_CHARACTER', '不接受 NUL 字符。');
    if (character === '\r' && text[i + 1] !== '\n') {
      fail(file, recordNumber(), 'LONE_CR', '存在孤立 CR；换行只能使用 LF 或 CRLF，包括引号字段内部。');
    }

    if (state === 'quoted') {
      if (character === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          state = 'closed';
        }
      } else if (character === '\r') {
        field += '\r\n';
        i += 1;
      } else {
        field += character;
      }
    } else if (character === ',') {
      finishField();
    } else if (character === '\n' || character === '\r') {
      finishRecord();
      if (character === '\r') i += 1;
    } else if (state === 'closed') {
      fail(file, recordNumber(), 'AFTER_QUOTE', '闭引号后只能接逗号、记录分隔符或文件结束，不能有其他字符或空格。');
    } else if (character === '"') {
      if (state !== 'start') fail(file, recordNumber(), 'BARE_QUOTE', '未加引号的字段中出现裸双引号。');
      state = 'quoted';
    } else {
      field += character;
      state = 'bare';
    }
  }

  if (state === 'quoted') fail(file, recordNumber(), 'UNCLOSED_QUOTE', '双引号字段未闭合。');
  if (pending) finishRecord();
  return { name, side, columns, rows };
}

function indexRows(table, keyIndex) {
  const indexed = new Map();
  for (let i = 0; i < table.rows.length; i += 1) {
    const row = table.rows[i];
    const key = row[keyIndex];
    const record = i + 2;
    if (key.trim() === '') fail(table, record, 'EMPTY_KEY', `唯一键列 ${JSON.stringify(table.columns[keyIndex])} 的值为空或全为空白。`);
    if (indexed.has(key)) {
      const firstRecord = indexed.get(key).record;
      fail(table, record, 'DUPLICATE_KEY', `唯一键 ${JSON.stringify(key)} 重复；首次位于逻辑记录 ${firstRecord}，冲突位于逻辑记录 ${record}。`, { firstRecord });
    }
    indexed.set(key, { values: row, record });
  }
  return indexed;
}

export function compareTables(before, after, key) {
  if (before.columns.length !== after.columns.length) {
    fail(after, 1, 'SCHEMA_MISMATCH', `表头与${before.side}「${before.name}」的逻辑记录 1 不一致：旧文件 ${before.columns.length} 列，新文件 ${after.columns.length} 列；不支持补列或列映射。`);
  }
  for (let i = 0; i < before.columns.length; i += 1) {
    if (before.columns[i] !== after.columns[i]) {
      fail(after, 1, 'SCHEMA_MISMATCH', `第 ${i + 1} 列与${before.side}「${before.name}」的逻辑记录 1 不一致：旧列名 ${JSON.stringify(before.columns[i])}，新列名 ${JSON.stringify(after.columns[i])}；列名及顺序必须完全一致。`);
    }
  }
  const keyIndex = before.columns.indexOf(key);
  if (keyIndex === -1) fail(before, 1, 'INVALID_KEY', '请明确选择一个现有列作为唯一键。');

  // Validate both complete inputs before producing any comparison result.
  const oldRows = indexRows(before, keyIndex);
  const newRows = indexRows(after, keyIndex);
  const added = [];
  const deleted = [];
  const modified = [];
  const unchanged = [];

  for (const [rowKey, oldEntry] of oldRows) {
    const oldValues = oldEntry.values;
    if (!newRows.has(rowKey)) {
      deleted.push({ key: rowKey, values: [...oldValues] });
      continue;
    }
    const newValues = newRows.get(rowKey).values;
    const changes = [];
    for (let i = 0; i < before.columns.length; i += 1) {
      if (i !== keyIndex && oldValues[i] !== newValues[i]) {
        changes.push({ column: before.columns[i], before: oldValues[i], after: newValues[i] });
      }
    }
    if (changes.length > 0) {
      modified.push({ key: rowKey, before: [...oldValues], after: [...newValues], changes });
    } else {
      unchanged.push({ key: rowKey, values: [...oldValues] });
    }
  }
  for (const [rowKey, entry] of newRows) {
    if (!oldRows.has(rowKey)) added.push({ key: rowKey, values: [...entry.values] });
  }

  return {
    version: '1.0',
    key,
    columns: [...before.columns],
    inputs: {
      before: { name: before.name, rows: before.rows.length },
      after: { name: after.name, rows: after.rows.length },
    },
    counts: { added: added.length, deleted: deleted.length, modified: modified.length, unchanged: unchanged.length },
    added,
    deleted,
    modified,
    unchanged,
  };
}

export function serializeReport(result) {
  const { unchanged, ...report } = result;
  return JSON.stringify(report, null, 2);
}
