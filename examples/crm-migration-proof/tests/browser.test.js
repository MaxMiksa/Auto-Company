import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCSV } from '../engine.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const previewURL = process.env.PRODUCT_PREVIEW_URL;
const malicious = '<img src=x onerror="globalThis.__xss=1">';
const files = {
  companySource: 'code,name\n0007,上海采购客户\nB2,南京客户\n',
  companyTarget: 'new_id,legacy,label\nN2,B2,南京客户\nN1,0007,上海采购客户\n',
  orderSource: 'po,net,currency\n采购甲,100.20,CNY\n采购乙,150.40,CNY\n',
  orderTarget: 'old_po,value,money\n采购乙,150.4,CNY\n采购甲,100.2,CNY\n',
  relationSource: 'client,po,role\n0007,采购甲,buyer\nB2,采购乙,approver\n',
  relationTarget: 'old_client,old_po,role\nB2,采购乙,A\n0007,采购甲,B\n'
};

async function upload(page, card, side, text, name) {
  await card.locator(`input[type=file][data-side="${side}"]`).setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') });
  await page.waitForFunction(fileName => [...document.querySelectorAll('.file-info')].some(node => node.textContent.includes(fileName)), name);
  await page.waitForFunction(() => !document.querySelector('#run-audit').disabled);
}
async function addField(card, source, target, type = 'text') {
  await card.locator('[data-action="add-field"]').click();
  const row = card.locator('.mapping-row').last();
  await row.locator('[data-field-prop="source"]').selectOption(source);
  await row.locator('[data-field-prop="target"]').selectOption(target);
  await row.locator('[data-field-prop="type"]').selectOption(type);
}
async function run(page, expected) {
  await page.locator('#run-audit').click();
  await page.locator(`#result-status.status-${expected}`).waitFor();
  assert.equal(await page.locator('#error').isVisible(), false);
}
async function download(page, selector, directory, fileName) {
  const event = page.waitForEvent('download');
  await page.locator(selector).click();
  const result = await event;
  const filePath = join(directory, fileName);
  await result.saveAs(filePath);
  assert.equal(await result.failure(), null);
  return { text: await readFile(filePath, 'utf8'), filePath };
}
function pasteDetails(card, side) {
  return card.locator('.file-box').nth(side === 'source' ? 0 : 1).locator('details');
}
async function draft(card, side, text) {
  const details = pasteDetails(card, side);
  if (!await details.evaluate(node => node.open)) await details.locator('summary').click();
  await card.locator(`textarea[data-paste="${side}"]`).fill(text);
}
async function assertDraft(card, side, text, open = true) {
  assert.equal(await card.locator(`textarea[data-paste="${side}"]`).inputValue(), text, '重绘必须完整保留逐侧 CSV 草稿');
  assert.equal(await pasteDetails(card, side).evaluate(node => node.open), open, '重绘必须保留用户选择的折叠状态');
}
async function applyDraft(page, card, side) {
  const info = card.locator('.file-box').nth(side === 'source' ? 0 : 1).locator('.file-info');
  await card.locator(`[data-action="parse-paste"][data-side="${side}"]`).click();
  await page.waitForFunction(() => !document.querySelector('#run-audit').disabled);
  assert.match(await info.textContent(), /粘贴 CSV.*行.*列/);
  assert.equal(await page.locator('#error').isVisible(), false);
}
async function assertUnapplied(page) {
  await page.locator('#run-audit').click();
  await page.locator('#error:not([hidden])').waitFor();
  assert.match(await page.locator('#error').textContent(), /粘贴内容尚未应用/);
  assert.equal(await page.locator('#result-status').count(), 0);
  assert.equal(await page.locator('#export-json').count(), 0);
}
async function declareScope(page) {
  for (const name of ['complete', 'identity', 'rules', 'snapshot', 'relationships']) await page.locator(`input[name="${name}"]`).check();
  await page.locator('#scope-note').fill('仅为本地构造材料；本次范围及转换已明确，未覆盖活动与附件。');
}
async function singleObject(page) {
  await page.locator('#clear-all').click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.object-card').nth(1).locator('[data-action="remove-object"]').click();
  await page.locator('#add-relationship').click();
  const relation = page.locator('.relationship-card').first();
  await relation.locator('[data-name]').fill('已声明本次无联系人关系');
  for (const side of ['source', 'target']) await upload(page, relation, side, 'from,to,role\n', `明确无关系-${side}.csv`);
  for (const endpoint of ['from', 'to']) {
    await relation.locator(`[data-endpoint="${endpoint}"][data-prop="object"]`).selectOption('联系人');
    for (const side of ['source', 'target']) await relation.locator(`[data-endpoint="${endpoint}"][data-prop="${side}"]`).selectOption(endpoint);
  }
  for (const side of ['source', 'target']) await relation.locator(`[data-role="${side}"]`).selectOption('role');
  return page.locator('.object-card').first();
}
async function mapContact(card) {
  await card.locator('[data-key="source"]').selectOption('old_id');
  await card.locator('[data-key="target"]').selectOption('legacy_id');
  await addField(card, 'name', 'full_name');
}

test('真实浏览器：上传、配置、缺证恢复、异常核验及证据交接', { timeout: 120000 }, async t => {
  assert.ok(previewURL, '协调器须设置 PRODUCT_PREVIEW_URL 为正式本地预览URL');
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {}), args: ['--no-sandbox'] });
  const context = await browser.newContext({ acceptDownloads: true, reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const directory = await mkdtemp(join(tmpdir(), 'crm-proof-browser-'));
  try {
    await page.goto(previewURL);
    await page.locator('.object-card').first().waitFor();
    await t.test('错误CSV可恢复；自造数据与字段映射得到不可判定', async () => {
      const first = page.locator('.object-card').nth(0), second = page.locator('.object-card').nth(1);
      await first.locator('input[type=file][data-side="source"]').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('id,id\n1,2') });
      await page.locator('#error:not([hidden])').waitFor();
      assert.match(await page.locator('#error').textContent(), /重复表头/);
      await first.locator('[data-name]').fill('公司');
      await second.locator('[data-name]').fill('订单');
      await page.locator('#project-name').fill(`采购交接 ${malicious}`);
      await upload(page, first, 'source', files.companySource, '公司-源.csv');
      await upload(page, first, 'target', files.companyTarget, '公司-目标.csv');
      assert.equal(await page.locator('#error').isVisible(), false);
      await first.locator('[data-key="source"]').selectOption('code');
      await first.locator('[data-key="target"]').selectOption('legacy');
      await addField(first, 'name', 'label');
      await upload(page, second, 'source', files.orderSource, '订单-源.csv');
      await upload(page, second, 'target', files.orderTarget, '订单-目标.csv');
      await second.locator('[data-key="source"]').selectOption('po');
      await second.locator('[data-key="target"]').selectOption('old_po');
      await addField(second, 'net', 'value', 'money');
      await second.locator('[data-currency="source"]').selectOption('currency');
      await second.locator('[data-currency="target"]').selectOption('money');
      await page.locator('#add-relationship').click();
      const relation = page.locator('.relationship-card').first();
      await relation.locator('[data-name]').fill('公司订单');
      await upload(page, relation, 'source', files.relationSource, '关联-源.csv');
      await upload(page, relation, 'target', files.relationTarget, '关联-目标.csv');
      for (const [endpoint, object, source, target] of [['from', '公司', 'client', 'old_client'], ['to', '订单', 'po', 'old_po']]) {
        await relation.locator(`[data-endpoint="${endpoint}"][data-prop="object"]`).selectOption(object);
        await relation.locator(`[data-endpoint="${endpoint}"][data-prop="source"]`).selectOption(source);
        await relation.locator(`[data-endpoint="${endpoint}"][data-prop="target"]`).selectOption(target);
      }
      await relation.locator('[data-role="source"]').selectOption('role');
      await relation.locator('[data-role="target"]').selectOption('role');
      await relation.locator('[data-role-map]').fill('{"A":"approver","B":"buyer"}');
      await run(page, 'unknown');
      assert.match(await page.locator('#report').textContent(), /尚未确认/);
      assert.equal(await page.locator('#report img').count(), 0);
      assert.equal(await page.evaluate(() => globalThis.__xss), undefined);
    });
    await t.test('补齐声明后通过；输入更新使旧报告及下载入口失效', async () => {
      for (const name of ['complete', 'identity', 'rules', 'snapshot', 'relationships']) await page.locator(`input[name="${name}"]`).check();
      await page.locator('#scope-note').fill('构造数据，仅公司订单；冻结同一时点。活动、附件未覆盖。');
      await run(page, 'pass');
      assert.match(await page.locator('#result-status').textContent(), /所给材料通过/);
      const result = await download(page, '#export-json', directory, 'pass.json');
      const report = JSON.parse(result.text);
      assert.equal(report.status, 'pass');
      assert.equal(report.config.objects[0].source.rows[0].code, '0007');
      assert.equal(report.inputs.length, 6);
      assert.ok(report.inputs.every(input => /^[a-f0-9]{64}$/.test(input.sha256)));
      assert.ok(/^[a-f0-9]{64}$/.test(report.configSha256));
      const first = page.locator('.object-card').first();
      await first.locator('.file-box').first().locator('summary').click();
      await first.locator('textarea[data-paste="source"]').fill(files.companySource);
      assert.equal(await page.locator('#result-status').count(), 0);
      await page.locator('#run-audit').click();
      await page.locator('#error:not([hidden])').waitFor();
      assert.match(await page.locator('#error').textContent(), /粘贴内容尚未应用/);
      assert.equal(await page.locator('#export-json').count(), 0);
      await first.locator('[data-action="parse-paste"][data-side="source"]').click();
      await page.waitForFunction(() => !document.querySelector('#run-audit').disabled);
      await run(page, 'pass');
      const second = page.locator('.object-card').nth(1);
      await page.evaluate(() => {
        globalThis.__originalArrayBuffer = Blob.prototype.arrayBuffer;
        Blob.prototype.arrayBuffer = function () { const self = this; return new Promise(resolve => setTimeout(resolve, 500)).then(() => globalThis.__originalArrayBuffer.call(self)); };
      });
      await second.locator('input[type=file][data-side="target"]').setInputFiles({ name: '订单-异常.csv', mimeType: 'text/csv', buffer: Buffer.from(files.orderTarget.replace('100.2,CNY', '101.2,CNY')) });
      assert.equal(await page.locator('#run-audit').isDisabled(), true, '文件读入期间不能再核验旧数据');
      assert.equal(await page.locator('#result-status').count(), 0);
      assert.equal(await page.locator('#export-json').count(), 0);
      await page.waitForFunction(() => !document.querySelector('#run-audit').disabled);
      await page.evaluate(() => { Blob.prototype.arrayBuffer = globalThis.__originalArrayBuffer; delete globalThis.__originalArrayBuffer; });
      await run(page, 'fail');
      assert.match(await page.locator('#report').textContent(), /采购甲/);
    });
    await t.test('JSON、CSV与可打印HTML真实下载保留证据且不执行恶意文本', async () => {
      await upload(page, page.locator('.object-card').first(), 'source', files.companySource.replace('上海采购客户', '=2+2'), '公司-公式文本.csv');
      await run(page, 'fail');
      const json = await download(page, '#export-json', directory, 'fail.json');
      const report = JSON.parse(json.text);
      assert.equal(report.status, 'fail');
      assert.ok(report.issues.some(issue => issue.source === '=2+2'));
      const csv = await download(page, '#export-csv', directory, 'fail.csv');
      assert.equal(csv.text[0], '\uFEFF');
      assert.notEqual(csv.text[1], '\uFEFF', 'CSV仅一个BOM');
      assert.ok(parseCSV(csv.text).rows.some(row => row.源值 === "'=2+2"));
      const html = await download(page, '#export-html', directory, 'fail.html');
      assert.match(html.text, /完整比较配置与输入快照/);
      assert.match(html.text, /Content-Security-Policy/);
      assert.ok(!html.text.includes(malicious));
      const reportPage = await context.newPage();
      await reportPage.goto(`file://${html.filePath}`);
      assert.match(await reportPage.locator('body').textContent(), /采购交接/);
      assert.equal(await reportPage.locator('img,script').count(), 0);
      assert.equal(await reportPage.evaluate(() => globalThis.__xss), undefined);
      await reportPage.close();
    });
    await t.test('手机宽度可操作；合法、异常和缺证样例可复核', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('#demo-valid').click();
      await page.waitForFunction(() => document.querySelector('#working-state').textContent.includes('已载入合成样例'));
      await run(page, 'pass');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '页面不应有整体横向溢出');
      await page.locator('#demo-broken').click();
      await page.waitForFunction(() => document.querySelector('#working-state').textContent.includes('已载入合成样例'));
      await run(page, 'fail');
      await page.locator('#demo-unknown').click();
      await page.waitForFunction(() => document.querySelector('#working-state').textContent.includes('已载入合成样例'));
      await run(page, 'unknown');
      await page.locator('#clear-all').click();
      assert.equal(await page.locator('#result-status').count(), 0);
      assert.equal(await page.locator('#export-json').count(), 0);
    });
    await t.test('双侧先填后分别应用，未应用侧及展开状态保持且禁止核验旧材料', async () => {
      const card = await singleObject(page);
      const source = 'old_id,name\n001,"Parent Alpha <>& ""引号"""\n';
      const target = 'legacy_id,full_name\n001,"Parent Alpha <>& ""引号"""\n';
      await draft(card, 'source', source);
      await draft(card, 'target', target);
      await applyDraft(page, card, 'source');
      await assertDraft(card, 'source', source);
      await assertDraft(card, 'target', target);
      assert.match(await card.locator('.file-box').nth(1).locator('.file-info').textContent(), /尚未应用/);
      await assertUnapplied(page);
      await assertDraft(card, 'target', target);
      await applyDraft(page, card, 'target');
      await assertDraft(card, 'source', source);
      await assertDraft(card, 'target', target);
      await mapContact(card);
      await declareScope(page);
      await run(page, 'pass');
      const report = JSON.parse((await download(page, '#export-json', directory, 'bilateral-drafts.json')).text);
      assert.equal(report.config.objects[0].source.rows[0].old_id, '001');
      assert.equal(report.config.objects[0].target.rows[0].full_name, 'Parent Alpha <>& "引号"');
      assert.equal(report.inputs.length, 4);
    });
    await t.test('其他对象与关联草稿跨应用、字段变更、对象增删及关联重绘完整保留', async () => {
      await page.locator('#clear-all').click();
      const first = page.locator('.object-card').nth(0), second = page.locator('.object-card').nth(1);
      await first.locator('[data-name]').fill('公司');
      await second.locator('[data-name]').fill('订单');
      await page.locator('#add-relationship').click();
      const relation = page.locator('.relationship-card').first();
      const label = '<img src=x onerror="globalThis.__draftXss=1"> & < > "草稿"\n第二行';
      const quotedLabel = `"${label.replaceAll('"', '""')}"`;
      const companySource = `code,name\n0007,${quotedLabel}\nB2,南京客户\n`;
      const companyTarget = `new_id,legacy,label\nN2,B2,南京客户\nN1,0007,${quotedLabel}\n`;
      const drafts = [[first, 'source', companySource, true], [first, 'target', companyTarget, true], [second, 'source', files.orderSource, true], [second, 'target', files.orderTarget, false], [relation, 'source', files.relationSource, true], [relation, 'target', files.relationTarget, false]];
      for (const [card, side, text, open] of drafts) {
        await draft(card, side, text);
        if (!open) await pasteDetails(card, side).locator('summary').click();
      }
      const assertAll = async () => {
        for (const [card, side, text, open] of drafts) await assertDraft(card, side, text, open);
        assert.equal(await page.locator('#input-section img,#input-section script').count(), 0);
        assert.equal(await page.evaluate(() => globalThis.__draftXss), undefined);
      };
      await applyDraft(page, first, 'source');
      await assertAll();
      await assertUnapplied(page);
      await first.locator('[data-action="add-field"]').click();
      await assertAll();
      await first.locator('[data-field-prop="type"]').selectOption('money');
      await assertAll();
      await first.locator('[data-action="remove-field"]').click();
      await assertAll();
      await page.locator('#add-object').click();
      await assertAll();
      await page.locator('.object-card').nth(2).locator('[data-action="remove-object"]').click();
      await assertAll();
      await first.locator('[data-name]').fill('公司已改名');
      await assertAll();
      await page.locator('#add-relationship').click();
      await assertAll();
      await page.locator('.relationship-card').nth(1).locator('[data-action="remove-relationship"]').click();
      await assertAll();
      await applyDraft(page, first, 'target');
      await assertAll();
      for (const [card, side] of [[second, 'source'], [second, 'target'], [relation, 'source'], [relation, 'target']]) {
        const entry = drafts.find(item => item[0] === card && item[1] === side);
        if (!entry[3]) { await pasteDetails(card, side).locator('summary').click(); entry[3] = true; }
        await applyDraft(page, card, side);
        await assertAll();
      }
      await first.locator('[data-key="source"]').selectOption('code');
      await first.locator('[data-key="target"]').selectOption('legacy');
      await addField(first, 'name', 'label');
      await second.locator('[data-key="source"]').selectOption('po');
      await second.locator('[data-key="target"]').selectOption('old_po');
      await addField(second, 'net', 'value', 'money');
      await second.locator('[data-currency="source"]').selectOption('currency');
      await second.locator('[data-currency="target"]').selectOption('money');
      for (const [endpoint, object, source, target] of [['from', '公司已改名', 'client', 'old_client'], ['to', '订单', 'po', 'old_po']]) {
        await relation.locator(`[data-endpoint="${endpoint}"][data-prop="object"]`).selectOption(object);
        await relation.locator(`[data-endpoint="${endpoint}"][data-prop="source"]`).selectOption(source);
        await relation.locator(`[data-endpoint="${endpoint}"][data-prop="target"]`).selectOption(target);
      }
      await relation.locator('[data-role="source"]').selectOption('role');
      await relation.locator('[data-role="target"]').selectOption('role');
      await relation.locator('[data-role-map]').fill('{"A":"approver","B":"buyer"}');
      await declareScope(page);
      await run(page, 'pass');
      const report = JSON.parse((await download(page, '#export-json', directory, 'cross-card-drafts.json')).text);
      assert.equal(report.config.objects[0].source.rows[0].name, label);
      assert.equal(report.config.objects[0].target.rows[1].label, label);
      assert.equal(report.config.relationships[0].target.rows.length, 2);
      assert.equal(report.inputs.length, 6);
      assert.equal(await page.evaluate(() => globalThis.__draftXss), undefined);
    });
    await t.test('非法粘贴保留草稿并使旧报告失效，修正后显式应用恢复', async () => {
      const card = await singleObject(page);
      const source = 'old_id,name\n001,Alpha\n';
      const target = 'legacy_id,full_name\n001,Alpha\n';
      await upload(page, card, 'source', source, '联系人-原源.csv');
      await upload(page, card, 'target', target, '联系人-原目标.csv');
      await mapContact(card);
      await declareScope(page);
      await run(page, 'pass');
      const invalid = 'legacy_id,legacy_id\n001,Alpha\n';
      await draft(card, 'target', `\n${invalid}`);
      assert.equal(await page.locator('#result-status').count(), 0);
      await card.locator('[data-action="add-field"]').click();
      await assertDraft(card, 'target', `\n${invalid}`);
      await card.locator('[data-action="remove-field"]').last().click();
      await assertDraft(card, 'target', `\n${invalid}`);
      await draft(card, 'target', invalid);
      await assertUnapplied(page);
      await card.locator('[data-action="parse-paste"][data-side="target"]').click();
      await page.waitForFunction(() => !document.querySelector('#run-audit').disabled);
      await page.locator('#error:not([hidden])').waitFor();
      assert.match(await page.locator('#error').textContent(), /重复表头/);
      await assertDraft(card, 'target', invalid);
      assert.ok(!(await card.locator('.file-box').nth(1).locator('.file-info').textContent()).includes('联系人-原目标.csv'), '失败后不能保留旧材料为有效输入');
      await assertUnapplied(page);
      await draft(card, 'target', 'legacy_id,full_name\n001,Revised\n');
      await applyDraft(page, card, 'target');
      await run(page, 'fail');
      const changed = JSON.parse((await download(page, '#export-json', directory, 'corrected-draft.json')).text);
      assert.equal(changed.config.objects[0].target.rows[0].full_name, 'Revised');
      assert.ok(changed.issues.some(issue => issue.target === 'Revised'));
      await draft(card, 'target', target);
      await applyDraft(page, card, 'target');
      await run(page, 'pass');
    });
    await t.test('上传失败保留双侧草稿，上传成功只替换本侧且草稿错误可恢复', async () => {
      const card = await singleObject(page);
      const source = 'old_id,name\n001,Alpha\n';
      const target = 'legacy_id,full_name\n001,Alpha\n';
      await draft(card, 'source', source);
      await draft(card, 'target', target);
      await card.locator('input[type=file][data-side="source"]').setInputFiles({ name: '失败上传.csv', mimeType: 'text/csv', buffer: Buffer.from('id,id\n1,2') });
      await page.waitForFunction(() => !document.querySelector('#run-audit').disabled);
      await page.locator('#error:not([hidden])').waitFor();
      assert.match(await page.locator('#error').textContent(), /重复表头/);
      await assertDraft(card, 'source', source);
      await assertDraft(card, 'target', target);
      await assertUnapplied(page);
      await upload(page, card, 'source', source, '恢复上传.csv');
      await assertDraft(card, 'source', '');
      await assertDraft(card, 'target', target);
      assert.match(await card.locator('.file-box').nth(0).locator('.file-info').textContent(), /恢复上传.csv/);
      await assertUnapplied(page);
      await applyDraft(page, card, 'target');
      await mapContact(card);
      await declareScope(page);
      await run(page, 'pass');
      const report = JSON.parse((await download(page, '#export-json', directory, 'upload-draft-recovery.json')).text);
      assert.ok(report.inputs.some(input => input.side === 'source' && input.name === '恢复上传.csv'));
      assert.ok(report.inputs.some(input => input.side === 'target' && input.name === '粘贴 CSV'));
      assert.equal(report.config.objects[0].source.rows[0].old_id, '001');
      await draft(card, 'target', '');
      await card.locator('[data-action="add-field"]').click();
      await assertDraft(card, 'target', '');
      await card.locator('[data-action="remove-field"]').last().click();
      await assertUnapplied(page);
      await upload(page, card, 'target', target, '目标-清空后重新上传.csv');
      await assertDraft(card, 'target', '');
      await run(page, 'pass');
      await page.evaluate(() => {
        globalThis.__originalArrayBuffer = Blob.prototype.arrayBuffer;
        Blob.prototype.arrayBuffer = function () { const self = this; return new Promise(resolve => { globalThis.__releaseSlowRead = resolve; }).then(() => globalThis.__originalArrayBuffer.call(self)); };
      });
      await card.locator('input[type=file][data-side="source"]').setInputFiles({ name: '迟到旧材料.csv', mimeType: 'text/csv', buffer: Buffer.from('old_id,name\n001,迟到材料\n') });
      assert.equal(await page.locator('#run-audit').isDisabled(), true);
      await draft(card, 'source', source);
      assert.equal(await page.locator('#run-audit').isDisabled(), true, '迟到读取应仍未完成');
      await page.evaluate(() => globalThis.__releaseSlowRead());
      await page.waitForFunction(() => !document.querySelector('#run-audit').disabled);
      await page.evaluate(() => { Blob.prototype.arrayBuffer = globalThis.__originalArrayBuffer; delete globalThis.__originalArrayBuffer; delete globalThis.__releaseSlowRead; });
      await assertDraft(card, 'source', source);
      assert.match(await card.locator('.file-box').nth(0).locator('.file-info').textContent(), /尚未应用/);
      await assertUnapplied(page);
      await applyDraft(page, card, 'source');
      await run(page, 'pass');
      const latest = JSON.parse((await download(page, '#export-json', directory, 'late-upload-draft.json')).text);
      assert.equal(latest.config.objects[0].source.rows[0].name, 'Alpha');
      assert.ok(!latest.inputs.some(input => input.name === '迟到旧材料.csv'), '迟到读取不能覆盖用户随后输入的草稿');
    });
    assert.deepEqual(errors, [], '浏览器不应产生未捕获运行错误');
  } finally {
    await context.close();
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});
