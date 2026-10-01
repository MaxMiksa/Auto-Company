import assert from 'node:assert/strict';
import test from 'node:test';
import { CsvError, LIMITS, compareTables, parseCsvBytes, serializeReport } from '../src/core.js';

const encoder = new TextEncoder();
const parse = (text, options = {}) => parseCsvBytes(encoder.encode(text), options);
const before = (text) => parse(text, { name: 'before.csv', side: '旧文件' });
const after = (text) => parse(text, { name: 'after.csv', side: '新文件' });
const compare = (oldCsv, newCsv, key = 'id') => compareTables(before(oldCsv), after(newCsv), key);

function expectCsvError(action, fragments = [], details = {}) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof CsvError, `应给出 CsvError，实际：${error}`);
    for (const fragment of fragments) {
      assert.ok(error.message.includes(String(fragment)), `错误消息缺少 ${fragment}：${error.message}`);
    }
    for (const [key, expected] of Object.entries(details)) {
      assert.equal(error[key], expected, `错误属性 ${key} 应准确定位`);
    }
    return true;
  });
}

function assertConservation(result) {
  const { added, deleted, modified, unchanged } = result.counts;
  assert.equal(result.inputs.before.rows, deleted + modified + unchanged);
  assert.equal(result.inputs.after.rows, added + modified + unchanged);
  for (const kind of ['added', 'deleted', 'modified', 'unchanged']) {
    assert.equal(result[kind].length, result.counts[kind]);
  }
}

function csvField(value) {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function csvOf(columns, rows, separator = '\n') {
  return [columns, ...rows].map((row) => row.map(csvField).join(',')).join(separator);
}

test('基准：四类互斥、守恒，修改字段带完整前后值', () => {
  const result = compare('id,name,quantity\nA,苹果,01\nB,梨,2\nC,桃,3', 'id,name,quantity\nB,梨,02\nC,桃,3\nD,杏,4');
  assert.deepEqual(result.counts, { added: 1, deleted: 1, modified: 1, unchanged: 1 });
  assert.deepEqual(result.added, [{ key: 'D', values: ['D', '杏', '4'] }]);
  assert.deepEqual(result.deleted, [{ key: 'A', values: ['A', '苹果', '01'] }]);
  assert.deepEqual(result.modified, [{
    key: 'B', before: ['B', '梨', '2'], after: ['B', '梨', '02'],
    changes: [{ column: 'quantity', before: '2', after: '02' }],
  }]);
  assert.deepEqual(result.unchanged, [{ key: 'C', values: ['C', '桃', '3'] }]);
  assertConservation(result);
});

test('仅重排记录与改变合法引号包装，不产生变化', () => {
  const result = compare('id,value\nA,first\nB,second\nC,third', '"id",value\n"C","third"\nA,"first"\nB,second\n');
  assert.deepEqual(result.counts, { added: 0, deleted: 0, modified: 0, unchanged: 3 });
  assert.deepEqual(result.unchanged.map(({ key }) => key).sort(), ['A', 'B', 'C']);
  assertConservation(result);
});

test('空数据集、单侧空数据与只有键列均可比较', async (t) => {
  for (const [title, oldCsv, newCsv, expected] of [
    ['双方空', 'id,value', 'id,value\n', { added: 0, deleted: 0, modified: 0, unchanged: 0 }],
    ['旧侧空', 'id,value', 'id,value\nA,\nB,b', { added: 2, deleted: 0, modified: 0, unchanged: 0 }],
    ['新侧空', 'id,value\nA,a\nB,', 'id,value', { added: 0, deleted: 2, modified: 0, unchanged: 0 }],
    ['只有键列', 'id\nA\nB', 'id\nB\nC', { added: 1, deleted: 1, modified: 0, unchanged: 1 }],
  ]) {
    await t.test(title, () => {
      const result = compare(oldCsv, newCsv);
      assert.deepEqual(result.counts, expected);
      assertConservation(result);
    });
  }
});

test('精确字符串：前导零、空格、大小写、Unicode 归一化与空串参与变化', () => {
  const columns = ['id', 'value'];
  const oldRows = [['A', '001'], ['B', ' a'], ['C', 'APPLE'], ['D', 'é'], ['E', '中文😀'], ['F', '']];
  const newRows = [['A', '1'], ['B', 'a'], ['C', 'apple'], ['D', 'e\u0301'], ['E', '中文😀'], ['F', ' ']];
  const result = compare(csvOf(columns, oldRows), csvOf(columns, newRows));
  assert.deepEqual(result.counts, { added: 0, deleted: 0, modified: 5, unchanged: 1 });
  assert.deepEqual(result.modified.map(({ changes }) => changes[0]), [
    { column: 'value', before: '001', after: '1' },
    { column: 'value', before: ' a', after: 'a' },
    { column: 'value', before: 'APPLE', after: 'apple' },
    { column: 'value', before: 'é', after: 'e\u0301' },
    { column: 'value', before: '', after: ' ' },
  ]);
  assertConservation(result);
});

test('键变更产生新增和删除；有效键不 trim，不做 Unicode 归一化', () => {
  const result = compare('id,value\n001,a\n A,b\né,c', 'id,value\n1,a\nA,b\ne\u0301,c');
  assert.deepEqual(result.counts, { added: 3, deleted: 3, modified: 0, unchanged: 0 });
  const exactKeys = compare('id,value\n A,x\nA,y', 'id,value\nA,y\n A,x');
  assert.equal(exactKeys.counts.unchanged, 2);
  assertConservation(result);
});

test('可以明确选取非首列为键，修改列名称和值完整', () => {
  const result = compare('value,id,other\nold,A,x', 'value,id,other\nnew,A,y', 'id');
  assert.deepEqual(result.modified[0].changes, [
    { column: 'value', before: 'old', after: 'new' },
    { column: 'other', before: 'x', after: 'y' },
  ]);
});

test('合法 CSV：BOM、CRLF、逗号、转义引号、多行及末尾空字段', () => {
  const table = parse('\uFEFFid,note,tail\r\n001,"中文, ""quoted""\r\n第二行",\r\n002,"LF\ninside",x\r\n');
  assert.deepEqual(table.columns, ['id', 'note', 'tail']);
  assert.deepEqual(table.rows, [['001', '中文, "quoted"\r\n第二行', ''], ['002', 'LF\ninside', 'x']]);
  assert.equal(table.name, 'input.csv');
  assert.equal(table.side, '旧文件');
});

test('ArrayBuffer 与 Uint8Array 子视图均只解析实际字节范围', () => {
  const bytes = encoder.encode('id,value\nA,ok');
  assert.deepEqual(parseCsvBytes(bytes.buffer).rows, [['A', 'ok']]);
  const padded = new Uint8Array(bytes.length + 6);
  padded.fill(0);
  padded.set(bytes, 3);
  assert.deepEqual(parseCsvBytes(padded.subarray(3, 3 + bytes.length)).rows, [['A', 'ok']]);
});

test('文件开头仅剥离一个 BOM，字段内部 BOM 保留', () => {
  assert.deepEqual(parse('\uFEFF\uFEFFid,value\nA,\uFEFFvalue').columns, ['\uFEFFid', 'value']);
  assert.equal(parse('id,value\nA,\uFEFFvalue').rows[0][1], '\uFEFFvalue');
});

test('字段内 LF 与 CRLF 逐字符保留并比较为修改', () => {
  const result = compare('id,value\nA,"a\nb"', 'id,value\r\nA,"a\r\nb"');
  assert.deepEqual(result.modified[0].changes, [{ column: 'value', before: 'a\nb', after: 'a\r\nb' }]);
});

test('空文件、非法引号、列宽不齐、NUL 与孤立 CR 均拒绝', async (t) => {
  const invalid = [
    ['空文件', ''], ['只有 BOM', '\uFEFF'], ['无表头空行', '\n'],
    ['引号未闭合', 'id,value\nA,"unfinished'],
    ['字段中裸引号', 'id,value\nA,b"c'],
    ['引号前空格', 'id,value\nA, "x"'],
    ['闭引号后字母', 'id,value\nA,"x"y'],
    ['闭引号后空格', 'id,value\nA,"x" '],
    ['数据缺列', 'id,value\nA'], ['数据多列', 'id,value\nA,b,c'],
    ['额外空白记录不可忽略', 'id,value\nA,b\n\n'],
    ['NUL', 'id,value\nA,\0'], ['引号内 NUL', 'id,value\nA,"\0"'],
    ['表头内孤立 CR', 'id\r,value\nA,b'], ['记录间孤立 CR', 'id,value\rA,b'],
    ['字段内孤立 CR', 'id,value\nA,b\rc'], ['引号内孤立 CR', 'id,value\nA,"b\rc"'],
    ['末尾孤立 CR', 'id,value\nA,b\r'],
  ];
  for (const [title, value] of invalid) {
    await t.test(title, () => expectCsvError(() => before(value), ['旧文件', 'before.csv']));
  }
});

test('非法 UTF-8 拒绝；合法替换字符 U+FFFD 本身允许', async (t) => {
  for (const bytes of [
    [0xc3, 0x28], [0xff], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xe2, 0x82],
  ]) {
    await t.test(bytes.map((byte) => byte.toString(16)).join(' '), () => {
      const validPrefix = encoder.encode('id,value\nA,');
      const input = new Uint8Array(validPrefix.length + bytes.length);
      input.set(validPrefix);
      input.set(bytes, validPrefix.length);
      expectCsvError(() => parseCsvBytes(input, { name: 'utf8.csv', side: '新文件' }), ['新文件', 'utf8.csv']);
    });
  }
  assert.equal(parse('id,value\nA,�').rows[0][1], '�');
});

test('非法 UTF-8 字节在跨行字段及后续记录内均正确定位逻辑记录', () => {
  for (const [prefix, expectedRecord] of [
    ['id,value\nA,"first\nsecond', 2],
    ['id,value\r\nA,"first\r\nsecond"\r\nB,', 3],
  ]) {
    const encodedPrefix = encoder.encode(prefix);
    const input = new Uint8Array(encodedPrefix.length + 1);
    input.set(encodedPrefix);
    input[input.length - 1] = 0xff;
    expectCsvError(() => parseCsvBytes(input, { name: 'bad.csv', side: '新文件' }), ['新文件', 'bad.csv'], { record: expectedRecord });
  }
});

test('表头为空、全空白、精确重复均拒绝；有效名称保留空格', async (t) => {
  for (const input of ['id,\nA,b', ',value\nA,b', 'id, \t\nA,b', 'id,\u00a0\nA,b', 'id,id\nA,b', 'id,"id"\nA,b']) {
    await t.test(JSON.stringify(input), () => expectCsvError(() => before(input), ['旧文件', '1']));
  }
  const table = parse('id, name,name\nA,x,y');
  assert.deepEqual(table.columns, ['id', ' name', 'name']);
});

test('两侧列名、列数或顺序不同均阻断', async (t) => {
  for (const current of ['id,other\nA,x', 'value,id\nx,A', 'id\nA', 'id,value,extra\nA,x,y']) {
    await t.test(current.split('\n')[0], () => expectCsvError(() => compare('id,value\nA,x', current)));
  }
});

test('不存在或未明确选取的键均阻断', () => {
  const oldTable = before('id,value\nA,x');
  const newTable = after('id,value\nA,x');
  for (const key of ['missing', '', undefined, null]) {
    expectCsvError(() => compareTables(oldTable, newTable, key));
  }
});

test('两侧重复键均指明文件与首次、冲突逻辑记录，跨行字段不改变记录号', async (t) => {
  const duplicate = 'id,value\nA,"first\nsecond"\nB,ok\nA,duplicate';
  const good = 'id,value\nA,one\nB,two';
  await t.test('旧侧', () => expectCsvError(() => compare(duplicate, good), ['旧文件', 'before.csv', '2', '4'], { record: 4, firstRecord: 2, side: '旧文件' }));
  await t.test('新侧', () => expectCsvError(() => compare(good, duplicate), ['新文件', 'after.csv', '2', '4'], { record: 4, firstRecord: 2, side: '新文件' }));
});

test('两侧空键及 ECMAScript 全空白键均阻断并定位逻辑记录', async (t) => {
  for (const key of ['', ' ', '\t', '\u00a0', '\uFEFF', '\u2003', '\n', '\r\n']) {
    const bad = csvOf(['id', 'value'], [['A', 'first\nline'], [key, 'bad']]);
    for (const side of ['旧文件', '新文件']) {
      await t.test(`${side} ${JSON.stringify(key)}`, () => {
        expectCsvError(() => side === '旧文件' ? compare(bad, 'id,value') : compare('id,value', bad), [side, '3'], { record: 3, side });
      });
    }
  }
});

test('单列文件的额外空记录按空键失败，末尾一个分隔符不增加记录', () => {
  assert.equal(parse('id\nA\n').rows.length, 1);
  const table = before('id\nA\n\n');
  assert.equal(table.rows.length, 2);
  expectCsvError(() => compareTables(table, after('id\nA'), 'id'), ['旧文件', '3'], { record: 3 });
});

test('CSV 错误定位使用逻辑记录号，包含换行的字段不增加记录号', () => {
  expectCsvError(() => before('id,value\nA,"a\nb\nc"\nB,too,many'), ['旧文件', 'before.csv', '3'], { record: 3 });
});

test('资源合同常量固定', () => {
  assert.deepEqual(LIMITS, { bytes: 2_097_152, rows: 10_000, columns: 100, cells: 200_000 });
});

test('字节上限：恰好 2 MiB 合法，多一字节拒绝且按 UTF-8 字节计', () => {
  const prefix = 'id\n';
  const exact = prefix + 'x'.repeat(2_097_152 - prefix.length);
  assert.equal(encoder.encode(exact).length, 2_097_152);
  assert.equal(parse(exact).rows[0][0].length, 2_097_149);
  expectCsvError(() => parse(exact + 'x'));
  const multibyte = 'id\n' + '中'.repeat(Math.floor((2_097_152 - 3) / 3) + 1);
  assert.ok(multibyte.length < 2_097_152);
  assert.ok(encoder.encode(multibyte).length > 2_097_152);
  expectCsvError(() => parse(multibyte));
});

test('记录上限：10,000 数据记录合法，10,001 拒绝，表头不计入', () => {
  const exact = ['id', ...Array.from({ length: 10_000 }, (_, index) => `k${index}`)].join('\n');
  const table = parse(exact + '\n');
  assert.equal(table.rows.length, 10_000);
  expectCsvError(() => parse(exact + '\nextra'));
});

test('列上限：100 列合法，101 列即使没有数据也拒绝', () => {
  const columns = Array.from({ length: 100 }, (_, index) => `column${index}`);
  assert.equal(parse(columns.join(',')).columns.length, 100);
  expectCsvError(() => parse([...columns, 'oneMore'].join(',')));
});

test('单元格上限：200,000 数据单元格合法，超限独立于记录/列/字节限制', () => {
  const columns = Array.from({ length: 100 }, (_, index) => `c${index}`);
  const rows = Array.from({ length: 2000 }, (_, index) => [`key${index}`, ...Array(99).fill('x')]);
  const exact = csvOf(columns, rows);
  assert.ok(encoder.encode(exact).length < 2_097_152);
  assert.equal(parse(exact).rows.length, 2000);
  expectCsvError(() => parse(exact + '\n' + ['extra', ...Array(99).fill('x')].join(',')));
});

test('JSON 往返保留全部变化和原字符串；未变只输出计数', () => {
  const columns = ['id', 'value', 'note'];
  const oldRows = [['same', '不变', ''], ['001', '=SUM(A1:A2)', '"旧"\n多行'], ['gone', '', 'delete']];
  const newRows = [['same', '不变', ''], ['001', '+1', '"新"\r\n多行'], ['new', '@cmd', '<img onerror=alert(1)>']];
  const result = compare(csvOf(columns, oldRows), csvOf(columns, newRows));
  const report = JSON.parse(serializeReport(result));
  const { unchanged, ...expected } = result;
  assert.deepEqual(report, expected);
  assert.equal(report.version, '1.0');
  assert.equal(report.key, 'id');
  assert.deepEqual(report.columns, columns);
  assert.deepEqual(report.inputs, { before: { name: 'before.csv', rows: 3 }, after: { name: 'after.csv', rows: 3 } });
  assert.equal(report.counts.unchanged, 1);
  assert.equal(Object.hasOwn(report, 'unchanged'), false);
  assert.equal(report.modified[0].before[1], '=SUM(A1:A2)');
  assert.equal(report.modified[0].after[1], '+1');
  assert.equal(report.deleted[0].values[1], '');
  assert.equal(report.added[0].values[2], '<img onerror=alert(1)>');
  assert.equal(result.unchanged, unchanged);
});

test('超过界面一页规模的变化完整进入 JSON', () => {
  const additions = Array.from({ length: 237 }, (_, index) => [`ID-${index}`, `原值 ${index}`]);
  const report = JSON.parse(serializeReport(compare('id,value', csvOf(['id', 'value'], additions))));
  assert.equal(report.counts.added, 237);
  assert.equal(report.added.length, 237);
  assert.deepEqual(report.added.map(({ values }) => values), additions);
});

test('prototype 名称作为表头、键和值时仍正确分类和导出', () => {
  const result = compare('__proto__,constructor,toString\n__proto__,first,one\nconstructor,second,two\ntoString,third,three',
    '__proto__,constructor,toString\n__proto__,updated,one\nconstructor,second,two\nvalueOf,fourth,four', '__proto__');
  assert.deepEqual(result.counts, { added: 1, deleted: 1, modified: 1, unchanged: 1 });
  assert.deepEqual(result.modified[0].changes, [{ column: 'constructor', before: 'first', after: 'updated' }]);
  assert.equal(JSON.parse(serializeReport(result)).modified[0].key, '__proto__');
  assertConservation(result);
});

test('比较与导出不会改写解析结果或原始字符串', () => {
  const oldTable = before('id,value\n001,  原值  ');
  const newTable = after('id,value\n001,新值');
  const snapshots = [structuredClone(oldTable), structuredClone(newTable)];
  for (const table of [oldTable, newTable]) {
    Object.freeze(table.columns);
    table.rows.forEach(Object.freeze);
    Object.freeze(table.rows);
    Object.freeze(table);
  }
  serializeReport(compareTables(oldTable, newTable, 'id'));
  assert.deepEqual([oldTable, newTable], snapshots);
});
