import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';


async function step(page, name) {
  const ids = { '房间档案': 'profile', '方案与成本': 'plan', '试验记录': 'trial', '搬迁与交接': 'handoff' };
  await page.locator(`[data-tab="${ids[name]}"]`).click();
}

async function samplePlan(page, name = '构造测试房间') {
  await page.getByRole('button', { name: '填入示例', exact: true }).click();
  await page.getByLabel('房间名称', { exact: true }).fill(name);
  await page.getByRole('button', { name: /生成适配方案/ }).click();
  await step(page, '方案与成本');
}

async function selectLabel(page, label, pattern) {
  const field = page.getByRole('combobox', { name: label, exact: true });
  await expect(field).toBeVisible();
  const labels = await field.locator('option').allTextContents();
  const matching = labels.find(value => pattern.test(value));
  expect(matching, `${label}应提供可识别的选项`).toBeTruthy();
  await field.selectOption({ label: matching });
}

async function addObservation(page, stage, temperature, note) {
  await step(page, '试验记录');
  const date = page.getByLabel('记录日期', { exact: true });
  const value = stage === 'before' ? '2026-09-20' : '2026-09-21';
  await date.fill(await date.getAttribute('type') === 'datetime-local' ? `${value}T16:00` : value);
  await selectLabel(page, '阶段', stage === 'before' ? /改善前|试验前|基线|改造前/ : /改善后|试验后|改造后/);
  await page.getByLabel('空气温度（℃）', { exact: true }).fill(String(temperature));
  await page.getByLabel('相对湿度（%）', { exact: true }).fill('50');
  const comfort = page.getByRole('combobox', { name: '体感评分', exact: true });
  await expect(comfort).toBeVisible();
  if (await comfort.evaluate(element => element.tagName) === 'SELECT') {
    const options = await comfort.locator('option').allTextContents();
    await comfort.selectOption({ label: options.find(value => /中性|舒适/.test(value)) || options.at(-1) });
  } else {
    await comfort.fill(stage === 'before' ? '2' : '4');
  }
  await page.getByLabel('室外温度（℃）', { exact: true }).fill('30');
  await page.getByLabel('辐射温度（℃）', { exact: true }).fill(String(temperature + 1));
  await page.getByLabel('记录备注', { exact: true }).fill(note);
  await page.getByRole('button', { name: '添加记录', exact: true }).click();
}

async function download(page, label) {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: label, exact: true }).click();
  const file = await event;
  const contents = await readFile(await file.path(), 'utf8');
  return { contents, filename: file.suggestedFilename() };
}

test.beforeEach(async ({ page }) => {
  page.roomErrors = [];
  page.on('pageerror', error => page.roomErrors.push(error.message));
  await page.goto('/');
});

test.afterEach(async ({ page }) => {
  expect(page.roomErrors, '核心流程不能产生未捕获的浏览器脚本错误').toEqual([]);
});

test('构造档案完成方案、前后记录和交接导出', async ({ page }) => {
  await samplePlan(page);
  await page.getByRole('button', { name: '采用此方案', exact: true }).first().click();
  const check = page.locator('[data-check]').first();
  await check.check();
  const checkedText = (await check.locator('..').innerText()).trim();
  await addObservation(page, 'before', 29, '构造数据：改善前');
  await addObservation(page, 'after', 28, '构造数据：改善后');
  await addObservation(page, 'before', 29, '构造数据：改善前第二次');
  await addObservation(page, 'after', 28, '构造数据：改善后第二次');
  await expect(page.getByText('构造数据：改善前', { exact: true })).toBeVisible();
  await expect(page.getByText('构造数据：改善后', { exact: true })).toBeVisible();
  await expect(page.locator('body')).toContainText(/不能.*因果|不.*因果|不能.*证明|不代表.*效果|无法.*证明/);
  await step(page, '搬迁与交接');
  const handoff = await download(page, '导出交接单');
  expect(handoff.contents).toContain('构造测试房间');
  expect(handoff.contents).toContain('构造数据：改善前');
  expect(handoff.contents).toContain('搬迁');
  expect(handoff.contents).toContain('构造数据：改善后');
  expect(handoff.contents).toContain(`- [x] ${checkedText}`);
});

test('刷新保留档案与观察记录', async ({ page }) => {
  await samplePlan(page, '刷新恢复测试');
  await addObservation(page, 'before', 27, '刷新后仍存在的记录');
  await page.reload();
  await step(page, '房间档案');
  await expect(page.getByLabel('房间名称', { exact: true })).toHaveValue('刷新恢复测试');
  await step(page, '试验记录');
  await expect(page.getByText('刷新后仍存在的记录', { exact: true })).toBeVisible();
});

test('编辑完整成本后重新核算并持久保存', async ({ page }) => {
  await samplePlan(page, '成本核算构造档案');
  await page.getByRole('button', { name: '采用此方案', exact: true }).first().click();
  const fields = [
    ['材料与税费（元）', '100'], ['配送与税运（元）', '20'],
    ['工具与安装（元）', '30'], ['使用能耗（元）', '40'],
    ['返工与恢复（元）', '50'], ['搬迁适配（元）', '60'],
  ];
  for (const [label, value] of fields) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole('button', { name: '更新成本', exact: true }).click();
  await expect(page.locator('.cost-total')).toContainText('300');
  await page.reload();
  await step(page, '方案与成本');
  for (const [label, value] of fields) await expect(page.getByLabel(label, { exact: true })).toHaveValue(Number(value).toFixed(2));
  await expect(page.locator('.cost-total')).toContainText('300');
});

test('成本超预算撤销采用状态，恢复估算后可以重新采用', async ({ page }) => {
  await samplePlan(page);
  await page.locator('.candidate[data-id="existing"] [data-select]').click();
  await page.getByLabel('材料与税费（元）', { exact: true }).fill('10000');
  await page.getByRole('button', { name: '更新成本', exact: true }).click();
  await expect(page.locator('.candidate[data-id="existing"]')).toHaveClass(/excluded/);
  await expect(page.locator('.candidate.selected')).toHaveCount(0);
  await expect(page.locator('#message')).toContainText('超预算');
  await page.getByRole('button', { name: '恢复规划估算', exact: true }).click();
  await expect(page.locator('.candidate[data-id="existing"]')).toHaveClass(/eligible/);
  await page.locator('.candidate[data-id="existing"] [data-select]').click();
  await expect(page.locator('.candidate[data-id="existing"]')).toHaveClass(/selected/);
});

test('零预算和不胶粘权限排除不适用采购方案', async ({ page }) => {
  await page.getByRole('button', { name: '填入示例', exact: true }).click();
  await page.getByLabel('预算上限（元）', { exact: true }).fill('0');
  await page.getByRole('combobox', { name: '安装权限', exact: true }).selectOption('none');
  await page.getByRole('combobox', { name: '表面状态', exact: true }).selectOption('fragile');
  await page.getByRole('button', { name: /生成适配方案/ }).click();
  await step(page, '方案与成本');
  await expect(page.locator('.candidate.excluded')).toHaveCount(6);
  await expect(page.locator('.candidate.excluded').first()).toContainText(/预算/);
  await expect(page.locator('.candidate.excluded [data-select]')).toHaveCount(0);
  await expect(page.locator('body')).toContainText(/没有预算内|无.*预算|调整预算/);
  await step(page, '房间档案');
  await page.getByLabel('预算上限（元）', { exact: true }).fill('600');
  await page.getByRole('button', { name: /生成适配方案/ }).click();
  await step(page, '方案与成本');
  for (const id of ['seal', 'film', 'insert']) {
    await expect(page.locator(`.candidate[data-id="${id}"]`)).toHaveClass(/excluded/);
    await expect(page.locator(`.candidate[data-id="${id}"] [data-select]`)).toHaveCount(0);
  }
});

test('搬迁重新核对尺寸与权限并明确重新适配风险', async ({ page }) => {
  await samplePlan(page, '搬迁构造档案');
  await page.getByRole('button', { name: '采用此方案', exact: true }).last().click();
  await step(page, '搬迁与交接');
  await page.getByLabel('下一处窗宽（厘米）', { exact: true }).fill('300');
  await page.getByLabel('下一处窗高（厘米）', { exact: true }).fill('300');
  await page.getByRole('combobox', { name: '下一处安装权限', exact: true }).selectOption('none');
  await page.getByRole('combobox', { name: '下一处表面状态', exact: true }).selectOption('fragile');
  await page.getByRole('button', { name: '重新核对搬迁适配', exact: true }).click();
  await expect(page.locator('.move-result').last()).toContainText(/重新|不适|核实|无法|不足|复用|匹配/);
  const handoff = await download(page, '导出交接单');
  expect(handoff.contents).toContain('300');
});

test('JSON 导出、清空取消、清空确认与恢复保持记录', async ({ page }) => {
  await samplePlan(page, '备份恢复测试');
  await addObservation(page, 'before', 26, '恢复后应出现的记录');
  await step(page, '搬迁与交接');
  const backup = await download(page, '导出备份');
  expect(() => JSON.parse(backup.contents)).not.toThrow();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: '清空本机数据', exact: true }).click();
  await step(page, '房间档案');
  await expect(page.getByLabel('房间名称', { exact: true })).toHaveValue('备份恢复测试');
  await step(page, '搬迁与交接');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '清空本机数据', exact: true }).click();
  await step(page, '房间档案');
  await expect(page.getByLabel('房间名称', { exact: true })).not.toHaveValue('备份恢复测试');
  await step(page, '搬迁与交接');
  await page.getByLabel('恢复备份', { exact: true }).setInputFiles({
    name: 'synthetic-backup.json', mimeType: 'application/json', buffer: Buffer.from(backup.contents),
  });
  await expect(page.locator('#message')).toContainText('备份已恢复');
  await step(page, '房间档案');
  await expect(page.getByLabel('房间名称', { exact: true })).toHaveValue('备份恢复测试');
  await step(page, '试验记录');
  await expect(page.getByText('恢复后应出现的记录', { exact: true })).toBeVisible();
});

test('坏 JSON 和不支持备份不覆盖有效档案', async ({ page }) => {
  await samplePlan(page, '不能丢失的档案');
  await step(page, '搬迁与交接');
  for (const contents of ['{broken', '{"version":99999,"profile":{}}']) {
    await page.getByLabel('恢复备份', { exact: true }).setInputFiles({
      name: 'invalid-backup.json', mimeType: 'application/json', buffer: Buffer.from(contents),
    });
    await expect(page.locator('#message')).toContainText('恢复失败');
    await step(page, '房间档案');
    await expect(page.getByLabel('房间名称', { exact: true })).toHaveValue('不能丢失的档案');
    await step(page, '搬迁与交接');
  }
});

test('记录删除后不会在刷新中复活', async ({ page }) => {
  await samplePlan(page);
  await addObservation(page, 'before', 25, '应删除的构造记录');
  await page.getByRole('button', { name: '删除记录', exact: true }).first().click();
  await expect(page.getByText('应删除的构造记录', { exact: true })).toHaveCount(0);
  await page.reload();
  await step(page, '试验记录');
  await expect(page.getByText('应删除的构造记录', { exact: true })).toHaveCount(0);
});

test('房间名称与记录备注中的 HTML 仅作为文字', async ({ page }) => {
  const payload = '<img src=x onerror="window.__roomXss=1">';
  await samplePlan(page, payload);
  await expect(page.locator('.plan-meta').getByText(payload, { exact: true })).toBeVisible();
  await addObservation(page, 'before', 26, payload);
  await expect(page.locator('#records-body').getByText(payload, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__roomXss)).toBeUndefined();
  await expect(page.locator('img[onerror]')).toHaveCount(0);
  await page.reload();
  await step(page, '试验记录');
  await expect(page.locator('#records-body').getByText(payload, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__roomXss)).toBeUndefined();
});

test('手机完整流程无页面横向溢出并保存实际截图', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await samplePlan(page, '手机构造档案');
  const screenshots = path.join(process.cwd(), '.auto-company/visual');
  await mkdir(screenshots, { recursive: true });
  for (const name of ['房间档案', '方案与成本', '试验记录', '搬迁与交接']) {
    await step(page, name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${name}无横向溢出`).toBe(true);
  }
  await expect(page.getByRole('button', { name: '清空本机数据', exact: true })).toBeVisible();
  const backup = await download(page, '导出备份');
  expect(JSON.parse(backup.contents).profile.name).toBe('手机构造档案');
  await step(page, '方案与成本');
  await page.screenshot({ path: path.join(screenshots, 'mobile-synthetic.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.screenshot({ path: path.join(screenshots, 'desktop-synthetic.png'), fullPage: true });
});

test('键盘可达主要输入与提交按钮，错误输入可修正', async ({ page }) => {
  await page.getByRole('button', { name: '填入示例', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('房间名称', { exact: true }).focus();
  await expect(page.getByLabel('房间名称', { exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('combobox', { name: '改善目标', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByLabel('房间名称', { exact: true })).toBeFocused();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('键盘构造档案');
  await page.getByLabel('窗宽（厘米）', { exact: true }).fill('-1');
  await page.getByRole('button', { name: /生成适配方案/ }).click();
  expect(await page.getByLabel('窗宽（厘米）', { exact: true }).evaluate(element => element.validity.valid)).toBe(false);
  await page.getByLabel('窗宽（厘米）', { exact: true }).fill('120');
  await page.getByRole('button', { name: /生成适配方案/ }).focus();
  await page.keyboard.press('Enter');
  await step(page, '方案与成本');
  await expect(page.getByRole('button', { name: '采用此方案', exact: true }).first()).toBeVisible();
});
