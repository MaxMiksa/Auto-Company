import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const productRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const storageKey = 'dual-flavor-table-v1';
let browser;
let server;
let origin;

function loadPlaywright() {
  for (const manifest of [resolve(productRoot, 'package.json'), resolve(productRoot, '../../scripts/media/package.json')]) {
    try { return createRequire(manifest)('playwright'); } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error;
    }
  }
  throw new Error('缺少 Playwright；请在产品目录 npm install，或安装框架 scripts/media 已有依赖。浏览器检查未跳过。');
}

before(async () => {
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const target = resolve(productRoot, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!target.startsWith(`${productRoot}${sep}`)) {
        response.writeHead(403).end();
        return;
      }
      const content = await readFile(target);
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
      response.writeHead(200, { 'Content-Type': mime[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(content);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolveListening, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListening);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  const { chromium } = loadPlaywright();
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  try { await browser?.close(); } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise(resolveClosing => server.close(resolveClosing));
    }
  }
});

async function pageFor(t, options = {}, initScript) {
  const context = await browser.newContext({ acceptDownloads: true, ...options });
  context.setDefaultTimeout(10000);
  t.after(() => context.close());
  if (initScript) await context.addInitScript(initScript);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], '用户任务不应产生未处理的页面异常'));
  await page.goto(origin);
  await page.locator('#plan-title').waitFor({ state: 'visible' });
  assert.ok((await page.locator('#plan-title').textContent()).trim().length > 0);
  return page;
}

async function stateOf(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
}

async function downloadFrom(page, selector) {
  const downloadPromise = page.waitForEvent('download');
  await page.locator(selector).click();
  const download = await downloadPromise;
  assert.equal(await download.failure(), null);
  const path = await download.path();
  assert.ok(path, '浏览器应产生真实下载文件');
  return { name: download.suggestedFilename(), content: await readFile(path, 'utf8') };
}

function assertWaterInstructions(steps, total, label) {
  const batches = steps.filter(step => step.title.startsWith('共享主菜：'));
  assert.equal(batches.length, Math.ceil(total / 2), `${label} 每批最多2份`);
  let water = 0;
  batches.forEach((step, index) => {
    const servings = Math.min(2, total - index * 2);
    assert.equal(step.title, `共享主菜：第${index + 1}/${batches.length}批`);
    assert.match(step.detail, new RegExp(`第${index + 1}批做${servings}份：`));
    assert.ok(step.detail.includes(`各占总量的${servings}/${total}。`));
    const actions = step.detail.split(/[。；！？]/).filter(sentence => /主菜(?:用)?水/.test(sentence) && /加|下|倒|注|补/.test(sentence));
    assert.equal(actions.length, 1, `${label} 第${index + 1}批只能加一次主菜水：${step.detail}`);
    assert.equal((actions[0].match(/主菜(?:用)?水/g) || []).length, 1, `${label} 同一句也不能重复加水`);
    const amount = actions[0].match(/主菜(?:用)?水[（(](\d+(?:\.\d+)?)毫升[）)]/);
    assert.ok(amount, `${label} 加水动作需有明确的本批水量`);
    assert.equal(Number(amount[1]), 60 * servings, `${label} 第${index + 1}批水量`);
    water += Number(amount[1]);
  });
  assert.equal(water, 60 * total, `${label} 各批加水总量等于采购主菜用水`);
}

async function importInto(page, name, content) {
  await page.evaluate(() => {
    window.__importNotice = new Promise((resolveNotice, rejectNotice) => {
      const timeout = setTimeout(() => { observer.disconnect(); rejectNotice(new Error('导入未在十秒内给出状态')); }, 10000);
      const observer = new MutationObserver(() => {
        const text = document.querySelector('#message').textContent;
        if (text.trim()) { observer.disconnect(); clearTimeout(timeout); resolveNotice(text); }
      });
      observer.observe(document.querySelector('#message'), { childList: true, characterData: true, subtree: true });
    });
  });
  await page.locator('#import-backup').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(content) });
  return page.evaluate(() => window.__importNotice);
}

test('浏览器完成三份双味整餐并真实下载可执行文本和调用打印', async t => {
  const page = await pageFor(t);
  await page.locator('#max-minutes').fill('90');
  await page.locator('#servings-a').fill('2');
  await page.locator('#servings-b').fill('1');
  await page.locator('#flavor-a').selectOption('mild');
  await page.locator('#flavor-b').selectOption('garlic');
  await page.locator('#generate').click();
  const state = await stateOf(page);
  assert.equal(state.config.servingsA, 2);
  assert.equal(state.config.servingsB, 1);
  assert.equal(state.config.flavorB, 'garlic');
  assert.ok(await page.locator('#shopping-list input[type=checkbox]').count() >= 5);
  assert.ok(await page.locator('#step-list input[type=checkbox]').count() >= 9);
  const text = await downloadFrom(page, '#export-text');
  assert.match(text.name, /\.txt$/i);
  assert.match(text.content, /采购|购物/);
  assert.match(text.content, /A组/);
  assert.match(text.content, /B组/);
  assert.match(text.content, /蒜/);
  assert.match(text.content, /分盘|分成|盛出|分到/);
  await page.evaluate(() => { window.print = () => { window.__printCalls = (window.__printCalls || 0) + 1; }; });
  await page.locator('#print-plan').click();
  assert.equal(await page.evaluate(() => window.__printCalls), 1);
});

for (const variant of [
  { label: '原鸡肉', vegetarian: false, soyFree: false, protein: '去骨鸡腿肉' },
  { label: '整桌素食豆腐', vegetarian: true, soyFree: false, protein: '原味硬豆腐' },
  { label: '素食且排除大豆鹰嘴豆', vegetarian: true, soyFree: true, protein: '熟鹰嘴豆' },
]) {
  test(`玉米${variant.label}在真实网页和下载txt中的2至6份加水步骤一致`, async t => {
    const page = await pageFor(t);
    await page.locator('#max-minutes').fill('90');
    await page.locator('#max-minutes').dispatchEvent('change');
    if (variant.vegetarian) await page.locator('#vegetarian').check();
    if (variant.soyFree) {
      await page.locator('.exclusion-panel summary').click();
      await page.locator('input[name=exclusions][value=soy]').check();
    }
    for (const [servingsA, servingsB] of [[1, 1], [2, 1], [2, 2], [4, 1], [4, 2]]) {
      const total = servingsA + servingsB;
      const label = `${variant.label} A${servingsA}/B${servingsB}`;
      await page.locator('#servings-a').fill(String(servingsA));
      await page.locator('#servings-b').fill(String(servingsB));
      await page.locator('#servings-b').dispatchEvent('change');
      await page.locator('input[name=menu][value=corn-chicken]').check();
      await page.locator('#generate').click();
      const state = await stateOf(page);
      assert.equal(state.config.menuId, 'corn-chicken');
      assert.equal(state.config.servingsA, servingsA);
      assert.equal(state.config.servingsB, servingsB);
      assert.equal(state.config.vegetarian, variant.vegetarian);
      assert.deepEqual(state.config.exclusions, variant.soyFree ? ['soy'] : []);
      const shopping = await page.locator('#shopping-list .ingredient-row').evaluateAll(rows => rows.map(row => ({
        name: row.querySelector('strong').textContent,
        quantity: row.querySelector('.ingredient-quantity').textContent,
      })));
      assert.ok(shopping.some(item => item.name === variant.protein), `${label} 网页采购采用预期蛋白`);
      const waterRows = shopping.filter(item => item.name === '主菜用水');
      assert.equal(waterRows.length, 1);
      assert.equal(waterRows[0].quantity.replace(/\s/g, ''), `${60 * total}毫升`, `${label} 网页采购总水量`);
      const actualSteps = await page.locator('#step-list .step-row').evaluateAll(rows => rows.map(row => ({
        title: row.querySelector('.step-title').textContent,
        detail: row.querySelector('p').textContent,
      })));
      assertWaterInstructions(actualSteps, total, `${label} 实际网页`);
      const exported = await downloadFrom(page, '#export-text');
      assert.match(exported.name, /corn-chicken\.txt$/i);
      assert.match(exported.content, new RegExp(`^- 主菜用水 ${60 * total}毫升$`, 'm'));
      const lines = exported.content.split('\n');
      const exportedSteps = lines.flatMap((line, index) => {
        const heading = line.match(/^\d+\. (.+)（约\d+(?:\.\d+)?分钟）$/);
        return heading ? [{ title: heading[1], detail: lines[index + 1] }] : [];
      });
      assert.deepEqual(exportedSteps, actualSteps, `${label} 下载文件每一步的顺序、标题和操作文字均应与网页一致`);
      assertWaterInstructions(exportedSteps, total, `${label} 真实下载txt`);
    }
  });
}

test('采购与烹饪进度重载保留，重新生成取消保留、确认后才清空', async t => {
  const page = await pageFor(t);
  const shopping = page.locator('#shopping-list input[type=checkbox]').first();
  const step = page.locator('#step-list input[type=checkbox]').first();
  const shoppingId = await shopping.getAttribute('data-id');
  const stepId = await step.getAttribute('data-id');
  await shopping.check();
  await step.check();
  await page.reload();
  assert.equal(await page.locator(`#shopping-list input[data-id="${shoppingId}"]`).isChecked(), true);
  assert.equal(await page.locator(`#step-list input[data-id="${stepId}"]`).isChecked(), true);
  const saved = await stateOf(page);
  const title = await page.locator('#plan-title').textContent();
  await page.locator('#max-minutes').fill('90');
  await page.locator('#servings-a').fill('2');
  let dismissed = false;
  page.once('dialog', async dialog => { dismissed = true; assert.equal(dialog.type(), 'confirm'); await dialog.dismiss(); });
  await page.locator('#generate').click();
  assert.equal(dismissed, true, '已有进度重新生成必须确认');
  assert.deepEqual(await stateOf(page), saved);
  assert.equal(await page.locator('#plan-title').textContent(), title);
  assert.equal(await page.locator(`#shopping-list input[data-id="${shoppingId}"]`).isChecked(), true);
  let accepted = false;
  page.once('dialog', async dialog => { accepted = true; await dialog.accept(); });
  await page.locator('#generate').click();
  assert.equal(accepted, true);
  const fresh = await stateOf(page);
  assert.equal(fresh.config.servingsA, 2);
  assert.deepEqual(fresh.shopping, []);
  assert.deepEqual(fresh.completed, []);
  assert.equal(await page.locator('#shopping-list input:checked').count(), 0);
  assert.equal(await page.locator('#step-list input:checked').count(), 0);
});

test('真实 JSON 备份恢复方案与两类进度，损坏存储可恢复且错误导入不覆盖已有数据', async t => {
  const page = await pageFor(t);
  page.on('dialog', dialog => dialog.accept());
  await page.locator('#flavor-b').selectOption('garlic');
  await page.locator('#generate').click();
  await page.locator('#shopping-list input[type=checkbox]').first().check();
  await page.locator('#step-list input[type=checkbox]').first().check();
  const original = await stateOf(page);
  const backup = await downloadFrom(page, '#backup');
  assert.match(backup.name, /\.json$/i);
  const parsed = JSON.parse(backup.content);
  assert.equal(parsed.app, 'dual-flavor-table');
  assert.equal(parsed.version, 1);
  assert.deepEqual(parsed.config, original.config);
  assert.deepEqual(parsed.shopping, original.shopping);
  assert.deepEqual(parsed.completed, original.completed);
  await page.locator('#reset-progress').click();
  assert.equal(await page.locator('#shopping-list input:checked').count(), 0);
  assert.equal(await page.locator('#step-list input:checked').count(), 0);
  await page.evaluate(key => localStorage.setItem(key, '{损坏-json'), storageKey);
  await page.reload();
  await page.locator('#plan-title').waitFor({ state: 'visible' });
  assert.match(await page.locator('#message').textContent(), /恢复|损坏|读取|重置/);
  await importInto(page, backup.name, backup.content);
  await page.waitForFunction(({ key, config }) => localStorage.getItem(key) && JSON.parse(localStorage.getItem(key)).config.flavorB === config.flavorB, { key: storageKey, config: original.config });
  assert.deepEqual(await stateOf(page), original);
  await page.reload();
  assert.equal(await page.locator('#shopping-list input:checked').count(), original.shopping.length);
  assert.equal(await page.locator('#step-list input:checked').count(), original.completed.length);
  const invalidBackups = [
    '{bad-json',
    JSON.stringify({ app: 'other-app', version: 1, config: original.config }),
    JSON.stringify({ ...parsed, config: { ...parsed.config, servingsA: 99 } }),
    JSON.stringify({ ...parsed, completed: ['unknown-step'] }),
    JSON.stringify({ ...parsed, completed: [original.completed[0], original.completed[0]] }),
    JSON.stringify({ ...parsed, shopping: [original.shopping[0], original.shopping[0]] }),
    JSON.stringify({ ...parsed, padding: 'x'.repeat(100001) }),
  ];
  for (const content of invalidBackups) {
    const notice = await importInto(page, 'invalid.json', content);
    assert.match(notice, /失败|无效|不是有效|错误|不合法|不支持|无法|格式|份数|不一致|过大/);
    assert.deepEqual(await stateOf(page), original, '错误备份不应覆盖已有方案和进度');
  }
});

test('UI 筛选素菜和真实食材，时间无匹配时说明原因并保留现有方案', async t => {
  const page = await pageFor(t);
  await page.locator('#flavor-b').selectOption('mild');
  await page.locator('#vegetarian').check();
  await page.locator('.exclusion-panel summary').click();
  await page.locator('input[name=exclusions][value=garlic]').check();
  await page.locator('input[name=exclusions][value=soy]').check();
  await page.locator('input[name=exclusions][value=mushroom]').check();
  await page.locator('input[name=menu][value=mushroom-tofu]').check();
  await page.locator('#generate').click();
  const state = await stateOf(page);
  assert.equal(state.config.vegetarian, true);
  assert.ok(state.config.exclusions.includes('garlic'));
  assert.ok(state.config.exclusions.includes('soy'));
  assert.ok(state.config.exclusions.includes('mushroom'));
  const actualIngredients = (await page.locator('#shopping-list strong').allTextContents()).join(' ');
  assert.doesNotMatch(actualIngredients, /鸡肉|鸡胸|豆腐|蘑菇|蒜粉|大蒜/);
  assert.match(actualIngredients, /鹰嘴豆/);
  const previousTitle = await page.locator('#plan-title').textContent();
  await page.locator('#max-minutes').fill('20');
  await page.locator('#max-minutes').dispatchEvent('change');
  await page.locator('#menu-empty').waitFor({ state: 'visible' });
  assert.ok((await page.locator('#menu-empty').textContent()).trim().length > 0);
  assert.equal(await page.locator('#plan-title').textContent(), previousTitle);
  assert.deepEqual(await stateOf(page), state);
});

test('六份可生成，超出总份数时不会破坏已保存方案', async t => {
  const page = await pageFor(t);
  await page.locator('#max-minutes').fill('90');
  await page.locator('#servings-a').fill('4');
  await page.locator('#servings-b').fill('2');
  await page.locator('#generate').click();
  const saved = await stateOf(page);
  assert.equal(saved.config.servingsA + saved.config.servingsB, 6);
  await page.locator('#servings-b').fill('3');
  await page.locator('#servings-b').dispatchEvent('change');
  assert.equal(await page.locator('#generate').isDisabled(), true);
  assert.deepEqual(await stateOf(page), saved);
  assert.match(await page.locator('#message').textContent(), /6|六|份数/);
  await page.locator('#servings-b').fill('2');
  await page.locator('#servings-b').dispatchEvent('change');
  assert.equal(await page.locator('#generate').isEnabled(), true);
  assert.deepEqual(await stateOf(page), saved);
});

test('浏览器拒绝保存时明确提示并可下载完整备份，不阻断当前烹饪进度', async t => {
  const page = await pageFor(t, {}, () => {
    Storage.prototype.setItem = () => { throw new DOMException('synthetic storage failure', 'QuotaExceededError'); };
  });
  await page.locator('#shopping-list input[type=checkbox]').first().check();
  await page.locator('#step-list input[type=checkbox]').first().check();
  assert.match(await page.locator('#message').textContent(), /无法保存|不能保存|备份/);
  assert.equal(await page.locator('#shopping-list input:checked').count(), 1);
  assert.equal(await page.locator('#step-list input:checked').count(), 1);
  const backup = JSON.parse((await downloadFrom(page, '#backup')).content);
  assert.equal(backup.shopping.length, 1);
  assert.equal(backup.completed.length, 1);
  assert.equal(backup.app, 'dual-flavor-table');
});

test('390px 手机布局无横向溢出，键盘可提交并逐项勾选', async t => {
  const page = await pageFor(t, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  await page.locator('#max-minutes').focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('90');
  await page.locator('#servings-a').focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('2');
  await page.locator('#generate').focus();
  assert.equal(await page.locator('#generate').evaluate(element => document.activeElement === element), true);
  await page.keyboard.press('Enter');
  assert.equal((await stateOf(page)).config.servingsA, 2);
  const shopping = page.locator('#shopping-list input[type=checkbox]').first();
  await shopping.focus();
  await page.keyboard.press('Space');
  assert.equal(await shopping.isChecked(), true);
  const step = page.locator('#step-list input[type=checkbox]').first();
  await step.focus();
  await page.keyboard.press('Space');
  assert.equal(await step.isChecked(), true);
  const reached = new Set();
  await page.locator('#servings-a').focus();
  for (let index = 0; index < 80; index += 1) {
    await page.keyboard.press('Tab');
    reached.add(await page.evaluate(() => document.activeElement.id));
    if (['generate', 'export-text', 'print-plan', 'backup', 'reset-progress'].every(id => reached.has(id))) break;
  }
  for (const id of ['generate', 'export-text', 'print-plan', 'backup', 'reset-progress']) {
    assert.ok(reached.has(id), `${id} 应可使用 Tab 实际到达`);
    assert.equal(await page.locator(`#${id}`).evaluate(element => element.tabIndex >= 0), true, `${id} 应可通过键盘到达`);
    assert.ok((await page.locator(`#${id}`).textContent()).trim() || await page.locator(`#${id}`).getAttribute('aria-label'));
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
});
