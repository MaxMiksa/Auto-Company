import test from 'node:test';
import assert from 'node:assert/strict';
import { findMenus, generatePlan, planToText } from '../engine.js';

const base = { menuId: 'tomato-tofu', servingsA: 1, servingsB: 1, flavorA: 'mild', flavorB: 'chili', vegetarian: false, exclusions: [], maxMinutes: 90 };
const ingredientKey = item => `${item.group}:${item.id}:${item.unit}`;

const waterVariants = [
  { label: '原鸡肉', vegetarian: false, exclusions: [], protein: 'chicken' },
  { label: '整桌素食豆腐', vegetarian: true, exclusions: [], protein: 'tofu' },
  { label: '素食且排除大豆鹰嘴豆', vegetarian: true, exclusions: ['soy'], protein: 'chickpea' },
];
const waterServings = [[1, 1], [2, 1], [2, 2], [4, 1], [4, 2]];

function assertMainWater(plan, label) {
  const waterRows = plan.ingredients.filter(item => item.name === '主菜用水');
  assert.equal(waterRows.length, 1, `${label} 采购清单只有一行主菜用水`);
  assert.equal(waterRows[0].unit, '毫升');
  assert.equal(waterRows[0].quantity, 60 * plan.totalServings, `${label} 主菜用水按每份60毫升采购`);
  const batches = plan.steps.filter(step => step.title.startsWith('共享主菜：'));
  assert.equal(batches.length, Math.ceil(plan.totalServings / 2), `${label} 每批最多2份`);
  let instructedWater = 0;
  batches.forEach((step, index) => {
    const servings = Math.min(2, plan.totalServings - index * 2);
    assert.equal(step.title, `共享主菜：第${index + 1}/${batches.length}批`);
    assert.match(step.detail, new RegExp(`第${index + 1}批做${servings}份：`));
    assert.ok(step.detail.includes(`各占总量的${servings}/${plan.totalServings}。`));
    // 同时检查新量化句与旧的第二次加水句，不能仅数新句是否出现。
    const actions = step.detail.split(/[。；！？]/).filter(sentence => /主菜(?:用)?水/.test(sentence) && /加|下|倒|注|补/.test(sentence));
    assert.equal(actions.length, 1, `${label} 第${index + 1}批应只有一个加水动作：${step.detail}`);
    assert.equal((actions[0].match(/主菜(?:用)?水/g) || []).length, 1, `${label} 同一句也不能重复加水`);
    const amount = actions[0].match(/主菜(?:用)?水[（(](\d+(?:\.\d+)?)毫升[）)]/);
    assert.ok(amount, `${label} 实际加水动作需写明本批毫升数`);
    assert.equal(Number(amount[1]), 60 * servings, `${label} 第${index + 1}批水量与份数一致`);
    instructedWater += Number(amount[1]);
  });
  assert.equal(instructedWater, waterRows[0].quantity, `${label} 所有批次实际加水量之和等于采购量`);
}

test('至少六套整餐均提供采购量、共享备料、分盘和可执行的口味步骤', () => {
  const menus = findMenus(base);
  assert.ok(menus.length >= 6);
  assert.equal(new Set(menus.map(menu => menu.id)).size, menus.length);
  for (const menu of menus) {
    const plan = generatePlan({ ...base, menuId: menu.id });
    assert.ok(plan.dishes.length >= 3, `${menu.id} 应同时提供主食、蛋白和蔬菜`);
    assert.ok(plan.ingredients.length >= 5);
    assert.equal(new Set(plan.ingredients.map(item => item.id)).size, plan.ingredients.length, '采购勾选每行需独立稳定标识');
    for (const item of plan.ingredients) {
      assert.ok(item.id && item.ingredientId && item.name && item.unit && item.group);
      assert.ok(Number.isFinite(item.quantity) && item.quantity > 0);
    }
    assert.ok(plan.steps.length >= 9);
    assert.equal(new Set(plan.steps.map(step => step.id)).size, plan.steps.length);
    for (const step of plan.steps) assert.ok(step.title && step.detail && step.detail.length >= 10);
    assert.ok(plan.steps.some(step => step.phase === 'prepare'));
    assert.ok(plan.steps.some(step => step.phase === 'split'));
    assert.ok(plan.steps.some(step => step.phase === 'finish'));
    assert.match(plan.steps.map(step => step.detail).join('\n'), /A组/);
    assert.match(plan.steps.map(step => step.detail).join('\n'), /B组/);
  }
});

test('从两份到六份采购量线性缩放，两组口味按各自份数缩放', () => {
  const small = generatePlan({ ...base, flavorA: 'garlic', flavorB: 'chili' });
  const large = generatePlan({ ...base, servingsA: 4, servingsB: 2, flavorA: 'garlic', flavorB: 'chili' });
  const amounts = new Map(small.ingredients.map(item => [ingredientKey(item), item.quantity]));
  assert.equal(large.ingredients.length, small.ingredients.length);
  for (const item of large.ingredients) {
    const factor = item.group === '共享基础' ? 3 : item.group === 'A组最后调味' ? 4 : 2;
    assert.ok(Math.abs(item.quantity - amounts.get(ingredientKey(item)) * factor) < 0.001, ingredientKey(item));
  }
  assert.equal(large.groups.find(group => group.id === 'A').servings, 4);
  assert.equal(large.groups.find(group => group.id === 'B').servings, 2);
  const details = large.steps.map(step => step.detail).join('\n');
  assert.match(details, /分批|每锅|每批/);
  assert.match(details, /A组/);
  assert.match(details, /B组/);
  assert.ok(findMenus({ ...base, servingsA: 4, servingsB: 2 })[0].minutes > findMenus(base)[0].minutes);
});

test('每一种口味只在指定组采购调味料，清淡与另一组独立', () => {
  for (const flavor of ['mild', 'chili', 'garlic']) {
    const plan = generatePlan({ ...base, flavorA: 'mild', flavorB: flavor });
    assert.equal(plan.groups[0].flavorId, 'mild');
    assert.equal(plan.groups[1].flavorId, flavor);
    const aSeasoning = plan.ingredients.filter(item => item.group === 'A组最后调味').map(item => item.id).join(' ');
    assert.doesNotMatch(aSeasoning, /chili|garlic/);
    if (flavor !== 'mild') {
      assert.ok(plan.ingredients.some(item => item.group === 'B组最后调味' && item.id.includes(flavor)));
    }
    assert.match(plan.steps.map(step => step.detail).join('\n'), /干净|清洁|独立/);
  }
  const sameFlavor = generatePlan({ ...base, flavorA: 'garlic', flavorB: 'garlic' });
  assert.equal(new Set(sameFlavor.ingredients.map(item => item.id)).size, sameFlavor.ingredients.length);
  const garlicRows = sameFlavor.ingredients.filter(item => item.ingredientId.includes('garlic'));
  assert.ok(garlicRows.some(item => item.group === 'A组最后调味'));
  assert.ok(garlicRows.some(item => item.group === 'B组最后调味'));
});

test('肉类整餐切换素食后采购、菜名和执行步骤都采用植物蛋白', () => {
  for (const menuId of ['carrot-chicken', 'corn-chicken']) {
    const plan = generatePlan({ ...base, menuId, vegetarian: true });
    assert.ok(plan.ingredients.some(item => /tofu|chickpea/.test(item.id)));
    assert.ok(!plan.ingredients.some(item => /chicken/.test(item.id)));
    assert.doesNotMatch(plan.dishes.join(' '), /鸡肉|鸡胸/);
    assert.doesNotMatch(plan.steps.map(step => `${step.title} ${step.detail}`).join('\n'), /鸡肉|鸡胸/);
  }
});

for (const variant of waterVariants) {
  test(`玉米${variant.label}的2至6份方案与文字导出每批只加一次足量主菜水`, () => {
    for (const [servingsA, servingsB] of waterServings) {
      const plan = generatePlan({ ...base, menuId: 'corn-chicken', servingsA, servingsB, vegetarian: variant.vegetarian, exclusions: variant.exclusions });
      const label = `${variant.label} A${servingsA}/B${servingsB}`;
      assert.ok(plan.ingredients.some(item => item.ingredientId === variant.protein), `${label} 应采用预期蛋白`);
      assertMainWater(plan, label);
      const text = planToText(plan);
      assert.match(text, new RegExp(`^- 主菜用水 ${60 * plan.totalServings}毫升$`, 'm'));
      const lines = text.split('\n');
      const exportedSteps = lines.flatMap((line, index) => {
        const heading = line.match(/^\d+\. (.+)（约\d+(?:\.\d+)?分钟）$/);
        return heading ? [{ title: heading[1], detail: lines[index + 1] }] : [];
      });
      assert.deepEqual(exportedSteps, plan.steps.map(({ title, detail }) => ({ title, detail })), `${label} 导出实际步骤不能遗漏或另加动作`);
      assertMainWater({ ...plan, steps: exportedSteps }, `${label} 文字导出`);
    }
  });
}

test('全部现有菜单及素食、排大豆替换的主菜水量均与采购一致', () => {
  for (const variant of waterVariants) {
    const options = { ...base, vegetarian: variant.vegetarian, exclusions: variant.exclusions };
    const menus = findMenus(options);
    assert.ok(menus.length >= 6, '原整餐范围不能因加水修复缩小');
    for (const menu of menus) {
      const plan = generatePlan({ ...options, menuId: menu.id });
      assertMainWater(plan, `${menu.id} ${variant.label}`);
    }
  }
});

test('排除项作用于实际采购食材及替代食材，不能保留原蛋白或蔬菜', () => {
  const cases = [
    ['tomato-tofu', ['soy', 'tomato'], /tofu|tomato/],
    ['potato-egg', ['egg'], /egg/],
    ['mushroom-tofu', ['mushroom'], /mushroom/],
    ['carrot-chicken', ['chicken'], /chicken/],
  ];
  for (const [menuId, exclusions, forbidden] of cases) {
    const plan = generatePlan({ ...base, menuId, exclusions });
    assert.ok(plan.substitutions.length > 0);
    for (const item of plan.ingredients) assert.doesNotMatch(item.id, forbidden);
    assertMainWater(plan, `${menuId} 排除${exclusions.join('、')}后的替换`);
  }
  const vegetarianSoyFree = generatePlan({ ...base, menuId: 'corn-chicken', vegetarian: true, exclusions: ['soy'] });
  assert.ok(vegetarianSoyFree.ingredients.some(item => /chickpea/.test(item.id)));
  assert.ok(!vegetarianSoyFree.ingredients.some(item => /tofu|chicken/.test(item.id)));
  assert.throws(() => generatePlan({ ...base, menuId: 'tomato-tofu', exclusions: ['soy', 'chickpea'] }), /.+/);
});

test('口味冲突和时间不足明确失败，无匹配菜单不自动退回不合要求的方案', () => {
  assert.deepEqual(findMenus({ ...base, maxMinutes: 20 }), []);
  assert.throws(() => generatePlan({ ...base, maxMinutes: 20 }), /时间|分钟/);
  assert.throws(() => generatePlan({ ...base, flavorA: 'garlic', exclusions: ['garlic'] }), /蒜|口味|排除/);
  assert.throws(() => generatePlan({ ...base, flavorB: 'chili', exclusions: ['chili'] }), /辣|口味|排除/);
  const menus = findMenus({ ...base, servingsA: 4, servingsB: 2, maxMinutes: 60 });
  for (const menu of menus) assert.ok(menu.minutes <= 60);
});

test('份数、类型、未知标识和重复排除拒绝非法输入', () => {
  const invalid = [
    { servingsA: 0 }, { servingsA: 5 }, { servingsB: 0 }, { servingsB: 5 },
    { servingsA: 4, servingsB: 3 }, { servingsA: 1.5 }, { servingsB: '2' },
    { flavorA: 'unknown' }, { menuId: 'unknown' }, { vegetarian: 'true' },
    { exclusions: ['unknown'] }, { exclusions: ['egg', 'egg'] }, { exclusions: 'egg' },
    { maxMinutes: 19 }, { maxMinutes: 91 }, { maxMinutes: NaN }, { mystery: true },
  ];
  for (const change of invalid) assert.throws(() => generatePlan({ ...base, ...change }), /.+/, JSON.stringify(change));
  for (const [servingsA, servingsB] of [[1, 4], [4, 1], [2, 4], [3, 3]]) {
    const plan = generatePlan({ ...base, servingsA, servingsB });
    assert.equal(plan.groups.reduce((total, group) => total + group.servings, 0), servingsA + servingsB);
  }
});

test('文本导出包含每种采购食材与所有执行步骤，足够离线照做', () => {
  const plan = generatePlan({ ...base, servingsA: 2, servingsB: 1, flavorA: 'mild', flavorB: 'garlic' });
  const text = planToText(plan);
  assert.equal(typeof text, 'string');
  assert.match(text, /采购|购物/);
  assert.match(text, /步骤|烹饪/);
  assert.match(text, /A组/);
  assert.match(text, /B组/);
  for (const item of plan.ingredients) {
    assert.ok(text.includes(item.name), `缺少食材 ${item.name}`);
    assert.ok(text.includes(item.unit), `缺少单位 ${item.unit}`);
  }
  for (const step of plan.steps) assert.ok(text.includes(step.detail), `缺少步骤 ${step.id}`);
});
