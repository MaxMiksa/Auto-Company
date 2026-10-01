import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';


function tripFixture() {
  return {
    title: '成都两人恢复手账', city: '成都', date: '2026-10-18',
    start: '10:00', end: '17:00', origin: '住宿处',
    people: [
      { name: '小林', maxActive: 80, restMinutes: 25, needsSeat: true, needsQuiet: true, needsAlone: false, avoidDim: true },
      { name: '小陈', maxActive: 100, restMinutes: 15, needsSeat: false, needsQuiet: false, needsAlone: false, avoidDim: false },
    ],
    activities: [
      { id: 'walk', name: '河边观察', duration: 40, travelMinutes: 10, required: true, indoor: false, opens: '09:00', closes: '18:00', source: '构造任务，非真实核验', notes: '看水边的树' },
      { id: 'museum', name: '室内展览', duration: 50, travelMinutes: 10, required: true, indoor: true, opens: '10:00', closes: '16:00', source: '构造任务，非真实核验', notes: '分段参观' },
      { id: 'bookshop', name: '书店选书', duration: 20, travelMinutes: 5, required: false, indoor: true, opens: '09:00', closes: '18:00', notes: '' },
    ],
    recovery: { name: '主恢复室', travelMinutes: 5, seat: 'yes', alone: 'yes', light: 'normal', noise: 'quiet', source: '构造任务，仅用于测试', verifiedAt: '2026-10-01', notes: '到达后再次检查条件' },
    backupRecovery: { name: '备用休息室', travelMinutes: 5, seat: 'yes', alone: 'yes', light: 'normal', noise: 'quiet', source: '构造任务，仅用于测试', verifiedAt: '2026-10-01', notes: '' },
    exit: { name: '住宿处', travelMinutes: 10, notes: '乘坐已核对的回程交通；构造输入' },
  };
}

async function importTrip(page, trip = tripFixture(), extra = {}) {
  await page.locator('#import').setInputFiles({
    name: 'test-trip.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'rest-rhythm', version: 1, trip, ...extra })),
  });
  await expect(page.getByLabel('手账名称', { exact: true })).toHaveValue(trip.title);
}

async function generate(page) {
  await page.getByRole('button', { name: '编排我的一天' }).click();
  await expect(page.locator('#plan-output')).toBeVisible();
}

async function download(page, buttonName) {
  const promise = page.waitForEvent('download');
  await page.getByRole('button', { name: buttonName, exact: true }).click();
  const item = await promise;
  const path = await item.path();
  return { name: item.suggestedFilename(), path, text: await readFile(path, 'utf8') };
}

async function confirmReplacement(page, action, accept = true) {
  const dialog = page.waitForEvent('dialog');
  const result = action();
  const prompt = await dialog;
  expect(prompt.type()).toBe('confirm');
  if (accept) await prompt.accept();
  else await prompt.dismiss();
  await result;
}

const activeSession = { completedIds: ['walk'], now: '11:00', delayMinutes: 20, rain: true, unavailableRecovery: true, earlyEnd: '15:00' };

async function adjustCompletedTrip(page) {
  await page.getByLabel('完成：河边观察', { exact: true }).check();
  await page.getByLabel('当前时间（可留空）', { exact: true }).fill(activeSession.now);
  await page.getByLabel('额外延误 / 分钟', { exact: true }).fill(String(activeSession.delayMinutes));
  await page.getByLabel('雨天，略过室外活动', { exact: true }).check();
  await page.getByLabel('主恢复点不可用', { exact: true }).check();
  await page.getByLabel('提前返回时间（可留空）', { exact: true }).fill(activeSession.earlyEnd);
  await page.getByRole('button', { name: '重排剩余安排', exact: true }).click();
}

async function expectActiveSession(page, completedName = '河边观察') {
  await expect(page.getByLabel(`完成：${completedName}`, { exact: true })).toBeChecked();
  await expect(page.getByLabel('当前时间（可留空）', { exact: true })).toHaveValue(activeSession.now);
  await expect(page.getByLabel('额外延误 / 分钟', { exact: true })).toHaveValue(String(activeSession.delayMinutes));
  await expect(page.getByLabel('雨天，略过室外活动', { exact: true })).toBeChecked();
  await expect(page.getByLabel('主恢复点不可用', { exact: true })).toBeChecked();
  await expect(page.getByLabel('提前返回时间（可留空）', { exact: true })).toHaveValue(activeSession.earlyEnd);
}

async function expectStalePlan(page) {
  await expect(page.locator('#plan-output')).toContainText('旧时间轴已失效');
  await expect(page.locator('#plan-output .step')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#people .input-card')).toHaveCount(1);
});

test('自填旅行、动态编辑与核心编排形成实际时间轴', async ({ page }) => {
  await page.getByRole('button', { name: '编排我的一天' }).click();
  await expect(page.locator('#errors')).toBeVisible();
  await expect(page.locator('#errors')).toContainText('城市');
  await importTrip(page);
  await page.getByLabel('城市', { exact: true }).fill('武汉');
  await page.getByLabel('旅行日期', { exact: true }).fill('2026-11-03');
  await page.getByLabel('手账名称', { exact: true }).fill('武汉两人探索');
  await page.locator('#people .input-card').first().getByLabel('连续活动上限 / 分钟', { exact: true }).fill('80');
  await page.locator('#people .input-card').first().getByLabel('每次恢复至少 / 分钟', { exact: true }).fill('25');
  await page.locator('#activities .input-card').first().getByLabel('活动时长 / 分钟', { exact: true }).fill('45');
  await page.getByRole('button', { name: '添加同行人' }).click();
  await expect(page.locator('#people .input-card')).toHaveCount(3);
  await page.locator('#people .input-card').last().getByRole('button').click();
  await expect(page.locator('#people .input-card')).toHaveCount(2);
  await page.getByRole('button', { name: '添加活动', exact: false }).click();
  await expect(page.locator('#activities .input-card')).toHaveCount(4);
  await page.locator('#activities .input-card').last().getByRole('button').click();
  await expect(page.locator('#activities .input-card')).toHaveCount(3);
  await generate(page);
  await expect(page.locator('#plan-title')).toContainText('武汉两人探索');
  await expect(page.locator('#plan-output')).toContainText('河边观察');
  await expect(page.locator('#plan-output')).toContainText('主恢复室');
  await expect(page.locator('#plan-output')).toContainText('返回住宿处');
  await expect(page.locator('#plan-output')).toContainText('不作实时保证');
  await expect(page.locator('#plan-output')).toContainText('连续活动 ≤ 80 分钟 · 恢复 ≥ 25 分钟');
  await expect(page.locator('#plan-output .step.activity')).not.toHaveCount(0);
  await expect(page.locator('#plan-output .step.recovery')).not.toHaveCount(0);
});

test('载入示例后完成首项，普通备注编辑与真实导出恢复保留十一点现场约束', async ({ page }) => {
  await page.getByRole('button', { name: '载入构造示例', exact: true }).click();
  await generate(page);
  const firstActivity = await page.locator('#plan-output .step.activity h3').first().textContent();
  await page.getByLabel(`完成：${firstActivity}`, { exact: true }).check();
  await page.locator('#now').fill('11:00');
  await page.locator('#recovery summary').click();
  await page.locator('#recovery').getByLabel('核验备注', { exact: true }).fill('仅更新普通备注，保留已完成活动与现场时间');
  await generate(page);
  await expect(page.getByLabel(`完成：${firstActivity}`, { exact: true })).toBeChecked();
  await expect(page.locator('#now')).toHaveValue('11:00');
  await expect(page.locator('#plan-output .step').first().locator('time')).toHaveText('11:00');
  await expect(page.locator('#plan-output .step.activity h3')).not.toContainText([firstActivity]);
  const backup = await download(page, '导出JSON备份');
  const data = JSON.parse(backup.text);
  expect(data.session.now).toBe('11:00');
  expect(data.session.completedIds).toEqual(['sample-minerals']);
  expect(data.trip.recovery.notes).toContain('仅更新普通备注');
  await page.getByLabel('手账名称', { exact: true }).fill('临时改名后恢复');
  await confirmReplacement(page, () => page.locator('#import').setInputFiles(backup.path));
  await expect(page.getByLabel(`完成：${firstActivity}`, { exact: true })).toBeChecked();
  await expect(page.locator('#plan-output .step').first().locator('time')).toHaveText('11:00');
});

test('已完成、延误、下雨、恢复点失效和提前返回可重排且不会重复叠加', async ({ page }) => {
  await importTrip(page);
  await generate(page);
  await page.getByLabel('完成：河边观察', { exact: true }).check();
  await page.getByLabel('当前时间（可留空）', { exact: true }).fill('11:00');
  await page.getByLabel('额外延误 / 分钟', { exact: true }).fill('20');
  await page.getByLabel('雨天，略过室外活动', { exact: true }).check();
  await page.getByLabel('主恢复点不可用', { exact: true }).check();
  await page.getByLabel('提前返回时间（可留空）', { exact: true }).fill('15:00');
  await page.getByRole('button', { name: '重排剩余安排', exact: true }).click();
  const output = page.locator('#plan-output');
  await expect(output).toContainText('备用休息室');
  await expect(output).toContainText('雨天');
  await expect(output).toContainText('15:00');
  await expect(output).toContainText('已完成');
  await expect(output.locator('.step.activity h3')).not.toContainText(['河边观察']);
  const once = await output.innerText();
  await page.getByRole('button', { name: '重排剩余安排', exact: true }).click();
  expect(await output.innerText()).toBe(once);
  await page.getByRole('button', { name: '恢复原定安排', exact: true }).click();
  await expect(page.getByLabel('雨天，略过室外活动', { exact: true })).not.toBeChecked();
  await expect(output).toContainText('主恢复室');
});

test('完成后编辑恢复备注、来源和活动约束，真实JSON下载恢复保留全部现场记录', async ({ page }) => {
  await importTrip(page);
  await generate(page);
  await adjustCompletedTrip(page);
  const output = page.locator('#plan-output');
  await page.locator('#recovery summary').click();
  await page.locator('#recovery').getByLabel('核验备注', { exact: true }).fill('父验收只更新资料备注，完成事实不变');
  await expectStalePlan(page);
  await expectActiveSession(page);
  await page.getByRole('button', { name: '导出中文手账', exact: true }).click();
  await expect(page.locator('#errors')).toContainText('请先编排');
  const unplannedBackup = await download(page, '导出JSON备份');
  const beforeReplan = JSON.parse(unplannedBackup.text);
  expect(beforeReplan.session).toEqual(activeSession);
  expect(beforeReplan.trip.recovery.notes).toBe('父验收只更新资料备注，完成事实不变');
  await page.locator('#recovery').getByLabel('核验备注', { exact: true }).fill('临时修改，随后从未重排备份恢复');
  await confirmReplacement(page, () => page.locator('#import').setInputFiles(unplannedBackup.path));
  await expectActiveSession(page);
  await expect(output).toContainText('父验收只更新资料备注，完成事实不变');
  await expect(output.locator('.step').first().locator('time')).toHaveText('11:20');
  await expect(output.locator('.step.activity h3')).not.toContainText(['河边观察']);
  await page.locator('#recovery summary').click();
  await page.locator('#recovery').getByLabel('恢复来源网址', { exact: true }).fill('https://example.com/recovery-updated');
  await page.locator('#recovery').getByLabel('核验日期', { exact: true }).fill('2026-10-02');
  await page.locator('#people .input-card').first().getByLabel('连续活动上限 / 分钟', { exact: true }).fill('75');
  await page.locator('#people .input-card').first().getByLabel('必须独处', { exact: true }).check();
  await page.getByLabel('出发地点', { exact: true }).fill('已重新核对的住宿处');
  const remaining = page.locator('#activities .input-card').nth(1);
  await remaining.getByLabel('活动时长 / 分钟', { exact: true }).fill('45');
  await remaining.getByLabel('抵达此站的转场 / 分钟', { exact: true }).fill('8');
  await remaining.locator('summary').click();
  await remaining.getByLabel('最早开始', { exact: true }).fill('10:30');
  await remaining.getByLabel('活动来源网址', { exact: true }).fill('https://example.com/exhibition-updated');
  await expectActiveSession(page);
  await generate(page);
  await expect(output).toContainText('父验收只更新资料备注，完成事实不变');
  await expect(output.locator('.step').first().locator('time')).toHaveText('11:20');
  await expect(output.locator('.step.activity h3')).not.toContainText(['河边观察']);
  const revised = await output.innerText();
  await page.getByRole('button', { name: '重排剩余安排', exact: true }).click();
  expect(await output.innerText()).toBe(revised);
  const backup = await download(page, '导出JSON备份');
  const data = JSON.parse(backup.text);
  expect(data.session).toEqual(activeSession);
  expect(data.trip.recovery.source).toBe('https://example.com/recovery-updated');
  expect(data.trip.recovery.verifiedAt).toBe('2026-10-02');
  expect(data.trip.people[0]).toMatchObject({ maxActive: 75, needsAlone: true });
  expect(data.trip.origin).toBe('已重新核对的住宿处');
  expect(data.trip.activities[1]).toMatchObject({ id: 'museum', duration: 45, travelMinutes: 8, opens: '10:30', source: 'https://example.com/exhibition-updated' });
  await page.getByLabel('手账名称', { exact: true }).fill('临时改名');
  await confirmReplacement(page, () => page.locator('#import').setInputFiles(backup.path));
  await expectActiveSession(page);
  expect(await output.innerText()).toBe(revised);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await page.reload();
  await expectActiveSession(page);
  expect(await output.innerText()).toBe(revised);
});

test('完成后把剩余约束和备用恢复条件改为不可行，旧输出失效而完成事实不变', async ({ page }) => {
  await importTrip(page);
  await generate(page);
  await adjustCompletedTrip(page);
  const output = page.locator('#plan-output');
  const remaining = page.locator('#activities .input-card').nth(1);
  await remaining.locator('summary').click();
  await remaining.getByLabel('最晚离开', { exact: true }).fill('11:30');
  await expectStalePlan(page);
  await expectActiveSession(page);
  await generate(page);
  await expect(output).toContainText('未满足 / 未完成目标');
  await expect(output).toContainText('必做活动「室内展览」未完成');
  await expect(output.locator('.step.activity')).toHaveCount(0);
  await expect(page.getByLabel('完成：河边观察', { exact: true })).toBeChecked();
  await remaining.getByLabel('最晚离开', { exact: true }).fill('16:00');
  await page.locator('#backup-recovery').getByRole('combobox', { name: '坐下条件', exact: true }).selectOption('unknown');
  await expectStalePlan(page);
  await generate(page);
  await expect(output).toContainText('坐下恢复条件未满足或未知');
  await expect(output.locator('.step.recovery')).toHaveCount(0);
  await expect(output.locator('.step.activity')).toHaveCount(0);
  expect(JSON.parse((await download(page, '导出JSON备份')).text).session).toEqual(activeSession);
  await page.locator('#backup-recovery').getByRole('combobox', { name: '坐下条件', exact: true }).selectOption('yes');
  await generate(page);
  await expect(output).toContainText('备用休息室');
  await expect(output.locator('.step.activity h3')).toContainText(['室内展览', '书店选书']);
  await expect(output.locator('.step.activity h3')).not.toContainText(['河边观察']);
  await expectActiveSession(page);
});

test('资料编辑不能绕过已完成当前时间校验，也不静默修正非法现场延误', async ({ page }) => {
  await importTrip(page);
  await generate(page);
  await page.getByLabel('完成：河边观察', { exact: true }).check();
  await page.locator('#recovery summary').click();
  await page.locator('#recovery').getByLabel('核验备注', { exact: true }).fill('完成后修订备注，尚未填写现在几点');
  await expectStalePlan(page);
  await expect(page.getByLabel('完成：河边观察', { exact: true })).toBeChecked();
  await page.getByRole('button', { name: '编排我的一天' }).click();
  await expect(page.locator('#errors')).toContainText('请填写当前时间');
  await expect(page.getByLabel('当前时间（可留空）', { exact: true })).toHaveValue('');
  await page.getByLabel('当前时间（可留空）', { exact: true }).fill('11:00');
  await page.getByLabel('额外延误 / 分钟', { exact: true }).fill('-1');
  await page.getByLabel('城市', { exact: true }).fill('武汉');
  await expect(page.getByLabel('额外延误 / 分钟', { exact: true })).toHaveValue('-1');
  await page.getByRole('button', { name: '编排我的一天' }).click();
  await expect(page.locator('#errors')).toContainText('额外延误必须为0到240的整数');
  await expect(page.getByLabel('完成：河边观察', { exact: true })).toBeChecked();
  await page.getByLabel('额外延误 / 分钟', { exact: true }).fill('10');
  await generate(page);
  await expect(page.locator('#plan-output .step').first().locator('time')).toHaveText('11:10');
  await expect(page.locator('#plan-output .step.activity h3')).not.toContainText(['河边观察']);
});

test('完成活动改名保留身份，移除须取消完成，新建同名活动不继承完成且明确重置可恢复原定安排', async ({ page }) => {
  await importTrip(page);
  await generate(page);
  await adjustCompletedTrip(page);
  const activity = page.locator('#activities .input-card').first();
  await activity.getByLabel('活动名称', { exact: true }).fill('河边观察（修正名称）');
  await expectStalePlan(page);
  await expectActiveSession(page, '河边观察（修正名称）');
  expect(JSON.parse((await download(page, '导出JSON备份')).text).trip.activities[0].id).toBe('walk');
  await activity.getByRole('button', { name: '移除活动 1', exact: true }).click();
  await expect(page.locator('#activities .input-card')).toHaveCount(3);
  await expect(page.locator('#errors')).toContainText('已经完成');
  await expect(page.locator('#errors')).toContainText('不能直接移除');
  await expect(page.locator('#errors')).toContainText('取消');
  await expectActiveSession(page, '河边观察（修正名称）');
  await page.getByLabel('完成：河边观察（修正名称）', { exact: true }).click();
  await expect(page.getByLabel('完成：河边观察（修正名称）', { exact: true })).toHaveCount(0);
  expect(JSON.parse((await download(page, '导出JSON备份')).text).session).toEqual({ ...activeSession, completedIds: [] });
  await activity.getByRole('button', { name: '移除活动 1', exact: true }).click();
  await expect(page.locator('#activities .input-card')).toHaveCount(2);
  await page.getByRole('button', { name: '添加活动', exact: false }).click();
  await page.locator('#activities .input-card').last().getByLabel('活动名称', { exact: true }).fill('河边观察（修正名称）');
  const data = JSON.parse((await download(page, '导出JSON备份')).text);
  expect(data.session).toEqual({ ...activeSession, completedIds: [] });
  expect(data.trip.activities[2].id).not.toBe('walk');
  await generate(page);
  await expect(page.getByLabel('完成：河边观察（修正名称）', { exact: true })).not.toBeChecked();
  await page.getByLabel('完成：室内展览', { exact: true }).check();
  await page.getByRole('button', { name: '恢复原定安排', exact: true }).click();
  await expect(page.getByLabel('当前时间（可留空）', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('额外延误 / 分钟', { exact: true })).toHaveValue('0');
  await expect(page.getByLabel('雨天，略过室外活动', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('主恢复点不可用', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('提前返回时间（可留空）', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('完成：室内展览', { exact: true })).not.toBeChecked();
  await expect(page.locator('#plan-output .step').first().locator('time')).toHaveText('10:00');
  expect(JSON.parse((await download(page, '导出JSON备份')).text).session.completedIds).toEqual([]);
});

test('整份覆盖确认取消与坏JSON均保留现场事实，明确确认导入采用新方案自己的记录', async ({ page }) => {
  await importTrip(page);
  await generate(page);
  await adjustCompletedTrip(page);
  const oldOutput = await page.locator('#plan-output').innerText();
  await confirmReplacement(page, () => page.getByRole('button', { name: '载入构造示例', exact: true }).click(), false);
  await expectActiveSession(page);
  expect(await page.locator('#plan-output').innerText()).toBe(oldOutput);
  await confirmReplacement(page, () => page.getByRole('button', { name: '恢复已保存草稿', exact: true }).click(), false);
  await expectActiveSession(page);
  expect(await page.locator('#plan-output').innerText()).toBe(oldOutput);
  const replacement = tripFixture();
  replacement.title = '明确导入的全新方案';
  replacement.activities[0].id = 'different-walk';
  const validFile = { name: 'new-plan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'rest-rhythm', version: 1, trip: replacement, session: {} })) };
  await confirmReplacement(page, () => page.locator('#import').setInputFiles(validFile), false);
  await expect(page.getByLabel('手账名称', { exact: true })).toHaveValue('成都两人恢复手账');
  await expectActiveSession(page);
  await page.locator('#import').setInputFiles({ name: 'identity-conflict.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'rest-rhythm', version: 1, trip: replacement, session: activeSession })) });
  await expect(page.locator('#errors')).toContainText('已完成活动记录不正确');
  await expectActiveSession(page);
  expect(await page.locator('#plan-output').innerText()).toBe(oldOutput);
  await confirmReplacement(page, () => page.locator('#import').setInputFiles(validFile));
  await expect(page.getByLabel('手账名称', { exact: true })).toHaveValue(replacement.title);
  await expect(page.getByLabel('完成：河边观察', { exact: true })).not.toBeChecked();
  expect(JSON.parse((await download(page, '导出JSON备份')).text).session).toEqual({ completedIds: [], now: '', delayMinutes: 0, rain: false, unavailableRecovery: false, earlyEnd: '' });
  await expect(page.locator('#plan-output .step.activity h3')).toContainText(['河边观察']);
});

test('不满足硬恢复条件时显示缺失目标与出口而非虚构恢复', async ({ page }) => {
  const trip = tripFixture();
  trip.recovery.seat = 'unknown';
  trip.backupRecovery = null;
  await importTrip(page, trip);
  await generate(page);
  await expect(page.locator('#plan-output')).toContainText('恢复点不可用');
  await expect(page.locator('#plan-output')).toContainText('必做活动');
  await expect(page.locator('#plan-output')).toContainText('返回住宿处');
  await expect(page.locator('#plan-output .step.recovery')).toHaveCount(0);
  await expect(page.locator('#plan-output .step.activity')).toHaveCount(0);
});

test('JSON和中文手账导出、导入与打印保留可继续使用的结果', async ({ page }) => {
  await importTrip(page);
  await generate(page);
  await page.getByLabel('主恢复点不可用', { exact: true }).check();
  await page.getByRole('button', { name: '重排剩余安排', exact: true }).click();
  const json = await download(page, '导出JSON备份');
  expect(json.name).toMatch(/\.json$/);
  const data = JSON.parse(json.text);
  expect(data.format).toBe('rest-rhythm');
  expect(data.trip.city).toBe('成都');
  expect(data.trip.people).toHaveLength(2);
  expect(data.session).toBeDefined();
  const markdown = await download(page, '导出中文手账');
  expect(markdown.name).toMatch(/\.md$/);
  expect(markdown.text).toContain('备用休息室');
  expect(markdown.text).toContain('住宿处');
  expect(markdown.text).toContain('不作实时保证');
  await page.getByLabel('城市', { exact: true }).fill('厦门');
  await confirmReplacement(page, () => page.locator('#import').setInputFiles(json.path));
  await expect(page.getByLabel('城市', { exact: true })).toHaveValue('成都');
  await page.locator('#import').setInputFiles({ name: 'invalid-session.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'rest-rhythm', version: 1, trip: tripFixture(), session: { now: '99:00' } })) });
  await expect(page.locator('#errors')).toContainText('时间格式');
  await expect(page.getByLabel('城市', { exact: true })).toHaveValue('成都');
  await expect(page.getByLabel('主恢复点不可用', { exact: true })).toBeChecked();
  await generate(page);
  await page.evaluate(() => { window.__printCalls = 0; window.print = () => { window.__printCalls += 1; }; });
  await page.getByRole('button', { name: '打印 / 存为PDF', exact: true }).click();
  expect(await page.evaluate(() => window.__printCalls)).toBe(1);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.editor')).toBeHidden();
  await expect(page.locator('#plan-output')).toBeVisible();
  await expect(page.locator('#plan-output')).toContainText('备用休息室');
});

test('保存草稿并刷新后恢复完整输入与现场调整', async ({ page }) => {
  await importTrip(page);
  await generate(page);
  await page.getByLabel('完成：河边观察', { exact: true }).check();
  await page.getByLabel('当前时间（可留空）', { exact: true }).fill('11:00');
  await page.getByLabel('额外延误 / 分钟', { exact: true }).fill('15');
  await page.getByRole('button', { name: '重排剩余安排', exact: true }).click();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await page.reload();
  await confirmReplacement(page, () => page.getByRole('button', { name: '恢复已保存草稿', exact: true }).click());
  await expect(page.getByLabel('城市', { exact: true })).toHaveValue('成都');
  await expect(page.locator('#people .input-card')).toHaveCount(2);
  await expect(page.getByLabel('额外延误 / 分钟', { exact: true })).toHaveValue('15');
  await generate(page);
  await expect(page.locator('#plan-output')).toContainText('已完成');
});

test('错误延误与缺少当前时间保留已有时间轴，修正后可继续重排', async ({ page }) => {
  await importTrip(page);
  await generate(page);
  const output = page.locator('#plan-output');
  const original = await output.innerText();
  for (const value of ['-1', '1.5', '241']) {
    await page.getByLabel('额外延误 / 分钟', { exact: true }).fill(value);
    await page.getByRole('button', { name: '重排剩余安排', exact: true }).click();
    await expect(page.locator('#errors')).toContainText('额外延误必须为0到240的整数');
    expect(await output.innerText()).toBe(original);
    await expect(output).not.toContainText('undefined');
  }
  await page.getByLabel('额外延误 / 分钟', { exact: true }).fill('0');
  await page.getByLabel('完成：河边观察', { exact: true }).check();
  await page.getByRole('button', { name: '重排剩余安排', exact: true }).click();
  await expect(page.locator('#errors')).toContainText('请填写当前时间');
  expect(await output.innerText()).toBe(original);
  await page.getByLabel('当前时间（可留空）', { exact: true }).fill('11:00');
  await page.getByRole('button', { name: '重排剩余安排', exact: true }).click();
  await expect(page.locator('#errors')).toBeHidden();
  await expect(output).toContainText('已完成');
  await expect(output.locator('.step.activity h3')).not.toContainText(['河边观察']);
  await expect(output.locator('.step').first().locator('time')).toHaveText('11:00');
});

test('损坏导入与损坏草稿不会覆盖已有工作，修正后仍可使用', async ({ page }) => {
  await importTrip(page);
  await generate(page);
  await page.locator('#import').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{invalid') });
  await expect(page.locator('#errors')).toContainText('JSON');
  await expect(page.getByLabel('城市', { exact: true })).toHaveValue('成都');
  await page.locator('#import').setInputFiles({ name: 'unsafe.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"rest-rhythm","version":1,"__proto__":{}}') });
  await expect(page.locator('#errors')).toContainText('不安全');
  const oversizedTrip = tripFixture();
  oversizedTrip.title = '不应替换原工作的超范围输入';
  oversizedTrip.activities = Array.from({ length: 21 }, (_, index) => ({ ...oversizedTrip.activities[0], id: `activity-${index}`, name: `活动${index + 1}` }));
  await page.locator('#import').setInputFiles({ name: 'too-many-activities.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'rest-rhythm', version: 1, trip: oversizedTrip })) });
  await expect(page.locator('#errors')).toContainText('活动');
  await expect(page.getByLabel('手账名称', { exact: true })).toHaveValue('成都两人恢复手账');
  await expect(page.locator('#activities .input-card')).toHaveCount(3);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys.length).toBeGreaterThan(0);
  await page.evaluate(storageKeys => storageKeys.forEach(key => localStorage.setItem(key, '{broken')), keys);
  await page.getByRole('button', { name: '恢复已保存草稿', exact: true }).click();
  await expect(page.locator('#errors')).toContainText('无法恢复草稿');
  await expect(page.getByLabel('城市', { exact: true })).toHaveValue('成都');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await generate(page);
  await expect(page.locator('#plan-output')).toContainText('河边观察');
});

test('浏览器拒绝保存时输入与JSON备份仍可使用', async ({ page }) => {
  await page.evaluate(() => {
    Storage.prototype.setItem = function () { throw new DOMException('空间不足', 'QuotaExceededError'); };
  });
  await importTrip(page);
  await generate(page);
  await expect(page.locator('#save-status')).toContainText('无法保存草稿');
  await expect(page.locator('#plan-output')).toContainText('河边观察');
  const json = await download(page, '导出JSON备份');
  expect(JSON.parse(json.text).trip.city).toBe('成都');
});

test('手机输入、安全文本呈现与表单名称支持旅途中操作', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const trip = tripFixture();
  const attack = '<img src=x onerror="window.__xssExecuted=1">';
  trip.title = attack;
  trip.activities[0].name = attack;
  trip.activities[0].notes = '<script>window.__xssExecuted=2</script>';
  await importTrip(page, trip);
  await generate(page);
  await expect(page.locator('#plan-title')).toContainText(attack);
  await expect(page.locator('#plan-output')).toContainText(attack);
  expect(await page.evaluate(() => window.__xssExecuted)).toBeUndefined();
  await expect(page.locator('#plan-output img, #plan-output script')).toHaveCount(0);
  const layout = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  expect(layout.document).toBeLessThanOrEqual(layout.viewport + 2);
  const unlabelled = await page.locator('input, select, textarea').evaluateAll(controls => controls.filter(control => !control.labels?.length && !control.getAttribute('aria-label') && !control.getAttribute('aria-labelledby')).map(control => control.name || control.id));
  expect(unlabelled).toEqual([]);
  await page.getByRole('button', { name: '使用说明', exact: true }).click();
  await expect(page.locator('#help')).toBeVisible();
  await expect(page.getByRole('button', { name: '使用说明', exact: true })).toHaveAttribute('aria-expanded', 'true');
});
