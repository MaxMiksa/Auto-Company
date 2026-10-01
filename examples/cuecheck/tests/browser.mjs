import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const toolsRoot = resolve(process.env.CUECHECK_TEST_TOOLS || root);
const artifacts = join(root, 'test-artifacts');
const cache = join(root, '.cache');
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(toolsRoot, '.cache/ms-playwright');
process.env.TMPDIR = join(cache, 'tmp');
process.env.XDG_CACHE_HOME = cache;
await Promise.all([mkdir(artifacts, { recursive: true }), mkdir(process.env.TMPDIR, { recursive: true }),
  mkdir(join(cache, 'fontconfig'), { recursive: true })]);
if (process.platform === 'linux') {
  const xml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const config = join(cache, 'fonts-active.conf');
  await writeFile(config, `<?xml version="1.0"?>\n<fontconfig>\n` +
    `  <include>${xml(join(root, 'tests/fonts.conf'))}</include>\n` +
    `  <dir>${xml(join(toolsRoot, '.cache/linux-libs/usr/share/fonts'))}</dir>\n` +
    `  <cachedir>${xml(join(cache, 'fontconfig'))}</cachedir>\n</fontconfig>\n`);
  process.env.FONTCONFIG_FILE = config;
  process.env.LD_LIBRARY_PATH = [join(toolsRoot, '.cache/linux-libs/usr/lib/x86_64-linux-gnu'), process.env.LD_LIBRARY_PATH]
    .filter(Boolean).join(':');
}
const { chromium } = await import(pathToFileURL(join(toolsRoot, 'node_modules/playwright/index.mjs')).href);
const server = spawn('python3', ['-u', '-m', 'http.server', '0', '--bind', '127.0.0.1'], {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stderr.on('data', (chunk) => { serverLog += chunk; });
let browser;
let page;
const checks = [];
const errors = [];
const consoleErrors = [];
const requests = [];
const cleanSrt = '10\n00:00:01,000 --> 00:00:03,000\n第一条字幕。\n\n20\n00:00:05,000 --> 00:00:07,000\n第二条字幕。\n';
const file = (name, text) => ({ name, mimeType: 'application/x-subrip', buffer: Buffer.from(text, 'utf8') });

async function check(name, run) {
  const start = performance.now();
  await run();
  checks.push({ name, passed: true, milliseconds: Math.round(performance.now() - start) });
  console.log(`PASS ${name}`);
}

async function enabled(id) {
  await page.waitForFunction((selector) => document.querySelector(selector)?.disabled === false, `#${id}`);
}

async function upload(name, text) {
  await page.locator('#file-input').setInputFiles(file(name, text));
  await page.waitForFunction((value) => document.querySelector('#file-name')?.textContent.includes(value), name);
}

async function download(id, target) {
  await enabled(id);
  const pending = page.waitForEvent('download');
  await page.locator(`#${id}`).click();
  const result = await pending;
  await result.saveAs(join(artifacts, target));
  return readFile(join(artifacts, target), 'utf8');
}

async function invalidInput() {
  await page.locator('#error-banner').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#download-srt').isDisabled(), true);
  assert.equal(await page.locator('#download-report').isDisabled(), true);
  assert.equal(await page.locator('.cue-row').count(), 0, '无效输入必须清除旧字幕');
}

async function screenshot(name) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: join(artifacts, name), fullPage: true, animations: 'disabled' });
}

async function confirmAction(accept, run) {
  const pending = new Promise((resolveDialog, reject) => {
    const timeout = setTimeout(() => reject(new Error('未出现保护未应用草稿的确认框')), 5000);
    page.once('dialog', async (dialog) => {
      clearTimeout(timeout);
      try {
        assert.equal(dialog.type(), 'confirm');
        if (accept) await dialog.accept();
        else await dialog.dismiss();
        resolveDialog();
      } catch (error) { reject(error); }
    });
  });
  await run();
  await pending;
}

try {
  const port = await new Promise((resolvePort, reject) => {
    const timeout = setTimeout(() => reject(new Error(`本地服务启动超时：${serverLog}`)), 10000);
    server.once('error', (error) => { clearTimeout(timeout); reject(error); });
    server.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`本地服务退出 ${code}: ${serverLog}`)); });
    let output = '';
    server.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/port (\d+)/);
      if (match) { clearTimeout(timeout); resolvePort(Number(match[1])); }
    });
  });
  const origin = `http://127.0.0.1:${port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true });
  context.on('request', (request) => requests.push({ url: request.url(), method: request.method() }));
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto(origin);

  await check('空态、问题样例与定位编辑', async () => {
    assert.equal(await page.locator('#download-srt').isDisabled(), true);
    assert.equal(await page.locator('#download-report').isDisabled(), true);
    await screenshot('desktop-empty.png');
    await page.locator('#load-example').click();
    await enabled('download-report');
    assert.ok(Number(await page.locator('#stat-cues').innerText()) > 0);
    assert.ok(Number(await page.locator('#stat-warnings').innerText()) > 0);
    await page.locator('.cue-row').first().click();
    assert.equal(await page.locator('#editor-form').isVisible(), true);
    assert.ok((await page.locator('#edit-text').inputValue()).length > 0);
    await screenshot('desktop-result.png');
    const report = JSON.parse(await download('download-report', 'problem-report.json'));
    assert.equal(report.stats.cues, Number(await page.locator('#stat-cues').innerText()));
    assert.equal(report.stats.errors, Number(await page.locator('#stat-errors').innerText()));
    assert.equal(report.stats.warnings, Number(await page.locator('#stat-warnings').innerText()));
    assert.ok(report.issues.length > 0);
    assert.ok(report.issues.every((issue) => Number.isInteger(issue.sourceLine) && issue.sourceLine > 0
      && /^\d{2}:\d{2}:\d{2},\d{3}$/.test(issue.startTime)));
    await page.locator('#filter-issues').click();
    assert.ok(await page.locator('.cue-row').count() > 0);
    await page.locator('#filter-all').click();
  });

  await check('390px 手机布局、按钮触达与键盘操作', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
      '手机不应出现横向页面溢出');
    await screenshot('mobile-result.png');
    await page.locator('#load-clean').focus();
    await page.keyboard.press('Enter');
    await enabled('download-srt');
    assert.equal(Number(await page.locator('#stat-errors').innerText()), 0);
    await page.setViewportSize({ width: 1440, height: 1080 });
  });

  await check('编辑草稿阻断下载、应用后重检与实际下载', async () => {
    await upload('edit.srt', cleanSrt);
    await enabled('download-srt');
    await page.locator('.cue-row').first().click();
    await page.locator('#edit-text').fill('已修正的字幕。');
    await page.locator('#edit-end').fill('00:00:04,000');
    assert.equal(await page.locator('#download-srt').isDisabled(), true);
    assert.equal(await page.locator('#download-report').isDisabled(), true);
    assert.ok((await page.locator('#draft-status').innerText()).length > 0);
    await page.locator('#apply-edit').click();
    await enabled('download-srt');
    assert.equal(Number(await page.locator('#stat-errors').innerText()), 0);
    assert.match(await page.locator('.cue-row').first().innerText(), /已修正的字幕/);
    const text = await download('download-srt', 'edited.srt');
    assert.match(text, /^1\n00:00:01,000 --> 00:00:04,000\n已修正的字幕。/);
    assert.match(text, /\n2\n00:00:05,000 --> 00:00:07,000\n第二条字幕。/);
  });

  await check('未应用草稿切换时取消与确认', async () => {
    await page.locator('.cue-row').first().click();
    await page.locator('#edit-text').fill('不可静默丢失的草稿');
    await confirmAction(false, () => page.locator('.cue-row').nth(1).click());
    assert.equal(await page.locator('#edit-text').inputValue(), '不可静默丢失的草稿');
    await confirmAction(true, () => page.locator('.cue-row').nth(1).click());
    assert.equal(await page.locator('#edit-text').inputValue(), '第二条字幕。');
    const text = await download('download-srt', 'discarded-draft.srt');
    assert.equal(text.includes('不可静默丢失的草稿'), false);
    assert.equal(text.includes('已修正的字幕。'), true);
  });

  await check('替换文件保护草稿并可恢复取消后的选择', async () => {
    await page.locator('#edit-text').fill('替换前草稿');
    await confirmAction(false, () => page.locator('#file-input').setInputFiles(file('replace.srt', cleanSrt)));
    assert.match(await page.locator('#file-name').innerText(), /edit.srt/);
    assert.equal(await page.locator('#edit-text').inputValue(), '替换前草稿');
    await confirmAction(true, () => page.locator('#file-input').setInputFiles(file('replace-again.srt', cleanSrt)));
    await enabled('download-srt');
    assert.match(await page.locator('#file-name').innerText(), /replace-again.srt/);
  });

  await check('非正时长不能导出 SRT，修复后恢复', async () => {
    await page.locator('.cue-row').first().click();
    await page.locator('#edit-end').fill('00:00:01,000');
    await page.locator('#apply-edit').click();
    assert.equal(await page.locator('#download-srt').isDisabled(), true);
    assert.ok(Number(await page.locator('#stat-errors').innerText()) > 0);
    await enabled('download-report');
    await page.locator('#edit-end').fill('00:00:03,000');
    await page.locator('#apply-edit').click();
    await enabled('download-srt');
    assert.equal(Number(await page.locator('#stat-errors').innerText()), 0);
  });

  await check('规则变更需重检，非法阈值阻断旧报告', async () => {
    await page.locator('#max-cps').fill('1');
    assert.equal(await page.locator('#download-report').isDisabled(), true);
    await page.locator('#apply-rules').click();
    await enabled('download-report');
    assert.ok(Number(await page.locator('#stat-warnings').innerText()) >= 2);
    await page.locator('#min-duration').fill('8');
    await page.locator('#max-duration').fill('7');
    await page.locator('#apply-rules').click();
    await page.locator('#error-banner').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#download-report').isDisabled(), true);
    await page.locator('#min-duration').fill('0.8');
    await page.locator('#max-cps').fill('12');
    await page.locator('#apply-rules').click();
    await enabled('download-srt');
    await download('download-srt', 'rules-checked.srt');
  });

  await check('坏格式、非法编码和文件大小上限清除旧结果', async () => {
    await upload('broken.srt', '1\n00:00:01,000 --> 00:00:03,000\n好字幕\n\n2\n坏时码\n不应被静默丢弃\n');
    await invalidInput();
    assert.match(await page.locator('#error-banner').innerText(), /6|第.*行/);
    await page.locator('#file-input').setInputFiles({ name: 'invalid-utf8.srt', mimeType: 'application/x-subrip', buffer: Buffer.from([0xff, 0xfe, 0x61]) });
    await invalidInput();
    assert.match(await page.locator('#error-banner').innerText(), /UTF-8/);
    await page.locator('#file-input').setInputFiles({ name: 'too-large.srt', mimeType: 'application/x-subrip', buffer: Buffer.alloc(2_097_153, 65) });
    await invalidInput();
    assert.match(await page.locator('#error-banner').innerText(), /2 MiB|上限|大小/);
    await upload('recovered.srt', cleanSrt);
    await enabled('download-srt');
    assert.equal(Number(await page.locator('#stat-cues').innerText()), 2);
  });

  await check('SRT 下载重导入与 JSON 报告一致', async () => {
    await upload('roundtrip.srt', '\uFEFF' + cleanSrt.replaceAll('\n', '\r\n'));
    await enabled('download-srt');
    const first = await download('download-srt', 'roundtrip-first.srt');
    const report = JSON.parse(await download('download-report', 'roundtrip-report.json'));
    assert.equal(report.stats.cues, 2);
    assert.equal(report.stats.errors, 0);
    assert.equal(report.stats.warnings, 0);
    assert.equal(report.rules.maxCps, 12);
    assert.deepEqual(report.issues, []);
    assert.equal(JSON.stringify(report).includes('第一条字幕。'), false, '报告不应包含完整正文');
    await page.locator('#file-input').setInputFiles(join(artifacts, 'roundtrip-first.srt'));
    await enabled('download-srt');
    const second = await download('download-srt', 'roundtrip-second.srt');
    assert.equal(second, first, '重导入后文本、时码和顺序不应改变');
  });

  await check('字幕 HTML 按文本展示并保留在 SRT', async () => {
    const hostile = '<img src="https://invalid.test/x" onerror="window.__injected=1">';
    await upload('literal.srt', `1\n00:00:01,000 --> 00:00:06,000\n${hostile}\n`);
    await enabled('download-srt');
    await page.locator('.cue-row').first().click();
    assert.ok((await page.locator('#cue-list').innerText()).includes(hostile));
    assert.equal(await page.locator('#edit-text').inputValue(), hostile);
    assert.equal(await page.locator('#preview-text').innerText(), hostile);
    assert.equal(await page.locator('img[src="https://invalid.test/x"]').count(), 0);
    assert.equal(await page.evaluate(() => window.__injected), undefined);
    assert.ok((await download('download-srt', 'literal.srt')).includes(hostile));
  });

  await check('样例请求与响应读取期间锁定编辑和规则，旧草稿不覆盖新文件', async () => {
    await upload('before-delayed-example.srt', cleanSrt);
    await enabled('download-srt');
    await page.locator('.cue-row').first().click();
    await page.locator('#edit-text').fill('加载前尚未应用的旧草稿');
    const selected = await page.locator('.cue-row.is-selected').getAttribute('data-cue-id');
    await page.evaluate(() => {
      window.__qaOriginalResponseBuffer = Response.prototype.arrayBuffer;
      Response.prototype.arrayBuffer = async function (...args) {
        if (this.url.endsWith('/examples/clean.srt')) {
          window.__qaResponseBufferStarted = true;
          await new Promise((done) => { window.__qaReleaseResponseBuffer = done; });
        }
        return window.__qaOriginalResponseBuffer.apply(this, args);
      };
    });
    let signalRequest;
    let releaseRequest;
    const requestStarted = new Promise((done) => { signalRequest = done; });
    const requestGate = new Promise((done) => { releaseRequest = done; });
    const handler = async (route) => { signalRequest(); await requestGate; await route.continue(); };
    await page.route('**/examples/clean.srt', handler);
    const assertLocked = async () => {
      for (const id of ['edit-start', 'edit-end', 'edit-text', 'min-duration', 'max-duration', 'max-cps', 'max-lines', 'apply-rules']) {
        assert.equal(await page.locator(`#${id}`).isDisabled(), true, `${id} 加载期间应锁定`);
      }
      assert.equal(await page.locator('#download-srt').isDisabled(), true);
      assert.equal(await page.locator('#download-report').isDisabled(), true);
      await page.locator('.cue-row').nth(1).click();
      assert.equal(await page.locator('.cue-row.is-selected').getAttribute('data-cue-id'), selected,
        '加载期间点击旧列表不能切换编辑对象');
      assert.equal(await page.locator('#edit-text').inputValue(), '加载前尚未应用的旧草稿');
    };
    try {
      await confirmAction(true, () => page.locator('#load-clean').click());
      await requestStarted;
      await assertLocked();
      releaseRequest();
      await page.waitForFunction(() => window.__qaResponseBufferStarted === true);
      await assertLocked();
      await page.evaluate(() => window.__qaReleaseResponseBuffer());
      await enabled('download-srt');
      for (const id of ['edit-start', 'edit-end', 'edit-text', 'min-duration', 'max-duration', 'max-cps', 'max-lines']) {
        assert.equal(await page.locator(`#${id}`).isDisabled(), false, `${id} 加载完成后应恢复`);
      }
      assert.match(await page.locator('#file-name').innerText(), /干净字幕/);
      assert.equal((await download('download-srt', 'delayed-example.srt')).includes('加载前尚未应用的旧草稿'), false);
      assert.equal(await page.locator('#max-cps').inputValue(), '12');
    } finally {
      releaseRequest();
      await page.evaluate(() => {
        window.__qaReleaseResponseBuffer?.();
        Response.prototype.arrayBuffer = window.__qaOriginalResponseBuffer;
        delete window.__qaOriginalResponseBuffer;
        delete window.__qaReleaseResponseBuffer;
        delete window.__qaResponseBufferStarted;
      });
      await page.unroute('**/examples/clean.srt', handler);
    }
  });

  await check('第150条唯一问题初始可见，筛选修复后仍定位在列表内', async () => {
    const time = (milliseconds) => {
      const seconds = Math.floor(milliseconds / 1000);
      return `00:${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')},${String(milliseconds % 1000).padStart(3, '0')}`;
    };
    const many = Array.from({ length: 170 }, (_, index) => {
      const start = (index * 3 + 1) * 1000;
      return `${index + 1}\n${time(start)} --> ${time(start + (index === 149 ? 500 : 2000))}\n字`;
    }).join('\n\n') + '\n';
    await upload('many-cues.srt', many);
    await enabled('download-srt');
    assert.equal(Number(await page.locator('#stat-cues').innerText()), 170);
    assert.equal(Number(await page.locator('#stat-warnings').innerText()), 1);
    const assertSelectedVisible = async () => {
      assert.equal(await page.locator('.cue-row.is-selected').getAttribute('data-cue-id'), '150');
      const position = await page.evaluate(() => {
        const list = document.querySelector('#cue-list');
        const row = list.querySelector('.is-selected');
        const rowBox = row.getBoundingClientRect();
        const listBox = list.getBoundingClientRect();
        return { inside: rowBox.top >= listBox.top - 1 && rowBox.bottom <= listBox.bottom + 1,
          scrollTop: list.scrollTop, rendered: list.querySelectorAll('.cue-row').length };
      });
      assert.equal(position.inside, true, '选中字幕应在列表内部可视范围，不能只在 DOM 中存在');
      return position;
    };
    const initial = await assertSelectedVisible();
    assert.ok(initial.rendered >= 150, '初次选中后须渲染第150条');
    assert.ok(initial.scrollTop > 0, '应自动滚动列表到后方选中字幕');
    await page.locator('#filter-issues').click();
    assert.equal(await page.locator('.cue-row').count(), 1);
    await assertSelectedVisible();
    await page.locator('#edit-end').fill(time((149 * 3 + 1) * 1000 + 2000));
    await page.locator('#apply-edit').click();
    await enabled('download-srt');
    assert.equal(Number(await page.locator('#stat-warnings').innerText()), 0);
    assert.equal(await page.locator('#filter-all').getAttribute('aria-pressed'), 'true');
    const repaired = await assertSelectedVisible();
    assert.ok(repaired.rendered >= 150);
    assert.ok(repaired.scrollTop > 0);
    await download('download-srt', 'many-cues-repaired.srt');
  });

  await check('文件读取期间阻止替换，完成后可正常换文件', async () => {
    await page.evaluate(() => {
      const original = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = async function (...args) {
        if (this.name === 'slow.srt') {
          await new Promise((done) => setTimeout(done, 350));
          window.__slowFinished = true;
        }
        return original.apply(this, args);
      };
    });
    await page.locator('#file-input').setInputFiles(file('slow.srt', cleanSrt.replaceAll('第一条', '过期')));
    assert.equal(await page.locator('#file-input').isDisabled(), true);
    assert.equal(await page.locator('#load-example').isDisabled(), true);
    assert.equal(await page.locator('#download-srt').isDisabled(), true);
    await page.waitForFunction(() => window.__slowFinished === true);
    await enabled('file-input');
    await page.locator('#file-input').setInputFiles(file('fast.srt', cleanSrt.replaceAll('第一条', '当前')));
    await enabled('download-srt');
    assert.match(await page.locator('#file-name').innerText(), /fast.srt/);
    assert.match(await download('download-srt', 'race.srt'), /当前字幕/);
  });

  await check('刷新清空内存状态', async () => {
    await page.reload();
    assert.equal(await page.locator('.cue-row').count(), 0);
    assert.equal(await page.locator('#download-srt').isDisabled(), true);
    assert.equal(await page.locator('#download-report').isDisabled(), true);
    assert.equal(await page.locator('#file-input').evaluate((node) => node.files.length), 0);
  });

  assert.deepEqual(errors, [], '不能有未处理的浏览器脚本错误');
  assert.deepEqual(consoleErrors, [], '不能有浏览器 console.error');
  assert.equal(requests.some(({ url }) => !url.startsWith(`${origin}/`) && url !== origin), false,
    '不能请求外部资源');
  assert.equal(requests.some(({ method }) => method !== 'GET'), false, '不能上传字幕内容');
  await writeFile(join(artifacts, 'browser-results.json'), JSON.stringify({
    passed: true, browser: `Chromium ${browser.version()}`, checks, errors, consoleErrors, requests,
  }, null, 2));
  console.log(`浏览器检查通过：${checks.length} 项；Chromium ${browser.version()}`);
} catch (error) {
  if (page) await page.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(join(artifacts, 'browser-results.json'), JSON.stringify({
    passed: false, checks, errors, consoleErrors, requests, failure: error.stack,
  }, null, 2));
  throw error;
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
