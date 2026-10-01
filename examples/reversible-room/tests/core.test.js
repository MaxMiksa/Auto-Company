import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILE, validateProfile, buildPlan, validateRecord, summarizeTrial, validateBackup, exportMarkdown } from '../core.js';

const profile = changes => ({ ...DEFAULT_PROFILE, ...changes });
const record = changes => ({ id: 'sample-1', date: '2026-10-01', phase: 'before', temperature: 29, humidity: 60, sensation: 2, outdoor: 30, radiation: null, note: '', ...changes });
const backup = changes => ({ version: 1, profile: profile(), selectedId: 'existing', records: [], costOverrides: {}, checklist: {}, notes: '', ...changes });
const candidate = (plan, id) => plan.candidates.find(item => item.id === id);

test('合成默认资料有效，目标和有限数字受到校验', () => {
  assert.equal(validateProfile(profile()).ok, true);
  for (const changes of [{ width: 0 }, { height: 401 }, { budget: -1 }, { hours: 25 }, { electricity: Infinity }, { days: 1.5 }, { moveCount: 11 }, { goal: 'unknown' }, { escape: 'true' }, { name: '' }]) assert.equal(validateProfile(profile(changes)).ok, false);
});

test('下一房间尺寸成对填写，零预算和零电价有效', () => {
  assert.equal(validateProfile(profile({ nextWidth: 100 })).ok, false);
  assert.equal(validateProfile(profile({ nextWidth: 100, nextHeight: 120, budget: 0, electricity: 0 })).ok, true);
});

test('默认不采购基线被优先推荐；六种方案有恢复和搬迁信息', () => {
  const plan = buildPlan(profile());
  assert.equal(plan.blocked, false);
  assert.equal(plan.recommendedId, 'existing');
  assert.equal(plan.candidates.length, 6);
  for (const item of plan.candidates) {
    assert.ok(item.steps.length && item.rollback.length && item.move && item.reuse && item.evidence);
    assert.equal(item.cost.total, Math.round(['materials', 'delivery', 'installation', 'energy', 'rework', 'moving'].reduce((sum, key) => sum + item.cost[key], 0) * 100) / 100);
  }
});

test('逃生或主要通风用途待现场核实，保留已有物品与独立风扇', () => {
  for (const changes of [{ escape: true, ventilation: false }, { escape: false, ventilation: true }]) {
    const plan = buildPlan(profile({ ...changes, safetyConfirmed: false }));
    assert.equal(plan.blocked, false);
    assert.equal(plan.recommendedId, 'existing');
    assert.equal(candidate(plan, 'fan').status, 'eligible');
    assert.equal(candidate(plan, 'curtain').status, 'conditional');
    assert.equal(candidate(plan, 'film').status, 'excluded');
  }
});

test('普通窗不因非逃生或非主要通风用途而被屏蔽，密封仍须确认', () => {
  const plan = buildPlan(profile({ escape: false, ventilation: false, permission: 'adhesive', surface: 'sound', budget: 5000 }));
  assert.equal(plan.blocked, false);
  assert.equal(candidate(plan, 'curtain').status, 'eligible');
  assert.equal(candidate(plan, 'seal').status, 'conditional');
  assert.equal(candidate(plan, 'film').status, 'conditional');
});

test('霉变、过热和电气风险保留专业排查路径', () => {
  for (const risk of ['damp', 'hot', 'electrical']) {
    const plan = buildPlan(profile({ risk }));
    assert.equal(plan.blocked, true);
    assert.equal(plan.recommendedId, 'existing');
    assert.equal(candidate(plan, 'existing').cost.total, 0);
    assert.equal(candidate(plan, 'fan').status, 'excluded');
    assert.ok(plan.warnings.length > 1);
  }
});

test('未知玻璃须等待核实，零钻许可排除内窗，不以许可推定兼容', () => {
  const noPermission = buildPlan(profile({ budget: 10000 }));
  assert.equal(candidate(noPermission, 'film').status, 'excluded');
  assert.equal(candidate(noPermission, 'insert').status, 'excluded');
  const allowed = buildPlan(profile({ glass: 'double', permission: 'drill', surface: 'sound', budget: 10000 }));
  assert.equal(candidate(allowed, 'film').status, 'conditional');
  assert.equal(candidate(allowed, 'insert').status, 'conditional');
  assert.equal(allowed.recommendedId, 'existing');
  const unknownGlass = buildPlan(profile({ permission: 'adhesive', budget: 10000 }));
  assert.equal(candidate(unknownGlass, 'film').status, 'conditional');
});

test('预算不足排除定制内窗；脆弱表面排除粘贴密封', () => {
  const plan = buildPlan(profile({ permission: 'drill', surface: 'fragile', budget: 100 }));
  assert.equal(candidate(plan, 'insert').status, 'excluded');
  assert.equal(candidate(plan, 'seal').status, 'excluded');
});

test('寒冷和眩光目标不推荐风扇，普通窗膜不当作保暖方案', () => {
  for (const goal of ['cold', 'glare']) assert.equal(candidate(buildPlan(profile({ goal })), 'fan').status, 'excluded');
  assert.equal(candidate(buildPlan(profile({ goal: 'cold', permission: 'adhesive', glass: 'single', budget: 5000 })), 'film').status, 'excluded');
  const glare = buildPlan(profile({ goal: 'glare', permission: 'drill', surface: 'sound', safetyConfirmed: true, budget: 10000 }));
  assert.equal(candidate(glare, 'seal').status, 'excluded');
  assert.equal(candidate(glare, 'insert').status, 'excluded');
});

test('耗电和安装机会成本进入总成本，搬迁次数增加预留', () => {
  const one = candidate(buildPlan(profile({ hours: 8, days: 100, electricity: 1, laborRate: 40, moveCount: 1 })), 'fan');
  const two = candidate(buildPlan(profile({ hours: 8, days: 100, electricity: 1, laborRate: 40, moveCount: 2 })), 'fan');
  assert.equal(one.cost.energy, 28);
  assert.equal(one.cost.installation, 10);
  assert.ok(two.cost.moving > one.cost.moving);
});

test('用户覆盖各项费用后重算预算，不允许篡改合计', () => {
  const plan = buildPlan(profile({ budget: 100 }), { existing: { installation: 150, total: 0 } });
  assert.equal(candidate(plan, 'existing').cost.total, 150);
  assert.equal(candidate(plan, 'existing').status, 'excluded');
  assert.equal(buildPlan(profile(), { fan: { materials: -20, energy: NaN } }).blocked, true);
  assert.deepEqual(buildPlan(profile(), { fan: { materials: -20 } }).candidates, []);
});

test('确认现场通道与具体膜兼容后才放行，未知表面仍保持待核实', () => {
  const unconfirmed = buildPlan(profile({ permission: 'adhesive', glass: 'double', surface: 'sound', budget: 5000 }));
  assert.equal(candidate(unconfirmed, 'seal').status, 'conditional');
  assert.equal(candidate(unconfirmed, 'film').status, 'conditional');
  const confirmed = buildPlan(profile({ permission: 'adhesive', glass: 'double', surface: 'sound', safetyConfirmed: true, filmCompatible: true, budget: 5000 }));
  assert.equal(candidate(confirmed, 'seal').status, 'eligible');
  assert.equal(candidate(confirmed, 'film').status, 'eligible');
  assert.equal(confirmed.recommendedId, 'existing');
  assert.equal(candidate(buildPlan(profile({ permission: 'adhesive', surface: 'unknown', safetyConfirmed: true, budget: 5000 })), 'seal').status, 'conditional');
});

test('畸形资料无法形成执行计划', () => {
  const plan = buildPlan(profile({ width: NaN }));
  assert.equal(plan.blocked, true);
  assert.deepEqual(plan.candidates, []);
});

test('测量日期必须真实，体感整数和温湿度范围有效', () => {
  assert.equal(validateRecord(record()).ok, true);
  assert.equal(validateRecord(record({ date: '2026-02-30' })).ok, false);
  assert.equal(validateRecord(record({ date: '2024-02-29' })).ok, true);
  assert.equal(validateRecord(record({ date: '2026-10-01T14:30' })).ok, true);
  assert.equal(validateRecord(record({ date: '2026-02-30T14:30' })).ok, false);
  assert.equal(validateRecord(record({ date: '2026-10-01T24:01' })).ok, false);
  for (const changes of [{ sensation: 0.5 }, { humidity: 101 }, { temperature: Infinity }, { outdoor: -51 }, { radiation: 101 }, { phase: 'during' }, { note: 'x'.repeat(1001) }]) assert.equal(validateRecord(record(changes)).ok, false);
});

test('样本不足明确提醒，不把单条改善前后记录当作充分证据', () => {
  const result = summarizeTrial([record(), record({ id: 'sample-2', phase: 'after', sensation: 0 })]);
  assert.equal(result.status, 'insufficient');
  assert.equal(result.comparable, false);
});

function trial(changes = {}) {
  return [record({ id: 'before-1' }), record({ id: 'before-2', outdoor: 31 }), record({ id: 'after-1', phase: 'after', sensation: 0, temperature: 28, ...changes }), record({ id: 'after-2', phase: 'after', sensation: 1, temperature: 28, ...changes })];
}

test('条件相近只给方向性观察，并明确不能证明因果', () => {
  const result = summarizeTrial(trial());
  assert.equal(result.status, 'comparable');
  assert.equal(result.deltaDistance, -1.5);
  assert.equal(result.deltaTemperature, -1);
  assert.match(result.message, /不能证明因果/);
});

test('外温缺失或差异大时不可比，即使体感改善也不归因', () => {
  for (const changes of [{ outdoor: null }, { outdoor: 35 }]) {
    const result = summarizeTrial(trial(changes));
    assert.equal(result.status, 'incomparable');
    assert.equal(result.comparable, false);
  }
});

test('均值不能掩盖外温极端条件', () => {
  const records = trial();
  records[0].outdoor = 20; records[1].outdoor = 40;
  assert.equal(summarizeTrial(records).status, 'incomparable');
});

test('舒适观察比较每条体感到目标的距离，避免冷热相消', () => {
  const records = trial();
  records[0].sensation = -2; records[1].sensation = 2;
  records[2].sensation = -1; records[3].sensation = 1;
  assert.equal(summarizeTrial(records).deltaDistance, -1);
});

test('备份完整校验并清除未知字段，往返保留核心资料', () => {
  const checked = validateBackup(backup({ profile: { ...profile(), extra: 'ignore' }, extra: 'ignore', records: [record({ extra: 'ignore' })] }));
  assert.equal(checked.ok, true);
  assert.equal(checked.value.profile.extra, undefined);
  assert.equal(checked.value.extra, undefined);
  assert.equal(checked.value.records[0].extra, undefined);
  assert.equal(validateBackup(JSON.parse(JSON.stringify(checked.value))).ok, true);
});

test('新房独立校验与保存，旧房许可、费用和记录不沿用', () => {
  const old = profile({ permission: 'drill', glass: 'double', safetyConfirmed: true, filmCompatible: true });
  const next = profile({ name: '新房', width: 160, height: 180, permission: 'none', surface: 'unknown', safetyConfirmed: false, filmCompatible: false, glass: 'unknown' });
  const state = backup({ profile: old, relocation: next, records: [record()], costOverrides: { curtain: { materials: 999 } } });
  const checked = validateBackup(state);
  assert.equal(checked.ok, true);
  assert.equal(checked.value.relocation.permission, 'none');
  assert.equal(checked.value.profile.permission, 'drill');
  assert.equal(checked.value.records.length, 1);
  const text = exportMarkdown(state);
  assert.ok(text.includes('新房独立重评'));
  assert.ok(text.includes('待重新核实'));
  assert.equal(validateBackup(backup({ relocation: { ...next, width: 0 } })).ok, false);
});

test('备份拒绝错误版本、重复记录、错误费用和过大备注', () => {
  for (const changes of [{ version: 2 }, { records: [record(), record()] }, { records: [null] }, { costOverrides: { fan: { energy: -1 } } }, { costOverrides: { fan: { energy: 1000001 } } }, { notes: 'x'.repeat(4001) }, { selectedId: 'fake' }, { checklist: { a: 'yes' } }]) assert.equal(validateBackup(backup(changes)).ok, false);
});

test('备份上限与界面一致：500条记录、4000字备注和500字单次备注', () => {
  const records = Array.from({ length: 500 }, (_, index) => record({ id: `sample-${index}` }));
  assert.equal(validateBackup(backup({ records, notes: 'x'.repeat(4000) })).ok, true);
  assert.equal(validateBackup(backup({ records: [...records, record({ id: 'sample-extra' })] })).ok, false);
  assert.equal(validateRecord(record({ note: 'x'.repeat(500) })).ok, true);
  assert.equal(validateRecord(record({ note: 'x'.repeat(501) })).ok, false);
});

test('备份拒绝原型污染、循环和超大结构，且不污染全局', () => {
  const unsafe = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.equal(validateBackup({ ...backup(), ...unsafe }).ok, false);
  const cyclic = backup(); cyclic.self = cyclic;
  assert.equal(validateBackup(cyclic).ok, false);
  assert.equal(validateBackup(backup({ extra: 'x'.repeat(500001) })).ok, false);
  assert.equal({}.polluted, undefined);
});

test('完整中文报告包含预算、执行、恢复、搬迁和观察限制', () => {
  const text = exportMarkdown(backup({ records: trial(), notes: '请先测量再安装。' }));
  for (const expected of ['全周期方案比较', '安装工时成本', '撤回', '搬迁', '前后观察', '不能证明因果', '请先测量再安装']) assert.ok(text.includes(expected));
  assert.ok(!text.includes('undefined'));
});

test('导出保留已采用方案的勾选状态，包括界面附加两项', () => {
  const baseCount = buildPlan(profile()).checklist.length;
  const text = exportMarkdown(backup({ checklist: { 'existing:0': true, [`existing:${baseCount}`]: true, [`existing:${baseCount + 1}`]: true, 'fan:1': true } }));
  assert.match(text, /- \[x\] 已测量窗宽/);
  assert.match(text, /- \[x\] 试用后能正常开窗/);
  assert.match(text, /- \[x\] 体感未改善或变差时停止/);
  assert.match(text, /- \[ \] 通风、逃生和燃烧设备/);
});

test('报告转义用户 Markdown/HTML，排除方案在导出时提醒暂停执行', () => {
  const text = exportMarkdown(backup({ selectedId: 'film', notes: '<script>alert(1)</script> | **假保证**' }));
  assert.ok(!text.includes('<script>'));
  assert.ok(text.includes('&lt;script&gt;'));
  assert.ok(text.includes('已排除，暂停执行'));
});

test('无效备份不能导出可执行报告', () => {
  assert.throws(() => exportMarkdown(backup({ profile: profile({ width: 0 }) })), /无法导出/);
});
