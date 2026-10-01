const { test, expect } = require('@playwright/test');
const { artwork, addWork, workRow, exportBackup, selectBackup } = require('./helpers.cjs');

const STORAGE_KEY = 'family-art-show.v1';

test('包含图片的备份可完整恢复；拒绝覆盖和确认覆盖都真实生效', async ({ page }) => {
  await page.goto('/');
  await addWork(page, { title: '备份里的画', words: '这些是原话。\n& <不会成为代码>', image: await artwork(page, 300, 900) });
  await addWork(page, { title: '备份里的收好作品', included: false });
  await page.locator('#start-show').click();
  await page.locator('#host-note').fill('这次记下的话');
  await page.locator('#host-next').click();
  const original = await exportBackup(page);
  expect(original.artworks[0].image).toMatch(/^data:image\/(png|jpeg|webp);base64,/);
  await page.locator('[data-view="prepare"]').first().click();
  await addWork(page, { title: '覆盖之前的新增作品' });
  const before = await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY);
  const rejectRestore = page.waitForEvent('dialog').then(dialog => dialog.dismiss());
  await selectBackup(page, original);
  await rejectRestore;
  await expect(workRow(page, '覆盖之前的新增作品')).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe(before);
  const acceptRestore = page.waitForEvent('dialog').then(dialog => dialog.accept());
  await selectBackup(page, original);
  await acceptRestore;
  await expect(page.locator('.artwork-row')).toHaveCount(2);
  await page.reload();
  const restored = await exportBackup(page);
  expect(restored).toEqual(original);
});

test('损坏、错误类型、越界和非法图片备份被拒绝且不改已有记录', async ({ page }) => {
  await page.goto('/');
  await addWork(page, { title: '不能丢掉的作品', words: '原数据保持原样。' });
  const valid = await exportBackup(page);
  const before = await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY);
  const change = fn => { const copy = structuredClone(valid); fn(copy); return copy; };
  const invalid = [
    '{损坏JSON',
    [],
    change(data => { data.version = 99; }),
    change(data => { data.artworks[0].included = 'yes'; }),
    change(data => { data.artworks[0].words = '长'.repeat(4001); }),
    change(data => { data.artworks[0].image = 'https://example.invalid/child.png'; }),
    change(data => { data.artworks[0].image = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='; }),
    change(data => { data.artworks[0].image = 'data:image/png;base64,bm90IGFuIGltYWdl'; }),
    change(data => { data.artworks.push({ ...data.artworks[0] }); }),
    change(data => { data.artworks = Array.from({ length: 25 }, (_, i) => ({ ...data.artworks[0], id: `invalid-limit-${i}` })); }),
    change(data => { data.activeSessionId = 'missing-session'; })
  ];
  let confirmations = 0;
  page.on('dialog', async dialog => { confirmations++; await dialog.dismiss(); });
  await page.evaluate(() => {
    window.__qaNoticeChanges = 0;
    new MutationObserver(() => window.__qaNoticeChanges++)
      .observe(document.getElementById('notice'), { childList: true, characterData: true, subtree: true });
  });
  for (const data of invalid) {
    const changes = await page.evaluate(() => window.__qaNoticeChanges);
    await selectBackup(page, data);
    await expect.poll(() => page.evaluate(() => window.__qaNoticeChanges)).toBeGreaterThan(changes);
    await expect(page.locator('#notice')).toBeVisible();
    await expect(page.locator('#notice')).toContainText(/备份|导入|文件|格式/);
    expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe(before);
    await expect(workRow(page, '不能丢掉的作品')).toBeVisible();
  }
  expect(confirmations).toBe(0);
});

test('损坏和不支持的作品图片不进入作品夹，用户可用无图方式恢复', async ({ page }) => {
  await page.goto('/');
  await page.locator('#art-title').fill('错误图片后继续');
  await page.locator('#art-included').check();
  for (const image of [
    { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not a real image') },
    { name: 'vector.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>') }
  ]) {
    await page.locator('#art-image').setInputFiles(image);
    await page.locator('#save-artwork').click();
    await expect(page.locator('#form-error')).toBeVisible();
    await expect(page.locator('.artwork-row')).toHaveCount(0);
  }
  await page.locator('#art-image').setInputFiles([]);
  await page.locator('#save-artwork').click();
  await expect(workRow(page, '错误图片后继续')).toBeVisible();
});

test('本机存储空间不足有明确提示，保留原持久记录并可导出当前内存数据', async ({ page }) => {
  await page.goto('/');
  await addWork(page, { title: '已经保存的作品' });
  const before = await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY);
  await page.evaluate(key => {
    const realSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(name, value) {
      if (name === key) throw new DOMException('synthetic full storage', 'QuotaExceededError');
      return realSetItem.call(this, name, value);
    };
  }, STORAGE_KEY);
  await addWork(page, { title: '空间不足时的新作品' });
  await expect(page.locator('#save-status')).toContainText(/未保存|无法|失败|空间|备份/);
  expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe(before);
  const inMemory = await exportBackup(page);
  expect(inMemory.artworks.map(item => item.title)).toContain('空间不足时的新作品');
  await page.reload();
  await expect(workRow(page, '已经保存的作品')).toBeVisible();
  await expect(page.locator('.artwork-row')).toHaveCount(1);
});

test('损坏本机记录不自动覆盖，仍能通过校验过的备份恢复', async ({ page }) => {
  await page.goto('/');
  await addWork(page, { title: '恢复后继续看' });
  const backup = await exportBackup(page);
  await page.evaluate(key => localStorage.setItem(key, '{synthetic corrupt data'), STORAGE_KEY);
  await page.reload();
  await expect(page.locator('#save-status')).toContainText(/损坏|无法|恢复/);
  expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe('{synthetic corrupt data');
  const acceptRestore = page.waitForEvent('dialog').then(dialog => dialog.accept());
  await selectBackup(page, backup);
  await acceptRestore;
  await expect(workRow(page, '恢复后继续看')).toBeVisible();
  expect(await exportBackup(page)).toEqual(backup);
});

test('真实 JPEG 与 WebP 输入都可上传、展示和保留在完整备份', async ({ page }) => {
  await page.goto('/');
  for (const [title, mimeType] of [['JPEG 原作', 'image/jpeg'], ['WebP 原作', 'image/webp']]) {
    const image = await artwork(page, 600, 200, mimeType);
    expect(image.buffer.length).toBeGreaterThan(100);
    await addWork(page, { title, image });
    await expect(workRow(page, title).locator('img')).toBeVisible();
  }
  const backup = await exportBackup(page);
  expect(backup.artworks).toHaveLength(2);
  for (const work of backup.artworks) expect(work.image).toMatch(/^data:image\/(png|jpeg|webp);base64,/);
  await page.locator('#start-show').click();
  await expect(page.locator('#stage-art img')).toBeVisible();
  await page.locator('#host-next').click();
  await expect(page.locator('#stage-title')).toHaveText('WebP 原作');
  await expect(page.locator('#stage-art img')).toBeVisible();
});

test('超过12MB的图片被拒绝；没有愿意入展作品时不启动或输出展会', async ({ page }) => {
  await page.goto('/');
  await page.locator('#art-title').fill('过大的文件');
  await page.locator('#art-image').setInputFiles({ name: 'oversize.png', mimeType: 'image/png', buffer: Buffer.alloc(12 * 1024 * 1024 + 1) });
  await expect(page.locator('#form-error')).toContainText(/12\s?MB|12\s?M|大小|过大/);
  await page.locator('#save-artwork').click();
  await expect(page.locator('#form-error')).toBeVisible();
  await expect(page.locator('.artwork-row')).toHaveCount(0);
  await page.locator('#art-image').setInputFiles([]);
  await addWork(page, { title: '这次全部先收好', included: false });
  await page.locator('#start-show').click();
  await expect(page.locator('#notice')).toContainText(/愿意|入展|展示|先选/);
  expect((await exportBackup(page)).sessions).toHaveLength(0);
  await page.locator('[data-view="review"]').first().click();
  await page.evaluate(() => { window.__printCalled = false; window.print = () => { window.__printCalled = true; }; });
  await page.locator('#print-show').click();
  expect(await page.evaluate(() => window.__printCalled)).toBe(false);
  await expect(page.locator('#notice')).toContainText(/愿意|入展|展示|先选/);
  await expect(page.locator('#print-document')).not.toContainText('这次全部先收好');
});

test('清空需要确认，取消保留持久记录；确认后刷新保持为空', async ({ page }) => {
  await page.goto('/');
  await addWork(page, { title: '清空之前' });
  const before = await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY);
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#reset-show').click();
  expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe(before);
  await expect(workRow(page, '清空之前')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#reset-show').click();
  await expect(page.locator('.artwork-row')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.artwork-row')).toHaveCount(0);
  const backup = await exportBackup(page);
  expect(backup.artworks).toEqual([]);
  expect(backup.sessions).toEqual([]);
});
