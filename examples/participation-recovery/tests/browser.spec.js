import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { basename } from 'node:path';

const run = process.env.PLAYWRIGHT_JSON_OUTPUT_FILE
  ? basename(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE).replace(/[^a-zA-Z0-9_.-]/g, '-')
  : Date.now();
const CHECKS = `.auto-company/checks/browser-downloads-${run}`;
const errors = new WeakMap();
const dialog = page => page.getByRole('dialog');
const resource = (page, title) => page.locator('[data-resource-id]').filter({ hasText: title });
const pathCard = (page, title) => page.locator('[data-path-id]').filter({ hasText: title });

test.beforeEach(async ({ page }) => {
  const observed = [];
  errors.set(page, observed);
  page.on('pageerror', error => observed.push(error.message));
  page.on('dialog', alert => alert.accept());
  await page.clock.setFixedTime(new Date('2026-10-01T12:00:00Z'));
  await page.goto('/');
});

test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

async function activity(page, title = '秋季混合研讨会') {
  await page.getByLabel('活动名称', { exact: true }).fill(title);
  await page.getByLabel('活动日期', { exact: true }).fill('2026-10-03');
  await page.getByRole('button', { name: '保存活动', exact: true }).click();
  await session(page, '上午交流', '2026-10-03T09:00');
}

async function session(page, title, startsAt) {
  await page.getByRole('button', { name: '＋ 添加时段', exact: true }).click();
  await dialog(page).getByLabel('时段标题', { exact: true }).fill(title);
  await dialog(page).getByLabel('开始时间', { exact: true }).fill(startsAt);
  await dialog(page).getByRole('button', { name: '添加时段', exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
}

async function service(page, kind, title, deadline = '2026-10-02T18:00', sessionTitle = '上午交流') {
  await page.getByRole('button', { name: '＋ 添加服务', exact: true }).click();
  const form = dialog(page);
  await form.getByRole('combobox', { name: '服务类型', exact: true }).selectOption(kind);
  await form.getByLabel('服务名称', { exact: true }).fill(title);
  await form.getByRole('combobox', { name: '所属时段', exact: true }).selectOption({ label: sessionTitle });
  await form.getByLabel('负责人', { exact: true }).fill(`${title}负责人`);
  await form.getByLabel('入口或资料位置').fill(`构造位置：${title}；https://example.invalid/${kind}`);
  if (kind === 'materials') await form.getByLabel('提前交付截止').fill(deadline);
  await form.getByRole('button', { name: '添加服务', exact: true }).click();
  await expect(resource(page, title)).toBeVisible();
}

async function path(page, title, services, sessionTitle = '上午交流') {
  await page.getByRole('button', { name: '＋ 建立路径', exact: true }).click();
  const form = dialog(page);
  await form.getByLabel('路径名称', { exact: true }).fill(title);
  await form.getByRole('combobox', { name: '所属时段', exact: true }).selectOption({ label: sessionTitle });
  for (const title of services) await form.getByRole('checkbox', { name: new RegExp(title) }).check();
  await form.getByRole('button', { name: '建立路径', exact: true }).click();
  await expect(pathCard(page, title)).toBeVisible();
}

async function evidence(page, title, { kind = 'route', result = 'pass', checkedAt = '2026-10-01T11:00', deliveredAt = '2026-10-01T10:00', completeChecks = true } = {}) {
  await resource(page, title).getByRole('button', { name: '记录演练', exact: true }).click();
  const form = dialog(page);
  await form.getByLabel('核验人', { exact: true }).fill('构造演练员');
  await form.getByLabel('核验时间', { exact: true }).fill(checkedAt);
  await form.getByRole('combobox', { name: '最终端结果', exact: true }).selectOption(result);
  await form.getByLabel('最终端观察', { exact: true }).fill(result === 'pass' ? '构造演练：从参加者端取得入口并完成操作，最终内容可读；不代表真实活动履约。' : '构造演练：观看端无法打开字幕，供应方音频通过不能替代。');
  if (kind === 'captions' && result === 'pass' && completeChecks) {
    for (const checkbox of await form.getByRole('checkbox').all()) await checkbox.check();
  }
  if (kind === 'materials') await form.getByLabel('实际交付时间').fill(deliveredAt);
  await form.getByRole('button', { name: '保存演练记录', exact: true }).click();
  if (!completeChecks) {
    await expect(form.getByRole('alert')).toContainText('字幕');
    await form.getByRole('button', { name: '取消', exact: true }).click();
    return;
  }
  await expect(form).not.toBeVisible();
}

async function confirm(page, title, roles = ['负责人', '参加者']) {
  for (const role of roles) {
    await pathCard(page, title).getByRole('button', { name: `${role}确认`, exact: true }).click();
    await dialog(page).getByLabel('确认人', { exact: true }).fill(`构造${role}`);
    await dialog(page).getByRole('button', { name: '确认最新版路径', exact: true }).click();
    await expect(dialog(page)).not.toBeVisible();
  }
}

async function change(page, title, location = '构造新入口：https://example.invalid/new-stream') {
  await resource(page, title).getByRole('button', { name: '变更入口', exact: true }).click();
  await dialog(page).getByLabel('变更后入口', { exact: true }).fill(location);
  await dialog(page).getByLabel('变更原因', { exact: true }).fill('构造换流演练，须核验新观看端并重新确认');
  await dialog(page).getByRole('button', { name: '保存变更', exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
}

async function download(page, button, filename) {
  await mkdir(CHECKS, { recursive: true });
  const pending = page.waitForEvent('download');
  await button.click();
  const file = await pending;
  expect(await file.failure()).toBeNull();
  await file.saveAs(`${CHECKS}/${filename}`);
  return readFile(`${CHECKS}/${filename}`, 'utf8');
}

async function importText(page, text) {
  await page.getByRole('button', { name: '导入备份', exact: true }).click();
  await dialog(page).getByLabel('备份内容').fill(text);
  await dialog(page).getByRole('button', { name: '导入备份', exact: true }).click();
}

test('合成演示同字段误点不升版，同地址资料与字幕实际更新仅撤销关联路径并可完整恢复交接', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '加载合成演示', exact: true }).click();
  await dialog(page).getByRole('checkbox', { name: '我已了解并确认替换当前活动' }).check();
  await dialog(page).getByRole('button', { name: '确认加载合成演示', exact: true }).click();
  const mainPath = '线上观看与提前阅读';
  const independentPath = '构造仅使用原入口的独立路径';
  await path(page, independentPath, ['线上参加入口'], '上午分享与线上讨论');
  await evidence(page, '线上参加入口');
  await evidence(page, '观看端中文字幕', { kind: 'captions' });
  await evidence(page, '提前可调整阅读资料', { kind: 'materials' });
  await confirm(page, mainPath);
  await confirm(page, independentPath);
  await expect(page.locator('#ready-count')).toHaveText('2 / 2');
  let previous = JSON.parse(await download(page, page.getByRole('button', { name: '下载完整备份', exact: true }), 'browser-revision-original.json'));

  // 父级退回的原操作：只写原因，表单日期归一化不能制造实际变化。
  for (let attempt = 0; attempt < 2; attempt++) {
    await resource(page, '提前可调整阅读资料').getByRole('button', { name: '变更入口', exact: true }).click();
    await expect(dialog(page).getByRole('checkbox', { name: '内容或服务已实际更新（地址可以不变）', exact: true })).not.toBeChecked();
    await dialog(page).getByLabel('变更原因', { exact: true }).fill('构造误点：只补写说明，实际内容与地址没有变化');
    await dialog(page).getByRole('button', { name: '保存变更', exact: true }).click();
    await expect(dialog(page).getByRole('alert')).toContainText('没有实际变化');
    await dialog(page).getByRole('button', { name: '取消', exact: true }).click();
    await expect(resource(page, '提前可调整阅读资料')).toContainText('当前版本 v1');
    await expect(page.locator('#ready-count')).toHaveText('2 / 2');
  }
  const unchanged = JSON.parse(await download(page, page.getByRole('button', { name: '下载完整备份', exact: true }), 'browser-revision-unchanged.json'));
  expect(unchanged).toEqual(previous);

  for (const { id, title, kind } of [
    { id: 'materials', title: '提前可调整阅读资料', kind: 'materials' },
    { id: 'materials', title: '提前可调整阅读资料', kind: 'materials' },
    { id: 'captions', title: '观看端中文字幕', kind: 'captions' },
  ]) {
    const oldResource = previous.resources.find(item => item.id === id);
    const revision = oldResource.version + 1;
    const reason = `构造同地址${kind === 'materials' ? '资料全文已替换' : '字幕实际内容已更新'}，必须重做演练；不代表真实服务履约`;
    await resource(page, title).getByRole('button', { name: '变更入口', exact: true }).click();
    await dialog(page).getByRole('checkbox', { name: '内容或服务已实际更新（地址可以不变）', exact: true }).check();
    await dialog(page).getByLabel('变更原因', { exact: true }).fill(reason);
    await dialog(page).getByRole('button', { name: '保存变更', exact: true }).click();
    await expect(dialog(page)).not.toBeVisible();
    await expect(resource(page, title)).toContainText(`当前版本 v${revision}`);
    await expect(pathCard(page, mainPath)).toContainText('尚无最终端演练证据');
    await expect(pathCard(page, mainPath)).toContainText('负责人待确认 / 参加者待确认');
    await expect(pathCard(page, independentPath)).toContainText('完整就绪');
    await expect(page.locator('#ready-count')).toHaveText('1 / 2');
    await pathCard(page, mainPath).getByRole('button', { name: '负责人确认', exact: true }).click();
    await dialog(page).getByLabel('确认人', { exact: true }).fill('构造新版负责人');
    await dialog(page).getByRole('button', { name: '确认最新版路径', exact: true }).click();
    await expect(dialog(page).getByRole('alert')).toContainText('先补齐');
    await dialog(page).getByRole('button', { name: '取消', exact: true }).click();

    const pendingBackup = await download(page, page.getByRole('button', { name: '下载完整备份', exact: true }), `browser-revision-${kind}-v${revision}-pending.json`);
    const pending = JSON.parse(pendingBackup);
    const updated = pending.resources.find(item => item.id === id);
    expect(updated.versionHistory).toHaveLength(revision);
    expect(updated.versionHistory.slice(0, oldResource.version)).toEqual(oldResource.versionHistory);
    expect(updated.versionHistory.at(-1).contentUpdated).toBe(true);
    for (const key of ['title', 'owner', 'location']) expect(updated[key]).toBe(oldResource[key]);
    if (kind === 'materials') expect(Date.parse(updated.deadline)).toBe(Date.parse(oldResource.deadline));
    expect(pending.evidence).toEqual(previous.evidence);
    expect(pending.confirmations).toEqual(previous.confirmations);
    await importText(page, pendingBackup);
    await expect(dialog(page)).not.toBeVisible();
    await page.reload();
    await expect(page.locator('#ready-count')).toHaveText('1 / 2');
    await expect(pathCard(page, independentPath)).toContainText('完整就绪');
    await resource(page, title).getByRole('button', { name: '查看证据', exact: true }).click();
    await expect(dialog(page)).toContainText('历史证据，不能确认当前版本');
    await expect(dialog(page)).toContainText('内容/服务已更新');
    await expect(dialog(page)).toContainText('v1');
    await expect(dialog(page)).toContainText(`v${revision}`);
    await dialog(page).getByRole('button', { name: '关闭记录', exact: true }).click();
    const pendingHandoff = await download(page, page.getByRole('button', { name: '导出中文交接包', exact: true }), `browser-revision-${kind}-v${revision}-pending.md`);
    expect(pendingHandoff).toContain('存在缺口，请勿宣称完整就绪');
    expect(pendingHandoff).toContain('内容/服务已更新');
    expect(pendingHandoff).toContain(reason);

    await evidence(page, title, { kind, checkedAt: '2026-10-01T12:00', deliveredAt: '2026-10-01T12:00' });
    await expect(page.locator('#ready-count')).toHaveText('1 / 2');
    await expect(pathCard(page, mainPath)).toContainText('负责人待确认 / 参加者待确认');
    await confirm(page, mainPath, ['负责人']);
    await expect(page.locator('#ready-count')).toHaveText('1 / 2');
    await expect(pathCard(page, mainPath)).toContainText('负责人已确认 / 参加者待确认');
    await confirm(page, mainPath, ['参加者']);
    await expect(page.locator('#ready-count')).toHaveText('2 / 2');
    const restoredBackup = await download(page, page.getByRole('button', { name: '下载完整备份', exact: true }), `browser-revision-${kind}-v${revision}-restored.json`);
    const restored = JSON.parse(restoredBackup);
    expect(restored.evidence).toHaveLength(previous.evidence.length + 1);
    expect(restored.confirmations).toHaveLength(previous.confirmations.length + 2);
    expect(restored.evidence.slice(0, previous.evidence.length)).toEqual(previous.evidence);
    expect(restored.confirmations.slice(0, previous.confirmations.length)).toEqual(previous.confirmations);
    await importText(page, restoredBackup);
    await expect(dialog(page)).not.toBeVisible();
    await page.reload();
    await expect(page.locator('#ready-count')).toHaveText('2 / 2');
    previous = restored;
  }
  const handoff = await download(page, page.getByRole('button', { name: '导出中文交接包', exact: true }), 'browser-revision-restored-handoff.md');
  expect(handoff).toContain('内容/服务已更新');
  expect(handoff).toContain('版本 1');
  expect(handoff).toContain('版本 2');
  expect(handoff).toContain('版本 3');
  expect(handoff).toContain('负责人已确认；参加者已确认');
  expect(handoff).toContain('构造同地址资料全文已替换');
  expect(handoff).toContain('构造同地址字幕实际内容已更新');
  const personal = await download(page, pathCard(page, mainPath).getByRole('button', { name: '下载参加者指引', exact: true }), 'browser-revision-restored-participant.md');
  expect(personal).toContain(mainPath);
  expect(personal).toContain('负责人已确认；参加者已确认');
  expect(personal).not.toContain(independentPath);
  const owner = await download(page, resource(page, '提前可调整阅读资料').getByRole('button', { name: '下载负责人任务', exact: true }), 'browser-revision-restored-owner.md');
  expect(owner).toContain('提前可调整阅读资料');
  expect(owner).not.toContain('观看端中文字幕');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `${CHECKS}/browser-revision-restored-mobile.png`, fullPage: true });
});

test('含秒和毫秒的旧备份时间打开变更框后不被截断而误升版', async ({ page }) => {
  await activity(page, '构造精确时间归一化演练');
  await service(page, 'materials', '精确截止资料');
  const before = JSON.parse(await download(page, page.getByRole('button', { name: '下载完整备份', exact: true }), 'browser-revision-precision-original.json'));
  before.resources[0].deadline = '2026-10-02T18:00:12.345Z';
  before.resources[0].versionHistory[0].deadline = before.resources[0].deadline;
  before.sessions[0].startsAt = '2026-10-03T09:00:45.678Z';
  before.sessions[0].versionHistory[0].startsAt = before.sessions[0].startsAt;
  await importText(page, JSON.stringify(before));
  await expect(dialog(page)).not.toBeVisible();
  await resource(page, '精确截止资料').getByRole('button', { name: '变更入口', exact: true }).click();
  await expect(dialog(page).getByLabel('变更后提前截止')).toHaveValue('2026-10-02T18:00:12.345');
  await dialog(page).getByLabel('变更原因', { exact: true }).fill('构造同字段误点击');
  await dialog(page).getByRole('button', { name: '保存变更', exact: true }).click();
  await expect(dialog(page).getByRole('alert')).toContainText('没有实际变化');
  await dialog(page).getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('[data-session-id]').getByRole('button', { name: '变更时段', exact: true }).click();
  await expect(dialog(page).getByLabel('开始时间', { exact: true })).toHaveValue('2026-10-03T09:00:45.678');
  await dialog(page).getByLabel('变更原因', { exact: true }).fill('构造同时间误点击');
  await dialog(page).getByRole('button', { name: '保存时段变更', exact: true }).click();
  await expect(dialog(page).getByRole('alert')).toContainText('没有实际变化');
  await dialog(page).getByRole('button', { name: '取消', exact: true }).click();
  const unchanged = JSON.parse(await download(page, page.getByRole('button', { name: '下载完整备份', exact: true }), 'browser-revision-precision-unchanged.json'));
  expect(unchanged).toEqual(before);
});

test('同一分钟同地址更新后默认核验时间可立即保存，真正早于变更仍拒绝', async ({ page }) => {
  await activity(page, '合成同分钟内容更新');
  await service(page, 'materials', '合成秒级更新资料');
  await path(page, '合成即时复核路径', ['合成秒级更新资料']);
  for (const [version, at] of [[2, '2026-10-01T12:00:35.456Z'], [3, '2026-10-01T12:00:45.123Z']]) {
    await page.clock.setFixedTime(new Date(at));
    await resource(page, '合成秒级更新资料').getByRole('button', { name: '变更入口', exact: true }).click();
    await dialog(page).getByRole('checkbox', { name: '内容或服务已实际更新（地址可以不变）', exact: true }).check();
    await dialog(page).getByLabel('变更原因', { exact: true }).fill(`合成同一分钟资料全文更新 v${version}`);
    await dialog(page).getByRole('button', { name: '保存变更', exact: true }).click();
    await expect(dialog(page)).not.toBeVisible();
    await resource(page, '合成秒级更新资料').getByRole('button', { name: '记录演练', exact: true }).click();
    if (version === 3) {
      await dialog(page).getByLabel('核验人', { exact: true }).fill('合成核验员');
      await dialog(page).getByLabel('核验时间', { exact: true }).fill('2026-10-01T12:00:45.122');
      await dialog(page).getByLabel('实际交付时间').fill('2026-10-01T12:00:45.123');
      await dialog(page).getByLabel('最终端观察', { exact: true }).fill('合成新版资料检查；一毫秒过早证据必须拒绝。');
      await dialog(page).getByRole('button', { name: '保存演练记录', exact: true }).click();
      await expect(dialog(page).getByRole('alert')).toContainText('检查时间早于该资源版本的变更时间');
      await dialog(page).getByRole('button', { name: '取消', exact: true }).click();
      await resource(page, '合成秒级更新资料').getByRole('button', { name: '记录演练', exact: true }).click();
    }
    // 不修改默认核验时间，模拟刚完成变更便记录实际演练。
    const defaultTime = await dialog(page).getByLabel('核验时间', { exact: true }).inputValue();
    await dialog(page).getByLabel('核验人', { exact: true }).fill('合成核验员');
    await dialog(page).getByLabel('实际交付时间').fill(defaultTime);
    await dialog(page).getByLabel('最终端观察', { exact: true }).fill('合成同分钟演练：打开同地址新版资料，内容可读。');
    await dialog(page).getByRole('button', { name: '保存演练记录', exact: true }).click();
    await expect(dialog(page)).not.toBeVisible();
    expect(defaultTime).toBe(at.slice(0, -1));
    await expect(page.locator('#ready-count')).toHaveText('0 / 1');
    await confirm(page, '合成即时复核路径');
    await expect(page.locator('#ready-count')).toHaveText('1 / 1');
  }
  const restored = JSON.parse(await download(page, page.getByRole('button', { name: '下载完整备份', exact: true }), 'browser-same-minute-restored.json'));
  expect(restored.evidence.map(item => item.checkedAt)).toEqual(['2026-10-01T12:00:35.456Z', '2026-10-01T12:00:45.123Z']);
  expect(restored.resources[0].version).toBe(3);
  expect(restored.confirmations).toHaveLength(4);
});

test('空白录入、最终端双确认、精准变更与新证据恢复、中文交接和备份还原', async ({ page }) => {
  await activity(page);
  await service(page, 'route', '远程入口');
  await service(page, 'captions', '中文字幕');
  await service(page, 'materials', '提前文字稿');
  await session(page, '下午独立活动', '2026-10-04T14:00');
  await service(page, 'route', '独立现场路线', undefined, '下午独立活动');
  await path(page, '远程阅读路径', ['远程入口', '中文字幕', '提前文字稿']);
  await path(page, '另一位参加者的独立现场路径', ['独立现场路线'], '下午独立活动');
  await expect(pathCard(page, '远程阅读路径')).toContainText('最终端');
  await evidence(page, '远程入口');
  await evidence(page, '提前文字稿', { kind: 'materials' });
  await evidence(page, '中文字幕', { kind: 'captions', completeChecks: false });
  await expect(page.locator('#ready-count')).toHaveText('0 / 2');
  await evidence(page, '中文字幕', { kind: 'captions', result: 'fail' });
  await expect(pathCard(page, '远程阅读路径')).toContainText('失败');
  await evidence(page, '中文字幕', { kind: 'captions', checkedAt: '2026-10-01T11:01' });
  await confirm(page, '远程阅读路径');
  await evidence(page, '独立现场路线');
  await confirm(page, '另一位参加者的独立现场路径');
  await expect(page.locator('#ready-count')).toHaveText('2 / 2');

  // 新最终端观察不能在同一资源版本内沿用旧双确认。
  await evidence(page, '中文字幕', { kind: 'captions', result: 'fail', checkedAt: '2026-10-01T11:02' });
  await expect(page.locator('#ready-count')).toHaveText('1 / 2');
  await evidence(page, '中文字幕', { kind: 'captions', checkedAt: '2026-10-01T11:03' });
  await expect(pathCard(page, '远程阅读路径')).toContainText('尚未确认');
  await expect(page.locator('#ready-count')).toHaveText('1 / 2');
  await confirm(page, '远程阅读路径');

  await change(page, '中文字幕');
  await expect(resource(page, '中文字幕')).toContainText('2');
  await expect(pathCard(page, '远程阅读路径')).toContainText('尚无最终端');
  await expect(pathCard(page, '另一位参加者的独立现场路径')).toContainText('完整就绪');
  await expect(page.locator('#ready-count')).toHaveText('1 / 2');
  await evidence(page, '中文字幕', { kind: 'captions', checkedAt: '2026-10-01T12:00' });
  await expect(page.locator('#ready-count')).toHaveText('1 / 2');
  await confirm(page, '远程阅读路径');
  await expect(page.locator('#ready-count')).toHaveText('2 / 2');

  // 修改实际服务组合会生成路径新版，已有证据保留，旧确认不能沿用。
  await service(page, 'route', '新增辅助入口');
  await evidence(page, '新增辅助入口');
  await pathCard(page, '远程阅读路径').getByRole('button', { name: '调整路径', exact: true }).click();
  await dialog(page).getByRole('checkbox', { name: /新增辅助入口/ }).check();
  await dialog(page).getByLabel('调整原因').fill('构造补充参加者需要的辅助入口');
  await dialog(page).getByRole('button', { name: '保存路径调整', exact: true }).click();
  await expect(page.locator('#ready-count')).toHaveText('1 / 2');
  await expect(pathCard(page, '远程阅读路径')).toContainText('尚未确认');
  await expect(pathCard(page, '另一位参加者的独立现场路径')).toContainText('完整就绪');
  await confirm(page, '远程阅读路径');
  await expect(page.locator('#ready-count')).toHaveText('2 / 2');

  // 改开始时间同样改变交接安排，只撤销该时段路径的确认。
  await page.locator('[data-session-id]').filter({ hasText: '上午交流' }).getByRole('button', { name: '变更时段', exact: true }).click();
  await dialog(page).getByLabel('开始时间', { exact: true }).fill('2026-10-03T10:00');
  await dialog(page).getByLabel('变更原因', { exact: true }).fill('构造活动延后一小时，重新确认最新安排');
  await dialog(page).getByRole('button', { name: '保存时段变更', exact: true }).click();
  await expect(page.locator('#ready-count')).toHaveText('1 / 2');
  await expect(pathCard(page, '远程阅读路径')).toContainText('尚未确认');
  await expect(pathCard(page, '另一位参加者的独立现场路径')).toContainText('完整就绪');
  await confirm(page, '远程阅读路径');
  await expect(page.locator('#ready-count')).toHaveText('2 / 2');

  const handoff = await download(page, page.getByRole('button', { name: '导出中文交接包', exact: true }), 'browser-handoff.md');
  expect(handoff).toContain('秋季混合研讨会');
  expect(handoff).toContain('最新版本');
  expect(handoff).toContain('构造新入口');
  expect(handoff).toContain('不代替实际');
  const owner = await download(page, resource(page, '中文字幕').getByRole('button', { name: '下载负责人任务', exact: true }), 'browser-owner.md');
  expect(owner).toContain('中文字幕');
  expect(owner).not.toContain('独立现场路线');
  const personal = await download(page, pathCard(page, '远程阅读路径').getByRole('button', { name: '下载参加者指引', exact: true }), 'browser-participant.md');
  expect(personal).toContain('远程阅读路径');
  expect(personal).not.toContain('另一位参加者');
  expect(personal).not.toContain('独立现场路线');
  const backup = await download(page, page.getByRole('button', { name: '下载完整备份', exact: true }), 'browser-backup.json');
  const saved = JSON.parse(backup);
  expect(saved.paths).toHaveLength(2);
  expect(saved.resources).toHaveLength(5);
  await page.reload();
  await expect(page.locator('#ready-count')).toHaveText('2 / 2');
  await importText(page, '{not json');
  await expect(dialog(page).getByRole('alert')).toBeVisible();
  await dialog(page).getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('#ready-count')).toHaveText('2 / 2');
  await page.getByRole('button', { name: '新建空白活动', exact: true }).click();
  await dialog(page).getByRole('checkbox', { name: '我已了解并确认替换当前活动' }).check();
  await dialog(page).getByRole('button', { name: '确认新建空白活动', exact: true }).click();
  await expect(page.locator('#ready-count')).toHaveText('0 / 0');
  await importText(page, backup);
  await expect(dialog(page)).not.toBeVisible();
  await expect(page.locator('#ready-count')).toHaveText('2 / 2');
  await page.screenshot({ path: `${CHECKS}/desktop.png`, fullPage: true });
});

test('资料迟交无法由补交、换期限或最新版确认改写为提前目标恢复', async ({ page }) => {
  await activity(page, '迟交边界演练');
  await service(page, 'materials', '已过期资料', '2026-09-30T18:00');
  await path(page, '提前阅读路径', ['已过期资料']);
  await evidence(page, '已过期资料', { kind: 'materials' });
  await expect(pathCard(page, '提前阅读路径')).toContainText('已错过提前资料期限');
  await expect(page.locator('#ready-count')).toHaveText('0 / 1');
  await resource(page, '已过期资料').getByRole('button', { name: '变更入口', exact: true }).click();
  await dialog(page).getByLabel('变更后提前截止').fill('2026-10-02T18:00');
  await dialog(page).getByLabel('变更原因', { exact: true }).fill('构造改期，不得抹去原迟交');
  await dialog(page).getByRole('button', { name: '保存变更', exact: true }).click();
  await evidence(page, '已过期资料', { kind: 'materials', checkedAt: '2026-10-01T12:00', deliveredAt: '2026-10-01T12:00' });
  await expect(pathCard(page, '提前阅读路径')).toContainText('已错过提前资料期限');
  await pathCard(page, '提前阅读路径').getByRole('button', { name: '参加者确认', exact: true }).click();
  await dialog(page).getByLabel('确认人').fill('构造参加者');
  await dialog(page).getByRole('button', { name: '确认最新版路径', exact: true }).click();
  await expect(dialog(page).getByRole('alert')).toContainText('迟交');
  await dialog(page).getByRole('button', { name: '取消', exact: true }).click();
  const handoff = await download(page, page.getByRole('button', { name: '导出中文交接包', exact: true }), 'browser-late-handoff.md');
  expect(handoff).toContain('2026-09-30');
  expect(handoff).toContain('不能恢复提前准备机会');
});

test('畸形备份不破坏当前活动，用户文字按文本渲染', async ({ page }) => {
  const hostile = '<img src=x onerror="window.__unsafe=true">';
  await activity(page, hostile);
  await expect(page.locator('#event-heading')).toHaveText(hostile);
  expect(await page.evaluate(() => window.__unsafe)).toBeUndefined();
  await expect(page.locator('#event-heading img')).toHaveCount(0);
  await service(page, 'route', '已有服务');
  const original = JSON.parse(await download(page, page.getByRole('button', { name: '下载完整备份', exact: true }), 'browser-safe-backup.json'));
  for (const attack of [
    { ...original, schemaVersion: 999 },
    { ...original, resources: [...original.resources, original.resources[0]] },
    { ...original, paths: [{ id: 'broken', label: '悬空路径', sessionId: original.sessions[0].id, resourceIds: ['missing'] }] },
  ]) {
    await importText(page, JSON.stringify(attack));
    await expect(dialog(page).getByRole('alert')).toBeVisible();
    await dialog(page).getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.locator('#event-heading')).toHaveText(hostile);
    await expect(resource(page, '已有服务')).toBeVisible();
  }
  await page.reload();
  await expect(page.locator('#event-heading')).toHaveText(hostile);
  await expect(resource(page, '已有服务')).toBeVisible();
});

test('窄屏可从空白完成核心录入与确认，无整体横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await activity(page, '手机上的现场参加安排');
  await service(page, 'route', '现场路线');
  await path(page, '手机参与路径', ['现场路线']);
  await evidence(page, '现场路线');
  await confirm(page, '手机参与路径');
  await expect(page.locator('#ready-count')).toHaveText('1 / 1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await mkdir(CHECKS, { recursive: true });
  await page.screenshot({ path: `${CHECKS}/mobile.png`, fullPage: true });
});
