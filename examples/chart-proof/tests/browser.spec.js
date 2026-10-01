const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');

const csv = 'series,x,y,kind,evidence,note\n甲,1,10,observed,公开表格第1行,\n甲,2,,missing,原图明确缺测,未采集\n甲,3,20,approximate,原图读取,约值\n乙,1,30,interpolated,插值说明,人工插值';
const metaInputs = {
  title: '#title', source: '#source', xLabel: '#x-label', yLabel: '#y-label',
  xScale: '#x-scale', yScale: '#y-scale', description: '#description'
};
const draftMeta = {
  title: '交叉操作中的未保存标题', source: '父验收未保存来源草稿',
  xLabel: '未保存横轴（年）', yLabel: '未保存纵轴（单位）',
  xScale: 'log', yScale: 'log', description: '未保存背景：构造数据，仅用于本地回归。'
};

async function fillMetaDraft(page, values = draftMeta) {
  for (const [key, selector] of Object.entries(metaInputs)) {
    if (key.endsWith('Scale')) await page.locator(selector).selectOption(values[key]);
    else await page.locator(selector).fill(values[key]);
  }
}

async function expectMetaInputs(page, values = draftMeta) {
  for (const [key, selector] of Object.entries(metaInputs)) {
    await expect(page.locator(selector), `元数据 ${key} 应保留`).toHaveValue(values[key]);
  }
}

async function importCSV(page, content = csv) {
  await page.locator('#csv-input').fill(content);
  await page.locator('#import-csv').click();
}

async function saveMeta(page) {
  await page.locator('#title').fill('季度测量资料');
  await page.locator('#source').fill('公开材料第12页');
  await page.locator('#x-label').fill('季度');
  await page.locator('#y-label').fill('测量值（单位）');
  await page.locator('#description').fill('构造数据，仅用于本地测试。');
  await page.locator('#save-meta').click();
}

async function download(page, selector) {
  const pending = page.waitForEvent('download');
  await page.locator(selector).click();
  const result = await pending;
  const filename = await result.path();
  return { result, filename, content: await fs.readFile(filename, 'utf8') };
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  page.on('dialog', (dialog) => dialog.accept());
});

test('实际完整任务：导入、来源、复核、更正、刷新恢复、JSON恢复与独立HTML阅读', async ({ page, context }, testInfo) => {
  await importCSV(page);
  await expect(page.locator('#point-table tbody tr')).toHaveCount(4);
  await saveMeta(page);
  await expect(page.locator('#reading-content')).toContainText('季度测量资料');
  await expect(page.locator('#reading-content')).toContainText('缺测');
  await expect(page.locator('#reading-content')).toContainText('近似');
  await page.locator('#reviewer').fill('测试复核员');
  const first = page.locator('#point-table tbody tr').first();
  await first.locator('[data-review]').click();
  await expect(first).toContainText('测试复核员');
  await first.locator('[data-edit]').click();
  await expect(page.locator('#editor')).toBeVisible();
  await page.locator('#edit-value').fill('12');
  await page.locator('#edit-note').fill('重新核对原表后更正');
  await page.locator('#save-point').click();
  await expect(page.locator('#editor')).not.toBeVisible();
  await expect(first).toContainText(/待复核|未复核/);
  await expect(first).toContainText('12');
  await first.locator('[data-review]').click();
  const backup = await download(page, '#export-json');
  const project = JSON.parse(backup.content);
  expect(project.points[0].y).toBe(12);
  expect(project.points[1].y).toBeNull();
  expect(project.points[0].review.name).toBe('测试复核员');
  expect(project.history.length).toBeGreaterThanOrEqual(3);
  await page.reload();
  await expect(page.locator('#point-table tbody tr')).toHaveCount(4);
  await expect(first).toContainText('12');
  await expect(first).toContainText('测试复核员');
  await page.locator('#reset-project').click();
  await expect(page.locator('#point-table tbody tr [data-edit]')).toHaveCount(0);
  await page.locator('#project-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(backup.content) });
  await expect(page.locator('#point-table tbody tr')).toHaveCount(4);
  await expect(page.locator('#reading-content')).toContainText('季度测量资料');
  const output = await download(page, '#export-html');
  const htmlPath = testInfo.outputPath('阅读资料.html');
  await fs.writeFile(htmlPath, output.content);
  const reader = await context.newPage();
  await reader.goto('file://' + htmlPath);
  await expect(reader.locator('h1')).toContainText('季度测量资料');
  await expect(reader.locator('body')).toContainText('公开材料第12页');
  await expect(reader.locator('body')).toContainText('缺测');
  await expect(reader.locator('body')).toContainText('测试复核员');
  await expect(reader.locator('table')).toBeVisible();
  await expect(reader.locator('script')).toHaveCount(0);
  await reader.setViewportSize({ width: 390, height: 844 });
  expect(await reader.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await reader.screenshot({ path: testInfo.outputPath('离线阅读资料-移动.png'), fullPage: true });
  await reader.close();
  const csvBackup = await download(page, '#export-csv');
  await page.locator('#csv-file').setInputFiles({ name: 'roundtrip.csv', mimeType: 'text/csv', buffer: Buffer.from(csvBackup.content) });
  await expect(page.locator('#point-table tbody tr').first()).toContainText(/待复核|未复核/);
  const reimported = JSON.parse((await download(page, '#export-json')).content);
  expect(reimported.points.every((point) => point.review.name === '')).toBe(true);
  expect(reimported.meta.source).toBe('');
});

test('错误恢复：非法CSV、错误JSON和非法修改都保留原项目', async ({ page }) => {
  await importCSV(page);
  await importCSV(page, 'series,x,y\n甲,not-a-number,2');
  await expect(page.locator('#message')).toContainText(/错误|失败|无效|数值/);
  await expect(page.locator('#point-table tbody tr')).toHaveCount(4);
  await page.locator('#project-file').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"version":999}') });
  await expect(page.locator('#point-table tbody tr')).toHaveCount(4);
  await page.locator('#point-table tbody tr').first().locator('[data-edit]').click();
  await page.locator('#edit-value').fill('NaN');
  await page.locator('#save-point').click();
  await expect(page.locator('#editor')).toBeVisible();
  await expect(page.locator('#edit-error')).not.toBeEmpty();
  await page.locator('#edit-value').fill('14');
  await page.locator('#save-point').click();
  await expect(page.locator('#editor')).not.toBeVisible();
  await expect(page.locator('#point-table tbody tr').first()).toContainText('14');
  await page.locator('#csv-file').setInputFiles({ name: '用户数据.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.locator('#point-table tbody tr').first()).toContainText('10');
  await expect(page.locator('#point-table tbody tr')).toHaveCount(4);
});

test('HTML输入转义与来源变更复核撤销在真实浏览器生效', async ({ page }) => {
  await importCSV(page);
  await saveMeta(page);
  await page.locator('#reviewer').fill('测试复核员');
  await page.locator('#point-table tbody tr').first().locator('[data-review]').click();
  await page.locator('#source').fill('<img src=x onerror="window.__injected=true">');
  await page.locator('#save-meta').click();
  await expect(page.locator('#point-table tbody tr').first()).toContainText(/待复核|未复核/);
  await expect(page.locator('#reading-content')).toContainText('<img src=x');
  expect(await page.evaluate(() => window.__injected)).toBeUndefined();
  const output = await download(page, '#export-html');
  expect(output.content).toContain('&lt;img');
  expect(output.content).not.toContain('<img src=x');
});

test('全部来源草稿跨筛选、单点编辑和署名保留，导出仅用保存资料，保存后撤销旧复核', async ({ page }) => {
  await importCSV(page);
  await saveMeta(page);
  const savedMeta = JSON.parse((await download(page, '#export-json')).content).meta;
  await page.locator('#reviewer').fill('草稿交叉回归复核员');
  await page.locator('[aria-label="复核 甲 横轴 1"]').click();
  await fillMetaDraft(page);
  await expect(page.locator('#meta-draft-status')).toContainText('未保存');
  await expect(page.locator('#reader-draft-note')).toContainText('已保存');

  await page.locator('#series-filter').selectOption('乙');
  await expect(page.locator('#point-table tbody tr')).toHaveCount(1);
  await expectMetaInputs(page);
  await page.locator('#pending-only').check();
  await expectMetaInputs(page);
  await page.locator('#series-filter').selectOption('甲');
  await expect(page.locator('#point-table tbody tr')).toHaveCount(2);
  await expectMetaInputs(page);
  await page.locator('[aria-label="编辑 甲 横轴 3"]').click();
  await page.locator('#edit-value').fill('24');
  await page.locator('#edit-note').fill('单点更正不应清空来源草稿');
  await page.locator('#save-point').click();
  await expect(page.locator('#editor')).not.toBeVisible();
  await expectMetaInputs(page);
  await page.locator('[aria-label="复核 甲 横轴 3"]').click();
  await expect(page.locator('#point-table tbody tr')).toHaveCount(1);
  await expectMetaInputs(page);
  await page.locator('#pending-only').uncheck();
  await page.locator('#series-filter').selectOption('');
  await expectMetaInputs(page);

  const beforeSave = JSON.parse((await download(page, '#export-json')).content);
  expect(beforeSave.meta).toEqual(savedMeta);
  expect(beforeSave.points.filter((point) => point.review.name)).toHaveLength(2);
  expect(beforeSave.points.find((point) => point.series === '甲' && point.x === 3).y).toBe(24);
  const savedHTML = await download(page, '#export-html');
  const savedMarkdown = await download(page, '#export-md');
  for (const output of [savedHTML, savedMarkdown]) {
    expect(output.content).toContain(savedMeta.source);
    expect(output.content).toContain(savedMeta.title);
    expect(output.content).not.toContain(draftMeta.source);
    expect(output.content).not.toContain(draftMeta.title);
  }
  await expect(page.locator('#message')).toContainText('未保存');
  await expect(page.locator('#reading-content')).toContainText(savedMeta.source);
  await expect(page.locator('#reading-content')).not.toContainText(draftMeta.source);
  await expectMetaInputs(page);

  await page.locator('#save-meta').click();
  await expectMetaInputs(page);
  const afterSave = JSON.parse((await download(page, '#export-json')).content);
  expect(afterSave.meta).toEqual(draftMeta);
  expect(afterSave.points.every((point) => point.review.name === '')).toBe(true);
  expect(afterSave.history.at(-1).action).toBe('meta');
  expect(afterSave.history.at(-1).revokedReviews).toHaveLength(2);
  await expect(page.locator('#point-table tbody tr')).toHaveCount(4);
  await expect(page.locator('#point-table tbody tr').filter({ hasText: '草稿交叉回归复核员' })).toHaveCount(0);
  await expect(page.locator('#reading-content')).toContainText(draftMeta.source);
  for (const selector of ['#export-html', '#export-md']) {
    const output = await download(page, selector);
    expect(output.content).toContain(`原始来源：${draftMeta.source}`);
    expect(output.content).toContain(draftMeta.title);
    expect(output.content).not.toContain(`原始来源：${savedMeta.source}`);
  }
});

test('来源草稿刷新恢复、非法导入和取消替换仍保留，确认替换与显式放弃边界清楚', async ({ page }) => {
  await importCSV(page);
  await saveMeta(page);
  const savedBackup = await download(page, '#export-json');
  const savedMeta = JSON.parse(savedBackup.content).meta;
  await fillMetaDraft(page);
  await page.reload();
  await expectMetaInputs(page);
  await expect(page.locator('#meta-draft-status')).toContainText('未保存');
  await expect(page.locator('#reading-content')).toContainText(savedMeta.source);
  expect(JSON.parse((await download(page, '#export-json')).content).meta).toEqual(savedMeta);

  await importCSV(page, 'series,x,y\n甲,not-a-number,2');
  await expect(page.locator('#message')).toContainText(/错误|失败|无效|数值/);
  await expectMetaInputs(page);
  await page.locator('#project-file').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"version":999}') });
  await expect(page.locator('#message')).toContainText(/错误|失败|无效|版本/);
  await expectMetaInputs(page);

  const notices = [];
  page.removeAllListeners('dialog');
  page.on('dialog', async (dialog) => { notices.push(dialog.message()); await dialog.dismiss(); });
  await page.locator('#load-demo').click();
  await expect(page.locator('#point-table tbody tr')).toHaveCount(4);
  await expectMetaInputs(page);
  expect(notices.at(-1)).toContain('未保存');
  await page.locator('#reset-project').click();
  await expectMetaInputs(page);
  await expect(page.locator('#point-table tbody tr')).toHaveCount(4);
  expect(notices.at(-1)).toContain('未保存');

  page.removeAllListeners('dialog');
  page.on('dialog', (dialog) => dialog.accept());
  await page.locator('#project-file').setInputFiles({ name: 'saved.json', mimeType: 'application/json', buffer: Buffer.from(savedBackup.content) });
  await expectMetaInputs(page, savedMeta);
  await fillMetaDraft(page);
  await page.locator('#discard-meta-draft').click();
  await expectMetaInputs(page, savedMeta);
  await page.reload();
  await expectMetaInputs(page, savedMeta);
  await fillMetaDraft(page);
  await page.locator('#load-demo').click();
  await expect(page.locator('#point-table tbody tr')).toHaveCount(8);
  const replaced = JSON.parse((await download(page, '#export-json')).content);
  await expectMetaInputs(page, replaced.meta);
  await expect(page.locator('#point-table .tag.observed')).toHaveCount(4);
  await expect(page.locator('#point-table .tag.missing')).toHaveCount(1);
  await expect(page.locator('#point-table .tag.approximate')).toHaveCount(1);
  await expect(page.locator('#point-table .tag.interpolated')).toHaveCount(1);
  await expect(page.locator('#point-table .tag.unconfirmed').filter({ hasText: '未确认' })).toHaveCount(1);
  await expect(page.locator('#reading-content')).toContainText('构造样例');
});

test('旧格式浏览器项目可恢复，非法来源保存保留全部草稿与已署名资料', async ({ page }) => {
  const zeroCSV = 'series,x,y,kind,evidence\n甲,0,10,observed,构造原表第1行\n甲,1,20,observed,构造原表第2行';
  await importCSV(page, zeroCSV);
  await saveMeta(page);
  await page.locator('#reviewer').fill('旧格式回归复核员');
  await page.locator('[aria-label="复核 甲 横轴 0"]').click();
  const saved = JSON.parse((await download(page, '#export-json')).content);
  await page.evaluate((project) => {
    localStorage.setItem('chart-proof-project-v1', JSON.stringify(project));
  }, saved);
  await page.reload();
  await expectMetaInputs(page, saved.meta);
  await expect(page.locator('#point-table tbody tr')).toHaveCount(2);
  await expect(page.locator('#point-table tbody tr').first()).toContainText('旧格式回归复核员');

  await fillMetaDraft(page);
  await page.locator('#save-meta').click();
  await expect(page.locator('#message')).toContainText('大于 0');
  await expectMetaInputs(page);
  await expect(page.locator('#meta-draft-status')).toContainText('未保存');
  await expect(page.locator('#point-table tbody tr').first()).toContainText('旧格式回归复核员');
  expect(JSON.parse((await download(page, '#export-json')).content)).toEqual(saved);
  await page.reload();
  await expectMetaInputs(page);
  await expect(page.locator('#point-table tbody tr').first()).toContainText('旧格式回归复核员');
  await page.locator('#x-scale').selectOption('linear');
  await page.locator('#save-meta').click();
  await expectMetaInputs(page, { ...draftMeta, xScale: 'linear' });
  const corrected = JSON.parse((await download(page, '#export-json')).content);
  expect(corrected.meta).toEqual({ ...draftMeta, xScale: 'linear' });
  expect(corrected.points.every((point) => point.review.name === '')).toBe(true);
});

test('责任与尺度错误：缺姓名、缺出处和非正数对数轴均拒绝且可继续工作', async ({ page }) => {
  await importCSV(page, 'series,x,y,kind,evidence\n甲,0,10,observed,原表第1行\n甲,1,20,observed,');
  const rows = page.locator('#point-table tbody tr');
  await rows.first().locator('[data-review]').click();
  await expect(page.locator('#message')).toContainText('复核人');
  await expect(rows.first()).toContainText(/待复核|未复核/);
  await page.locator('#reviewer').fill('测试复核员');
  await rows.nth(1).locator('[data-review]').click();
  await expect(page.locator('#message')).toContainText('出处');
  await expect(rows.nth(1)).toContainText(/待复核|未复核/);
  await page.locator('#title').fill('对数轴检查');
  await page.locator('#source').fill('测试公开来源');
  await page.locator('#x-scale').selectOption('log');
  await page.locator('#save-meta').click();
  await expect(page.locator('#message')).toContainText('大于 0');
  const preserved = JSON.parse((await download(page, '#export-json')).content);
  expect(preserved.meta.xScale).toBe('linear');
  expect(preserved.points[0].x).toBe(0);
  await page.locator('#x-scale').selectOption('linear');
  await page.locator('#save-meta').click();
  await expect(page.locator('#reading-content')).toContainText('对数轴检查');
});

test('浏览器拒绝草稿写入时仍可完成输入与JSON备份', async ({ page }) => {
  await page.evaluate(() => {
    Storage.prototype.setItem = function () { throw new Error('测试：存储不可用'); };
  });
  await importCSV(page);
  await expect(page.locator('#message')).toContainText('草稿无法保存');
  await expect(page.locator('#point-table tbody tr')).toHaveCount(4);
  const backup = JSON.parse((await download(page, '#export-json')).content);
  expect(backup.points).toHaveLength(4);
  expect(backup.points[1].kind).toBe('missing');
});

test('输入模板实际下载并导入，取消替换保留项目，构造样例可完整载入', async ({ page }) => {
  const template = await download(page, 'a[href="examples/template.csv"]');
  expect(template.content).toContain('series,x,y');
  await page.locator('#csv-file').setInputFiles({ name: 'template.csv', mimeType: 'text/csv', buffer: Buffer.from(template.content) });
  await expect(page.locator('#point-table tbody tr')).toHaveCount(3);
  await expect(page.locator('#point-table .tag.missing')).toHaveCount(1);
  await expect(page.locator('#point-table .tag.approximate')).toHaveCount(1);
  const before = JSON.parse((await download(page, '#export-json')).content);
  page.removeAllListeners('dialog');
  page.on('dialog', (dialog) => dialog.dismiss());
  await page.locator('#load-demo').click();
  await expect(page.locator('#point-table tbody tr')).toHaveCount(3);
  const preserved = JSON.parse((await download(page, '#export-json')).content);
  expect(preserved).toEqual(before);
  page.removeAllListeners('dialog');
  page.on('dialog', (dialog) => dialog.accept());
  await page.locator('#load-demo').click();
  await expect(page.locator('#point-table tbody tr')).toHaveCount(8);
  await expect(page.locator('#reading-content')).toContainText('构造样例');
  await expect(page.locator('#point-table .tag.missing')).toHaveCount(1);
  await expect(page.locator('#point-table .tag.approximate')).toHaveCount(1);
});

test('键盘可导入与编辑，窄屏可操作且正文没有横向溢出', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#csv-input').fill(csv);
  await page.locator('#import-csv').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#point-table tbody tr')).toHaveCount(4);
  const edit = page.locator('#point-table tbody tr').first().locator('[data-edit]');
  await edit.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#editor')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#editor')).not.toBeVisible();
  await expect(edit).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await expect(page.locator('#import-csv')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('实际工作台-移动.png'), fullPage: true });
});
