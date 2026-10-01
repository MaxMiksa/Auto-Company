import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, audit, demoConfig, toCSV } from '../engine.js';

const clone = value => JSON.parse(JSON.stringify(value));
const table = (headers, rows) => ({ headers, rows });

// 不复用演示真值：这些采购验收数据使用独立列名与配置。
function purchaseMigration() {
  return {
    project: '采购客户迁移验收',
    scope: { complete: true, identity: true, rules: true, snapshot: true, relationships: true, note: '同一冻结时点；仅公司、订单及关联。' },
    objects: [
      { name: '公司', source: table(['公司编号', '名称', '联系邮箱', '建立日期'], [
        { 公司编号: '0007', 名称: ' 上海甲公司 ', 联系邮箱: 'FINANCE@EXAMPLE.TEST ', 建立日期: '2024/02/29' },
        { 公司编号: 'B-2', 名称: '南京乙公司', 联系邮箱: 'b@example.test', 建立日期: '2025-01-30' }
      ]), target: table(['legacy_ref', 'new_id', 'title', 'mail', 'created'], [
        { legacy_ref: 'B-2', new_id: '982', title: '南京乙公司', mail: 'b@example.test', created: '2025/01/30' },
        { legacy_ref: '0007', new_id: '981', title: '上海甲公司', mail: 'finance@example.test', created: '2024-02-29' }
      ]), key: { source: '公司编号', target: 'legacy_ref' }, fields: [
        { source: '名称', target: 'title', type: 'text' },
        { source: '联系邮箱', target: 'mail', type: 'email' },
        { source: '建立日期', target: 'created', type: 'date' }
      ] },
      { name: '订单', source: table(['单号', '净额', '币种', '状态'], [
        { 单号: 'PO/甲', 净额: '100.20', 币种: 'CNY', 状态: '已批准' },
        { 单号: 'PO/乙', 净额: '150.40', 币种: 'CNY', 状态: '草稿' }
      ]), target: table(['origin_po', 'amount', 'currency', 'stage'], [
        { origin_po: 'PO/甲', amount: '100.2', currency: 'CNY', stage: 'approved' },
        { origin_po: 'PO/乙', amount: '150.400', currency: 'CNY', stage: 'draft' }
      ]), key: { source: '单号', target: 'origin_po' }, fields: [
        { source: '净额', target: 'amount', type: 'money' },
        { source: '状态', target: 'stage', type: 'text', map: { approved: '已批准', draft: '草稿' } }
      ], currency: { source: '币种', target: 'currency' } }
    ],
    relationships: [{ name: '公司订单', source: table(['customer_code', 'purchase_no'], [
      { customer_code: '0007', purchase_no: 'PO/甲' }, { customer_code: 'B-2', purchase_no: 'PO/乙' }
    ]), target: table(['old_customer', 'old_purchase'], [
      { old_customer: 'B-2', old_purchase: 'PO/乙' }, { old_customer: '0007', old_purchase: 'PO/甲' }
    ]), from: { object: '公司', source: 'customer_code', target: 'old_customer' }, to: { object: '订单', source: 'purchase_no', target: 'old_purchase' } }]
  };
}

function expectFailure(mutator, kind) {
  const config = purchaseMigration();
  mutator(config);
  const result = audit(config);
  assert.equal(result.status, 'fail', JSON.stringify(result));
  assert.ok(result.issues.some(issue => issue.kind === kind), `${kind}: ${JSON.stringify(result)}`);
  assert.equal(result.summary.issues, result.issues.length);
  return result;
}

test('独立业务列名、重编号、行重排、合法日期/邮件/状态/金额转换可通过', () => {
  const result = audit(purchaseMigration());
  assert.equal(result.status, 'pass', JSON.stringify(result));
  assert.equal(result.issues.length, 0);
  assert.equal(result.unknowns.length, 0);
  assert.equal(result.summary.sourceRows, 4);
  assert.equal(result.summary.targetRows, 4);
  assert.equal(result.project, '采购客户迁移验收');
});

const corruptions = [
  ['遗漏', c => c.objects[0].target.rows.pop(), 'missing-record'],
  ['重复记录', c => c.objects[0].target.rows.push(clone(c.objects[0].target.rows[0])), 'duplicate-key'],
  ['关联错挂且数量不变', c => { [c.relationships[0].target.rows[0].old_customer, c.relationships[0].target.rows[1].old_customer] = ['0007', 'B-2']; }, 'missing-relationship'],
  ['逐笔金额变化相抵且总额不变', c => { c.objects[1].target.rows[0].amount = '101.20'; c.objects[1].target.rows[1].amount = '149.40'; }, 'field-mismatch'],
  ['前导零身份被破坏', c => { c.objects[0].target.rows[1].legacy_ref = '7'; }, 'missing-record'],
  ['孤儿关联', c => { c.relationships[0].target.rows[0].old_customer = 'missing'; }, 'orphan-relationship'],
  ['状态不符', c => { c.objects[1].target.rows[0].stage = 'draft'; }, 'field-mismatch'],
  ['币种不符', c => { c.objects[1].target.rows[0].currency = 'USD'; }, 'currency-mismatch'],
  ['分以下精度不能舍入', c => { c.objects[1].target.rows[0].amount = '100.2001'; }, 'invalid-field']
];
for (const [name, mutate, kind] of corruptions) test(`原实验风险：${name}`, () => expectFailure(mutate, kind));

test('金额相抵仍分别列出两笔可复核差异', () => {
  const result = expectFailure(c => { c.objects[1].target.rows[0].amount = '101.2'; c.objects[1].target.rows[1].amount = '149.4'; }, 'field-mismatch');
  const differences = result.issues.filter(i => i.object === '订单' && i.kind === 'field-mismatch');
  assert.deepEqual(differences.map(i => i.key).sort(), ['PO/乙', 'PO/甲'].sort());
  assert.ok(differences.every(i => i.source !== i.target && i.message));
});

for (const [name, mutate] of [
  ['缺身份映射声明', c => { c.scope.identity = false; }],
  ['局部导出', c => { c.scope.complete = false; }],
  ['缺关联导出', c => { c.relationships[0].target = null; }],
  ['缺转换授权', c => { c.scope.rules = false; }],
  ['不同快照未确认', c => { c.scope.snapshot = false; }],
  ['关联范围未确认', c => { c.scope.relationships = false; }],
  ['缺所选字段列', c => { c.objects[0].target.headers = c.objects[0].target.headers.filter(x => x !== 'mail'); }],
  ['缺对象源表', c => { c.objects[0].source = null; }]
]) test(`缺证：${name}必须不可判定`, () => {
  const c = purchaseMigration(); mutate(c);
  const result = audit(c);
  assert.equal(result.status, 'unknown', JSON.stringify(result));
  assert.ok(result.unknowns.length > 0);
  assert.equal(result.summary.unknowns, result.unknowns.length);
});

test('局部导出与已知金额异常并存时保留两者', () => {
  const result = expectFailure(c => { c.scope.complete = false; c.objects[1].target.rows[0].amount = '999'; }, 'field-mismatch');
  assert.ok(result.unknowns.length > 0);
});
test('缺身份声明不得以数组位置或new_id猜测身份', () => {
  const c = purchaseMigration(); c.scope.identity = false;
  c.objects[0].target.rows[1].legacy_ref = 'somebody-else';
  const result = audit(c);
  assert.equal(result.status, 'unknown');
  assert.ok(!result.issues.some(i => ['missing-record', 'extra-record'].includes(i.kind)));
});

for (const [name, mutate, kind] of [
  ['重复关联', c => c.relationships[0].target.rows.push(clone(c.relationships[0].target.rows[0])), 'duplicate-relationship'],
  ['额外对象', c => c.objects[0].target.rows.push({ legacy_ref: 'extra', new_id: '999', title: '新增', mail: 'c@example.test', created: '2025-01-30' }), 'extra-record'],
  ['空key', c => { c.objects[0].source.rows[0].公司编号 = ''; }, 'empty-key'],
  ['只含空格的key', c => { c.objects[0].source.rows[0].公司编号 = '   '; }, 'empty-key'],
  ['非法金额字符串', c => { c.objects[1].target.rows[0].amount = '100abc'; }, 'invalid-field'],
  ['禁止科学计数法金额', c => { c.objects[1].target.rows[0].amount = '1e2'; }, 'invalid-field'],
  ['不存在的日历日期', c => { c.objects[0].target.rows[1].created = '2025-02-29'; }, 'invalid-field'],
  ['隐式滚动日期', c => { c.objects[0].target.rows[1].created = '2024-02-30'; }, 'invalid-field']
]) test(`边界：${name}`, () => expectFailure(mutate, kind));

test('相同非法金额不能因为文本一致而通过', () => expectFailure(c => {
  c.objects[1].source.rows[0].净额 = 'NaN'; c.objects[1].target.rows[0].amount = 'NaN';
}, 'invalid-field'));
test('两侧相同分以下金额仍违反默认两位精度', () => expectFailure(c => {
  c.objects[1].source.rows[0].净额 = '100.101'; c.objects[1].target.rows[0].amount = '100.101';
}, 'invalid-field'));
test('金额值映射不能掩盖目标原始精度违规', () => expectFailure(c => {
  c.objects[1].source.rows[0].净额 = '100.10'; c.objects[1].target.rows[0].amount = '100.101';
  c.objects[1].fields[0].map = { '100.101': '100.10' };
}, 'invalid-field'));
test('金额值映射不能把非法原值伪装成合法金额', () => expectFailure(c => {
  c.objects[1].source.rows[0].净额 = '100.10'; c.objects[1].target.rows[0].amount = 'INVALID';
  c.objects[1].fields[0].map = { INVALID: '100.10' };
}, 'invalid-field'));
test('显式四位金额精度允许保留更细单位', () => {
  const c = purchaseMigration(); c.objects[1].fields[0].precision = 4;
  c.objects[1].source.rows[0].净额 = '100.2001'; c.objects[1].target.rows[0].amount = '100.2001';
  assert.equal(audit(c).status, 'pass');
});
test('显式四位金额精度仍检测最小单位变化', () => expectFailure(c => {
  c.objects[1].fields[0].precision = 4;
  c.objects[1].source.rows[0].净额 = '100.2001'; c.objects[1].target.rows[0].amount = '100.2002';
}, 'field-mismatch'));
test('相同非法日期不能因为文本一致而通过', () => expectFailure(c => {
  c.objects[0].source.rows[0].建立日期 = '2025-02-29'; c.objects[0].target.rows[1].created = '2025-02-29';
}, 'invalid-field'));
test('未映射的状态值保留为差异', () => expectFailure(c => { c.objects[1].target.rows[0].stage = 'unknown-status'; }, 'field-mismatch'));
test('空表仍验证配置，非法值映射不能通过', () => {
  const c = purchaseMigration();
  c.objects = [c.objects[0]]; c.objects[0].source.rows = []; c.objects[0].target.rows = [];
  c.objects[0].fields[0].map = { some: 42 }; c.relationships = []; c.scope.relationships = false;
  const result = audit(c);
  assert.equal(result.status, 'unknown');
  assert.ok(result.unknowns.some(message => message.includes('映射')));
});
test('超出浮点安全整数的金额保持精确差异', () => expectFailure(c => {
  c.objects[1].source.rows[0].净额 = '9007199254740993.20'; c.objects[1].target.rows[0].amount = '9007199254740992.20';
}, 'field-mismatch'));
test('有符号金额与末尾零的精确规范化', () => {
  const c = purchaseMigration(); c.objects[1].source.rows[0].净额 = '-00100.200'; c.objects[1].target.rows[0].amount = '-100.2';
  assert.equal(audit(c).status, 'pass');
});

function withRelationshipRoles() {
  const c = purchaseMigration(); const relation = c.relationships[0];
  relation.source.headers.push('业务角色'); relation.target.headers.push('role');
  relation.source.rows[0].业务角色 = '采购方'; relation.source.rows[1].业务角色 = '审批方';
  relation.target.rows[0].role = 'approver'; relation.target.rows[1].role = 'buyer';
  relation.role = { source: '业务角色', target: 'role', map: { buyer: '采购方', approver: '审批方' } };
  return c;
}
test('授权关联角色转换通过且同端点不同角色不重复', () => {
  const c = withRelationshipRoles();
  c.relationships[0].source.rows.push({ customer_code: '0007', purchase_no: 'PO/甲', 业务角色: '审批方' });
  c.relationships[0].target.rows.push({ old_customer: '0007', old_purchase: 'PO/甲', role: 'approver' });
  assert.equal(audit(c).status, 'pass');
});
test('关联角色交换不能被端点数量相同掩盖', () => {
  const c = withRelationshipRoles();
  c.relationships[0].target.rows[0].role = 'buyer'; c.relationships[0].target.rows[1].role = 'approver';
  const result = audit(c);
  assert.equal(result.status, 'fail');
  assert.ok(result.issues.some(i => i.kind === 'missing-relationship'));
});
test('关联角色列缺失必须不可判定', () => {
  const c = withRelationshipRoles(); c.relationships[0].target.headers.pop();
  assert.equal(audit(c).status, 'unknown');
});
test('角色缺证时不能把同端点不同角色误报为重复关系', () => {
  const c = withRelationshipRoles(); const r = c.relationships[0];
  r.source.rows.push({ customer_code: '0007', purchase_no: 'PO/甲', 业务角色: '审批方' });
  r.target.rows.push({ old_customer: '0007', old_purchase: 'PO/甲', role: 'approver' });
  c.scope.rules = false;
  const result = audit(c);
  assert.equal(result.status, 'unknown', JSON.stringify(result));
  assert.ok(!result.issues.some(i => i.kind === 'duplicate-relationship'));
});

test('CSV 保留BOM后的中文、前导零、引号、逗号与quoted newline', () => {
  const parsed = parseCSV('\uFEFF编号,名称,备注\r\n0007,"甲,乙","第一行\r\n第二行 ""引号"""\r\n');
  assert.deepEqual(parsed.headers, ['编号', '名称', '备注']);
  assert.deepEqual(parsed.rows, [{ 编号: '0007', 名称: '甲,乙', 备注: '第一行\r\n第二行 "引号"' }]);
});
test('CSV 空单元格与末尾空列保留', () => {
  assert.deepEqual(parseCSV('编号,名称,备注\nA,,\n').rows, [{ 编号: 'A', 名称: '', 备注: '' }]);
});
test('CSV 拒绝20,000行以上输入并给出拆分提示', () => {
  const csv = 'id\n' + Array.from({ length: 20001 }, (_, i) => `R${i}`).join('\n');
  assert.throws(() => parseCSV(csv), /20,000/);
});
test('CSV 拒绝5MB以上输入并给出拆分提示', () => {
  assert.throws(() => parseCSV('id\n' + '甲'.repeat(2 * 1024 * 1024)), /5 MB/);
});
test('CSV 拒绝空字符而非带着无效证据继续', () => {
  assert.throws(() => parseCSV('id,name\n1,甲\0乙'), /空字符/);
});
for (const [name, csv] of [
  ['空CSV', ''], ['空表头', 'id,,name\n1,x,a'], ['重复表头', 'id,id\n1,2'],
  ['缺列坏行', 'id,name\n1'], ['多列坏行', 'id,name\n1,a,b'],
  ['未闭合引号', 'id,name\n1,"oops'], ['未转义引号', 'id,name\n1,a"b'],
  ['引号后非法字符', 'id,name\n1,"a"b']
]) test(`CSV 拒绝${name}并提供中文错误`, () => {
  assert.throws(() => parseCSV(csv), error => /[\u3400-\u9fff]/u.test(error.message));
});
test('CSV __proto__表头不会污染原型或吞掉证据', () => {
  const parsed = parseCSV('id,__proto__,constructor\n1,原样证据,构造字段');
  assert.equal(parsed.rows[0].__proto__, '原样证据');
  assert.equal(parsed.rows[0].constructor, '构造字段');
  assert.equal({}.polluted, undefined);
});
test('CSV 真实文本没有被作为HTML执行或清洗丢失', () => {
  const html = '<img src=x onerror="alert(1)">';
  const parsed = parseCSV('id,note\n1,"<img src=x onerror=""alert(1)"">"');
  assert.equal(parsed.rows[0].note, html);
});

test('证据CSV使用BOM并转义引号、逗号和换行', () => {
  const output = toCSV({ issues: [{ object: '公司', kind: 'field-mismatch', key: '0007', field: '说明', source: '甲,"乙"\n丙', target: '丁', message: '核对' }], unknowns: [] });
  assert.equal(output[0], '\uFEFF');
  assert.equal(parseCSV(output).rows[0].源值, '甲,"乙"\n丙');
  assert.equal(parseCSV(output).rows[0].身份或关联, '0007');
});
test('证据CSV防止公式前缀与空白绕过', () => {
  const values = ['=1+1', '+cmd', '-1+2', '@SUM(A1)', '  =HYPERLINK("x")', '\t+1', '正常中文'];
  const output = toCSV({ issues: values.map(source => ({ object: '公司', kind: 'field-mismatch', key: 'K', field: '值', source, target: '', message: '' })), unknowns: [] });
  const rows = parseCSV(output).rows;
  for (let i = 0; i < values.length - 1; i++) assert.equal(rows[i].源值, `'${values[i]}`);
  assert.equal(rows.at(-1).源值, '正常中文');
});
test('证据CSV包含不可判定范围而非只导出异常', () => {
  const output = toCSV({ issues: [], unknowns: ['尚未确认快照'] });
  const rows = parseCSV(output).rows;
  assert.equal(rows[0].异常类型, 'unknown');
  assert.equal(rows[0].说明, '尚未确认快照');
});
test('审计不修改用户输入，并且结果可以JSON导出', () => {
  const c = purchaseMigration(); const original = clone(c); const report = audit(c);
  assert.deepEqual(c, original);
  assert.deepEqual(JSON.parse(JSON.stringify(report)).issues, report.issues);
});
test('演示的合法、异常和缺证路径有真实可变输入', () => {
  for (const [variant, expected] of [['valid', 'pass'], ['broken', 'fail'], ['unknown', 'unknown']]) {
    const c = demoConfig(variant);
    assert.ok(c.objects.length > 0);
    assert.equal(audit(c).status, expected, variant);
  }
});
