const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const examples = path.resolve(__dirname, '../examples');
const sourceRows = (page) => page.locator('#sources-body tr[data-element]');

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#demo-case option[value="normal"]')).toHaveCount(1);
}

async function demo(page, choice = 'normal') {
  await page.locator('#demo-case').selectOption(choice);
  await page.locator('#load-demo').click();
  await expect(page.locator('#feedback')).toContainText('合成样例已载入');
  await expect(page.locator('#analyze-button')).toBeEnabled();
  await page.locator('#analyze-button').click();
  await expect(page.locator('#results-content')).toBeVisible();
  await expect(page.locator('#feedback')).toContainText('复核完成');
}

async function upload(page, version, content, name) {
  await page.locator(`#${version}-file`).setInputFiles({ name: name || `${version}.ifc`, mimeType: 'application/octet-stream', buffer: Buffer.from(content) });
  await expect(page.locator('#analysis-form')).toHaveAttribute('aria-busy', 'false');
}

async function download(page, button) {
  const pending = page.waitForEvent('download');
  await page.locator(button).click();
  const result = await pending;
  const stream = await result.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return { name: result.suggestedFilename(), text: Buffer.concat(chunks).toString('utf8') };
}

function csvRows(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if (c === '\n' && !quoted) { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  row.push(cell.replace(/\r$/, '')); rows.push(row);
  return rows;
}

test('合成来源冲突经过真实分析，筛选和全底稿下载保留全部来源', async ({ page }) => {
  await ready(page);
  await demo(page, 'source-conflict');
  await expect(page.locator('#summary-grid')).toContainText('不可确定');
  await expect(page.locator('#issues-list')).toContainText('多个同名数量来源');
  await expect(sourceRows(page)).toHaveCount(3);
  await page.locator('#filter-version').selectOption('new');
  await page.locator('#filter-issue').selectOption('issues');
  await expect(sourceRows(page)).toHaveCount(2);
  await expect(sourceRows(page).first()).toContainText('3 m³');
  await expect(sourceRows(page).last()).toContainText('7 m³');
  await page.locator('#source-search').fill('没有这个构件');
  await expect(sourceRows(page)).toHaveCount(0);
  const json = await download(page, '#export-json');
  const report = JSON.parse(json.text);
  expect(json.name).toMatch(/\.json$/);
  expect(report.sources).toHaveLength(3);
  expect(report.summary.complete_delta_m3).toBeNull();
  expect(report.sources.filter((r) => r.version === 'new').map((r) => r.raw_value)).toEqual([3, 7]);
  const csv = await download(page, '#export-csv');
  expect(csv.text.charCodeAt(0)).toBe(0xfeff);
  expect(csvRows(csv.text).filter((row) => row[0] === '数量来源')).toHaveLength(3);
  await page.locator('#clear-filters').click();
  await expect(sourceRows(page)).toHaveCount(3);
  await page.locator('#issues-list button').first().click();
  await expect(sourceRows(page)).toHaveCount(2);
});

test('真正上传两个IFC、材料转移与筛选范围失效可重新计算', async ({ page }) => {
  await ready(page);
  await upload(page, 'old', fs.readFileSync(path.join(examples, 'material-only/old.ifc')), '基准.ifc');
  await upload(page, 'new', fs.readFileSync(path.join(examples, 'material-only/new.ifc')), '新版.ifc');
  await page.locator('#analyze-button').click();
  await expect(page.locator('#results-content')).toBeVisible();
  await expect(page.locator('#materials-body')).toContainText('Concrete');
  await expect(page.locator('#materials-body')).toContainText('Timber');
  const report = JSON.parse((await download(page, '#export-json')).text);
  expect(Object.fromEntries(report.materials.map((row) => [row.material, row.complete_delta_m3]))).toEqual({ Concrete: -2, Timber: 2 });
  await page.locator('#element-type').selectOption('IfcBeam');
  await expect(page.locator('#results-content')).toBeHidden();
  await page.locator('#analyze-button').click();
  await expect(page.locator('#issues-list')).toContainText('筛选范围没有对象');
  await page.locator('#element-type').selectOption('IfcElement');
  await page.locator('#analyze-button').click();
  await expect(sourceRows(page)).toHaveCount(2);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
});

test('坏IFC与超限文件提示后可换文件成功完成复核', async ({ page }) => {
  await ready(page);
  await upload(page, 'old', 'not IFC');
  await upload(page, 'new', fs.readFileSync(path.join(examples, 'normal/new.ifc')));
  await page.locator('#analyze-button').click();
  await expect(page.locator('#feedback')).toContainText('仅支持完整');
  await expect(page.locator('#results-content')).toBeHidden();
  await expect(page.locator('#analyze-button')).toBeEnabled();
  await upload(page, 'old', Buffer.alloc(10 * 1024 * 1024 + 1, 65));
  await expect(page.locator('#feedback')).toContainText('超过 10 MiB');
  await expect(page.locator('#analyze-button')).toBeDisabled();
  await upload(page, 'old', fs.readFileSync(path.join(examples, 'normal/old.ifc')));
  await page.locator('#analyze-button').click();
  await expect(page.locator('#results-content')).toBeVisible();
  const report = JSON.parse((await download(page, '#export-json')).text);
  expect(report.summary.complete_delta_m3).toBe(1);
  await page.locator('#reset-button').click();
  await expect(page.locator('#results-content')).toBeHidden();
  await expect(page.locator('#analyze-button')).toBeDisabled();
  await demo(page);
  await expect(sourceRows(page)).toHaveCount(2);
});

test('上传名称按文本显示，CSV公式和逗号正确处理，JSON保留原始输入', async ({ page }) => {
  await ready(page);
  const unsafe = '=SUM(1,2)<img src=x onerror=window.__xss=1>';
  const file = fs.readFileSync(path.join(examples, 'normal/old.ifc'), 'utf8').replace("'wall-A'", `'${unsafe}'`);
  await upload(page, 'old', file);
  await upload(page, 'new', file);
  await page.locator('#analyze-button').click();
  await expect(sourceRows(page)).toHaveCount(2);
  await expect(sourceRows(page).first()).toContainText(unsafe);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  await expect(page.locator('#sources-body img')).toHaveCount(0);
  const json = JSON.parse((await download(page, '#export-json')).text);
  expect(json.sources[0].name).toBe(unsafe);
  const csv = csvRows((await download(page, '#export-csv')).text);
  const sources = csv.filter((row) => row[0] === '数量来源');
  expect(sources).toHaveLength(2);
  expect(sources[0][4]).toBe(`'${unsafe}`);
  expect(sources.every((row) => row.length === 23)).toBe(true);
});

test('UTF8错误与非IFC扩展名均可恢复，不展示过期结果', async ({ page }) => {
  await ready(page);
  await demo(page);
  await upload(page, 'old', Buffer.from([0xff, 0xfe, 0x41]));
  await expect(page.locator('#feedback')).toContainText('不是有效 UTF-8');
  await expect(page.locator('#results-content')).toBeHidden();
  await upload(page, 'old', 'not IFC', 'bad.txt');
  await expect(page.locator('#feedback')).toContainText('请选择 .ifc 文件');
  await demo(page, 'missing');
  await expect(page.locator('#issues-list')).toContainText('缺少 NetVolume');
  await page.locator('#issues-list button').first().click();
  await expect(page.locator('#feedback')).toContainText('没有数量来源行');
  const json = JSON.parse((await download(page, '#export-json')).text);
  expect(json.summary.complete_delta_m3).toBeNull();
});

test('UTF8 BOM底稿哈希准确、微小数量可辨认、全局问题能定位到完整来源', async ({ page }) => {
  await ready(page);
  const file = '\ufeff' + fs.readFileSync(path.join(examples, 'normal/old.ifc'), 'utf8').replace("#3,2.,$", "#3,1.E-12,$");
  await upload(page, 'old', file);
  await upload(page, 'new', file);
  await page.locator('#analyze-button').click();
  await expect(sourceRows(page)).toHaveCount(2);
  await expect(sourceRows(page).first()).toContainText('1E-12 m³');
  const report = JSON.parse((await download(page, '#export-json')).text);
  expect(report.versions.old.sha256).toBe(crypto.createHash('sha256').update(Buffer.from(file)).digest('hex'));
  expect(report.sources[0].raw_value).toBe(1e-12);
  await demo(page, 'guid-rebuilt');
  const globalIssue = page.locator('#issues-list button').filter({ hasText: '不凭名称' });
  await globalIssue.click();
  await expect(page.locator('#feedback')).toContainText('版本或范围层级的问题');
  await expect(sourceRows(page)).toHaveCount(2);
});
