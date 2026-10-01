import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = join(root, 'test-artifacts');
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(root, '.cache/ms-playwright');
process.env.TMPDIR = join(root, '.cache/tmp');
if (process.platform === 'linux') {
  process.env.FONTCONFIG_FILE = join(root, 'tests/fonts.conf');
  process.env.LD_LIBRARY_PATH = [join(root, '.cache/linux-libs/usr/lib/x86_64-linux-gnu'), process.env.LD_LIBRARY_PATH]
    .filter(Boolean).join(':');
}
const { chromium } = await import('playwright');
await mkdir(artifacts, { recursive: true });
await mkdir(process.env.TMPDIR, { recursive: true });

const server = spawn('python3', ['-u', '-m', 'http.server', '0', '--bind', '127.0.0.1'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stderr.on('data', (chunk) => { serverLog += chunk; });
let browser;
let page;
const checks = [];
const errors = [];
const requests = [];
const ui = {
  before: '#before-file', after: '#after-file', key: '#key-column',
  compare: '#compare', sample: '#load-example', export: '#download',
  results: '#report', error: '#input-errors', next: '#next-page',
};

async function check(name, run) {
  const start = performance.now();
  await run();
  checks.push({ name, passed: true, milliseconds: Math.round(performance.now() - start) });
  console.log(`PASS ${name}`);
}

function csvFile(name, text) {
  return { name, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') };
}

async function downloadReport(name) {
  const pending = page.waitForEvent('download');
  await page.locator(ui.export).click();
  const download = await pending;
  const target = join(artifacts, name);
  await download.saveAs(target);
  return JSON.parse(await readFile(target, 'utf8'));
}

async function enabled(selector) {
  await page.waitForFunction((value) => document.querySelector(value)?.disabled === false, selector);
}

async function compare(key) {
  await enabled(ui.key);
  await page.locator(ui.key).selectOption({ label: key });
  await page.locator(ui.compare).click();
  await enabled(ui.export);
}

async function upload(before, after) {
  await page.locator(ui.before).setInputFiles(before);
  await page.locator(ui.after).setInputFiles(after);
}

async function assertInvalid() {
  assert.equal(await page.locator(ui.export).isDisabled(), true);
  assert.equal(await page.locator(ui.results).isVisible(), false);
}

async function screenshot(name) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: join(artifacts, name), fullPage: true, animations: 'disabled' });
}

try {
  const port = await new Promise((resolvePort, reject) => {
    const timer = setTimeout(() => reject(new Error(`本地服务器启动超时：${serverLog}`)), 10000);
    server.once('error', (error) => { clearTimeout(timer); reject(error); });
    server.once('exit', (code) => { clearTimeout(timer); reject(new Error(`服务器退出 ${code}: ${serverLog}`)); });
    let output = '';
    server.stdout.on('data', (chunk) => {
      output += chunk;
      const found = output.match(/port (\d+)/);
      if (found) { clearTimeout(timer); resolvePort(Number(found[1])); }
    });
  });
  const origin = `http://127.0.0.1:${port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true });
  context.on('request', (request) => requests.push({ url: request.url(), method: request.method() }));
  page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);

  // 下方检查从用户操作入口开始，不直接调用应用的核心函数。

  await check('初始状态与示例完整闭环', async () => {
    assert.equal(await page.locator(ui.compare).isDisabled(), true);
    assert.equal(await page.locator(ui.export).isDisabled(), true);
    await screenshot('desktop-empty.png');
    await page.locator(ui.sample).click();
    await enabled(ui.key);
    assert.equal(await page.locator(ui.compare).isDisabled(), true, '示例仍需用户明确选键');
    await compare('编号');
    const report = await downloadReport('sample-report.json');
    assert.deepEqual(report.counts, { added: 1, deleted: 1, modified: 1, unchanged: 1 });
    assert.deepEqual(report.modified[0].changes, [{ column: '数量', before: '8', after: '10' }]);
    assert.equal(Object.hasOwn(report, 'unchanged'), false);
    await page.locator('[data-filter="modified"]').click();
    const visible = await page.locator(ui.results).innerText();
    assert.match(visible, /数量/);
    assert.match(visible, /8/);
    assert.match(visible, /10/);
    await screenshot('desktop-result.png');
  });

  await check('手机布局与可操作按钮', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
      '页面不应在手机尺寸产生横向溢出');
    await screenshot('mobile-result.png');
    await page.locator(ui.export).focus();
    assert.equal(await page.locator(ui.export).evaluate((node) => node === document.activeElement), true);
    await page.setViewportSize({ width: 1440, height: 1080 });
  });

  await check('换键与换文件后旧结果立即失效', async () => {
    await page.locator(ui.key).selectOption({ label: '名称' });
    await assertInvalid();
    await compare('编号');
    await page.locator(ui.after).setInputFiles(csvFile('new.csv', '编号,名称,数量,备注\nZ,新记录,1,新输入'));
    await assertInvalid();
    await compare('编号');
    const report = await downloadReport('replaced-report.json');
    assert.deepEqual(report.counts, { added: 1, deleted: 3, modified: 0, unchanged: 0 });
  });

  await check('非法 UTF-8、重复键与超限阻断且无过期导出', async () => {
    await page.locator(ui.after).setInputFiles({ name: 'bad-utf8.csv', mimeType: 'text/csv', buffer: Buffer.from([0xff]) });
    await page.locator(ui.error).waitFor({ state: 'visible' });
    assert.match(await page.locator(ui.error).innerText(), /UTF-8/);
    await assertInvalid();
    await upload(csvFile('before.csv', 'id,value\nA,1'), csvFile('duplicates.csv', 'id,value\nA,2\nA,3'));
    await enabled(ui.key);
    await page.locator(ui.key).selectOption({ label: 'id' });
    await page.locator(ui.compare).click();
    await page.locator(ui.error).waitFor({ state: 'visible' });
    const message = await page.locator(ui.error).innerText();
    assert.match(message, /duplicates.csv/);
    assert.match(message, /逻辑记录 2/);
    assert.match(message, /逻辑记录 3/);
    await assertInvalid();
    await page.locator(ui.after).setInputFiles({ name: 'too-large.csv', mimeType: 'text/csv', buffer: Buffer.alloc(2_097_153, 65) });
    await page.locator(ui.error).waitFor({ state: 'visible' });
    assert.match(await page.locator(ui.error).innerText(), /上限|2 MiB/);
    await assertInvalid();
  });

  await check('表头差异定位双方文件与逻辑记录', async () => {
    await upload(csvFile('schema-old.csv', 'id,value\nA,1'), csvFile('schema-new.csv', 'value,id\n1,A'));
    await page.locator(ui.error).waitFor({ state: 'visible' });
    const message = await page.locator(ui.error).innerText();
    assert.match(message, /schema-old.csv/);
    assert.match(message, /schema-new.csv/);
    assert.match(message, /逻辑记录 1/);
    assert.equal(await page.locator(ui.compare).isDisabled(), true);
    await assertInvalid();
  });

  await check('分页及分类筛选不截断完整报告', async () => {
    const after = 'id,value\n' + Array.from({ length: 63 }, (_, index) => `K${index},值${index}`).join('\n');
    await upload(csvFile('empty.csv', 'id,value'), csvFile('many.csv', after));
    await compare('id');
    await page.locator('[data-filter="added"]').click();
    await page.locator(ui.next).click();
    const secondPage = await downloadReport('page-two-report.json');
    assert.equal(secondPage.added.length, 63);
    assert.equal(secondPage.added.at(-1).key, 'K62');
    await page.locator('[data-filter="deleted"]').click();
    const filtered = await downloadReport('filtered-report.json');
    assert.deepEqual(filtered, secondPage);
  });

  await check('HTML、公式及 prototype 名称安全呈现且保留原值', async () => {
    const hostile = '<img src="https://invalid.test/x" onerror="window.__injected=1">';
    const quote = (value) => `"${value.replaceAll('"', '""')}"`;
    await upload(csvFile('text-before.csv', '__proto__,constructor\nconstructor,old'),
      csvFile('text-after.csv', `__proto__,constructor\nconstructor,${quote(hostile)}\n__proto__,=1+1`));
    await compare('__proto__');
    await page.locator('[data-filter="modified"]').click();
    assert.ok((await page.locator(ui.results).innerText()).includes(hostile));
    assert.equal(await page.locator('img[src="https://invalid.test/x"]').count(), 0);
    assert.equal(await page.evaluate(() => window.__injected), undefined);
    const report = await downloadReport('literal-report.json');
    assert.equal(report.modified[0].after[1], hostile);
    assert.equal(report.added[0].values[1], '=1+1');
  });

  await check('快速更换文件忽略较慢的过期读取', async () => {
    await page.evaluate(() => {
      const original = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = async function (...args) {
        if (this.name === 'slow.csv') {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
          window.__slowFinished = true;
        }
        return original.apply(this, args);
      };
    });
    await page.locator(ui.before).setInputFiles(csvFile('slow.csv', 'id,value\nBAD,old'));
    await page.locator(ui.before).setInputFiles(csvFile('fast.csv', 'id,value\nA,current'));
    await page.locator(ui.after).setInputFiles(csvFile('current.csv', 'id,value\nA,current'));
    await compare('id');
    await page.waitForFunction(() => window.__slowFinished === true);
    const report = await downloadReport('race-report.json');
    assert.equal(report.inputs.before.name, 'fast.csv');
    assert.deepEqual(report.counts, { added: 0, deleted: 0, modified: 0, unchanged: 1 });
  });

  await check('仅表头数据与重载清空状态', async () => {
    await upload(csvFile('empty-before.csv', 'id,value\n'), csvFile('empty-after.csv', 'id,value\r\n'));
    await compare('id');
    const report = await downloadReport('empty-report.json');
    assert.deepEqual(report.counts, { added: 0, deleted: 0, modified: 0, unchanged: 0 });
    await page.reload();
    assert.equal(await page.locator(ui.before).evaluate((node) => node.files.length), 0);
    assert.equal(await page.locator(ui.after).evaluate((node) => node.files.length), 0);
    await assertInvalid();
  });

  await check('键盘载入示例后手动输入覆盖迟到示例', async () => {
    const routes = [];
    let signalStarted;
    let release;
    const started = new Promise((resolveStarted) => { signalStarted = resolveStarted; });
    const barrier = new Promise((resolveBarrier) => { release = resolveBarrier; });
    const handler = async (route) => {
      routes.push(route);
      if (routes.length === 2) signalStarted();
      await barrier;
      await route.continue();
    };
    await page.route('**/examples/*.csv', handler);
    try {
      await page.locator(ui.sample).focus();
      await page.keyboard.press('Enter');
      await Promise.race([started, new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error('示例请求没有开始')), 5000);
        timer.unref();
      })]);
      await upload(csvFile('manual-old.csv', 'id,value\nA,manual'), csvFile('manual-new.csv', 'id,value\nA,manual'));
      await compare('id');
      const responses = ['before', 'after'].map((side) => page.waitForResponse((response) => response.url().endsWith(`/examples/${side}.csv`)));
      release();
      await Promise.all((await Promise.all(responses)).map((response) => response.finished()));
      const report = await downloadReport('sample-race-report.json');
      assert.equal(report.inputs.before.name, 'manual-old.csv');
      assert.equal(report.inputs.after.name, 'manual-new.csv');
      assert.deepEqual(report.counts, { added: 0, deleted: 0, modified: 0, unchanged: 1 });
    } finally {
      release();
      await page.unroute('**/examples/*.csv', handler);
    }
  });

  assert.deepEqual(errors, [], '浏览器不应发生未处理的脚本错误');
  assert.equal(requests.some(({ url }) => !url.startsWith(`${origin}/`) && url !== origin), false,
    '应用不应发起外部请求');
  assert.equal(requests.some(({ method }) => method !== 'GET'), false, '文件比较不应上传数据');
  await writeFile(join(artifacts, 'browser-results.json'), JSON.stringify({
    passed: true, browser: `Chromium ${browser.version()}`, checks, errors, requests,
  }, null, 2));
  console.log(`浏览器检查通过：${checks.length} 项；Chromium ${browser.version()}`);
} catch (error) {
  if (page) await page.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(join(artifacts, 'browser-results.json'), JSON.stringify({
    passed: false, checks, errors, requests, failure: error.stack,
  }, null, 2));
  throw error;
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
