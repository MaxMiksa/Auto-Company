const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const [scenario, baseUrl, fixturePath, artifactDir] = process.argv.slice(2);
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

function browserPath() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || (process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA, 'ms-playwright')
    : path.join(require('node:os').homedir(), '.cache', 'ms-playwright'));
  const versions = fs.existsSync(cache) ? fs.readdirSync(cache).filter(n => /^chromium-\d+$/.test(n)).sort().reverse() : [];
  for (const version of versions) {
    for (const relative of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const executable = path.join(cache, version, relative);
      if (fs.existsSync(executable)) return executable;
    }
  }
  return undefined;
}

function parseCSV(text) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\r' || char === '\n') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  assert.equal(quoted, false, 'CSV quotes must close');
  return rows;
}

(async () => {
  fs.mkdirSync(artifactDir, { recursive: true });
  const launchEnv = { ...process.env };
  const localLibraries = '/tmp/field-return-audit-browser-libs/usr/lib/x86_64-linux-gnu';
  if (fs.existsSync(localLibraries)) launchEnv.LD_LIBRARY_PATH = localLibraries + (launchEnv.LD_LIBRARY_PATH ? ':' + launchEnv.LD_LIBRARY_PATH : '');
  const browser = await chromium.launch({ executablePath: browserPath(), env: launchEnv, headless: true, args: ['--no-sandbox'], timeout: 15000 });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let dialogSeen = false;
  page.on('dialog', async dialog => { dialogSeen = true; await dialog.dismiss(); });
  const networks = [];
  page.on('request', request => networks.push(request.url()));
  await page.goto(baseUrl, { waitUntil: 'networkidle' });

  async function demo() {
    await page.locator('#load-demo').click();
    await page.locator('#demo-label').waitFor({ state: 'visible' });
  }
  async function run(status) {
    await page.locator('#run-audit').click();
    await page.locator('#report-result').waitFor({ state: 'visible' });
    const label = await page.locator('#status-label').innerText();
    assert.match(label, status);
  }
  async function declare() { await page.locator('#evidence-complete').check(); }

  try {
    if (scenario === 'demo-export') {
      await demo();
      assert.equal(await page.locator('#evidence-complete').isChecked(), false);
      await run(/未确认/);
      await declare();
      await run(/通过/);
      for (const format of ['json', 'csv', 'html']) {
        const pending = page.waitForEvent('download');
        await page.locator('#export-' + format).click();
        const download = await pending;
        const destination = path.join(artifactDir, 'demo-report.' + format);
        await download.saveAs(destination);
        const text = fs.readFileSync(destination, 'utf8');
        assert.ok(text.length > 100, format + ' export must contain report');
        if (format === 'json') {
          const result = JSON.parse(text);
          assert.equal(result['验收结论'], '通过');
          assert.equal(Object.values(result['输入证据']['数据副本']).length, 3);
          assert.ok(Object.values(result['输入证据']['数据副本']).every(file => /^[a-f0-9]{64}$/.test(file['SHA-256'])));
          assert.ok(result['验收范围'].length);
        }
        if (format === 'csv') assert.ok(text.includes('sites') || text.includes('observations'));
        if (format === 'html') assert.ok(text.includes('SHA-256') && text.includes('验收'));
      }
    } else if (scenario === 'stale-result') {
      await demo(); await declare(); await run(/通过/);
      await page.locator('#job-name').fill('输入已改变');
      assert.equal(await page.locator('#report-result').isVisible(), false);
      assert.equal(await page.locator('#export-json').isEnabled(), false);
      await run(/通过/);
      assert.ok((await page.locator('#result-job').innerText()).includes('输入已改变'));
      await page.locator('#evidence-complete').uncheck();
      assert.equal(await page.locator('#report-result').isVisible(), false);
      await run(/未确认/);
    } else if (scenario === 'attachment-recovery') {
      await demo(); await declare();
      await page.locator('#omit-attachment').click();
      await run(/差异|复核|处理/);
      await page.locator('#attachment-policy').selectOption('deferred');
      assert.equal(await page.locator('#report-result').isVisible(), false);
      await run(/待补|延后/);
      await page.locator('#omit-attachment').click();
      await run(/通过/);
    } else if (scenario === 'upload-roundtrip') {
      for (const name of ['baseline', 'field', 'target']) {
        const file = fixture.request[name];
        await page.locator('#' + name).setInputFiles({ name: file.name, mimeType: 'application/octet-stream', buffer: Buffer.from(file.data, 'base64') });
      }
      await page.locator('#field-directory').setInputFiles(fixture.field_directory);
      await page.locator('#target-directory').setInputFiles(fixture.target_directory);
      await page.locator('#config-section > summary').click();
      await page.locator('#config').fill(JSON.stringify(fixture.request.config));
      await page.locator('#job-name').fill('真实文件输入合成作业');
      await declare(); await run(/通过/);
      assert.ok((await page.locator('#changes-table').innerText()).includes('s3'));
      assert.ok((await page.locator('#evidence-table').innerText()).includes('SHA-256') || (await page.locator('#evidence-table').innerText()).includes('departure.gpkg'));
      await page.locator('#target').setInputFiles({ name: 'corrupt.gpkg', mimeType: 'application/octet-stream', buffer: Buffer.from('not SQLite') });
      assert.equal(await page.locator('#report-result').isVisible(), false);
      await page.locator('#run-audit').click();
      await page.waitForFunction(() => !document.querySelector('#run-audit').disabled && document.querySelector('#form-message').textContent.trim().length > 0);
      assert.equal(await page.locator('#report-result').isVisible(), false);
      const file = fixture.request.target;
      await page.locator('#target').setInputFiles({ name: file.name, mimeType: 'application/octet-stream', buffer: Buffer.from(file.data, 'base64') });
      await run(/通过/);
    } else if (scenario === 'retry-and-xss') {
      await demo(); await declare();
      await page.route('**/api/audit', route => route.abort('failed'));
      await page.locator('#run-audit').click();
      await page.waitForFunction(() => !document.querySelector('#run-audit').disabled && document.querySelector('#form-message').textContent.trim().length > 0);
      assert.equal(await page.locator('#report-result').isVisible(), false);
      assert.equal(await page.locator('#export-json').isEnabled(), false);
      await page.unroute('**/api/audit');
      await page.locator('#job-name').fill('<img src=x onerror=alert(1)>');
      await run(/通过/);
      assert.equal(await page.locator('#result-job img').count(), 0);
      assert.equal(dialogSeen, false);
      const pending = page.waitForEvent('download');
      await page.locator('#export-html').click();
      const download = await pending;
      const destination = path.join(artifactDir, 'escaped-report.html');
      await download.saveAs(destination);
      const html = fs.readFileSync(destination, 'utf8');
      assert.ok(html.includes('&lt;img') && !html.includes('<img src=x'));
      const reportPage = await context.newPage();
      reportPage.on('dialog', async dialog => { dialogSeen = true; await dialog.dismiss(); });
      await reportPage.goto('file://' + destination);
      assert.equal(await reportPage.locator('img[src="x"]').count(), 0);
      assert.equal(dialogSeen, false);
      await reportPage.close();
    } else if (scenario === 'integer-precision') {
      const descriptor = value => ({ type: 'integer', value });
      async function visibleRows(locator) {
        return locator.locator('tbody tr').evaluateAll(rows => rows.map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent.trim())));
      }
      function checkRecords(rows, values, parentCase = false, mismatchCase = false) {
        const records = rows.filter(row => row[0] === 'records' && row[3] === (parentCase ? 'note' : 'metric'));
        assert.equal(records.length, values.length, 'every original integer record must remain separately locatable');
        assert.deepEqual(records.map(row => JSON.parse(row[1]).uid.value).sort(), [...values].sort());
        for (const row of records) {
          const value = JSON.parse(row[1]).uid.value;
          assert.deepEqual(JSON.parse(row[1]).uid, descriptor(value));
          if (parentCase) assert.deepEqual(row.slice(4, 7), ['old', 'new', 'wrong']);
          else {
            assert.equal(row[5], '整数 · ' + value, '现场应有 must preserve exact non-key integer');
            assert.equal(row[6], '整数 · ' + (mismatchCase && value === '9007199254740993' ? '9007199254740992' : value));
          }
        }
        if (!parentCase) {
          const composites = rows.filter(row => row[0] === 'composite' && row[3] === 'metric');
          assert.deepEqual(composites.map(row => JSON.parse(row[1]).record_uid.value).sort(), [...values].sort());
          for (const row of composites) {
            const key = JSON.parse(row[1]);
            assert.equal(key.region, '合成区');
            assert.deepEqual(key.record_uid, descriptor(key.record_uid.value));
            assert.equal(row[5], '整数 · ' + key.record_uid.value);
          }
          const typed = rows.filter(row => row[0] === 'typed' && row[3] === 'metric');
          const integer = typed.find(row => JSON.parse(row[1]).uid?.value === '9007199254740993');
          const string = typed.find(row => JSON.parse(row[1]).uid === '9007199254740993');
          assert.ok(integer && string);
          assert.deepEqual(integer.slice(4, 6), ['整数 · 9007199254740993', '文本 · "9007199254740993"']);
          assert.deepEqual(string.slice(4, 6), ['文本 · "9007199254740993"', '整数 · 9007199254740993']);
        }
      }
      for (const [name, request, status, parentCase] of [
        ['boundaries', fixture.integer_request, /通过/, false],
        ['mismatch', fixture.integer_mismatch_request, /复核/, false],
        ['parent-description', fixture.integer_parent_request, /复核/, true],
      ]) {
        for (const role of ['baseline', 'field', 'target']) {
          const file = request[role];
          await page.locator('#' + role).setInputFiles({ name: file.name, mimeType: 'application/octet-stream', buffer: Buffer.from(file.data, 'base64') });
        }
        if (!(await page.locator('#config').isVisible())) await page.locator('#config-section > summary').click();
        await page.locator('#config').fill(JSON.stringify(request.config));
        await page.locator('#job-name').fill(request.config.job_name);
        await declare(); await run(status);
        const values = parentCase ? ['9007199254740993'] : fixture.integer_boundaries;
        checkRecords(await visibleRows(page.locator('#changes-table')), values, parentCase, name === 'mismatch');
        if (name === 'mismatch') assert.ok((await page.locator('#issues-table').innerText()).includes('整数 · -9223372036854775808'));
        for (const format of ['json', 'csv', 'html']) {
          const pending = page.waitForEvent('download');
          await page.locator('#export-' + format).click();
          const download = await pending;
          const destination = path.join(artifactDir, 'integer-' + name + '.' + format);
          await download.saveAs(destination);
          const text = fs.readFileSync(destination, 'utf8');
          if (format === 'json') {
            const result = JSON.parse(text);
            const records = result['三方变更'].filter(change => change['业务表'] === 'records');
            assert.deepEqual(records.map(change => change['记录键'].uid.value).sort(), [...values].sort());
            for (const change of records) {
              assert.deepEqual(change['记录键'].uid, descriptor(change['记录键'].uid.value));
              if (parentCase) assert.deepEqual(['出发基线', '现场应有', '目标实有'].map(key => change[key].note), ['old', 'new', 'wrong']);
              else assert.deepEqual(change['现场应有'].metric, descriptor(change['记录键'].uid.value));
            }
            if (!parentCase) {
              const typed = result['三方变更'].filter(change => change['业务表'] === 'typed');
              const integer = typed.find(change => typeof change['记录键'].uid === 'object' && change['记录键'].uid.value === '9007199254740993');
              const string = typed.find(change => change['记录键'].uid === '9007199254740993');
              assert.ok(integer && string, 'same-character integer and text identities remain distinct');
              assert.deepEqual(integer['出发基线'].metric, descriptor('9007199254740993'));
              assert.equal(integer['现场应有'].metric, '9007199254740993');
              assert.equal(string['出发基线'].metric, '9007199254740993');
              assert.deepEqual(string['现场应有'].metric, descriptor('9007199254740993'));
              const composites = result['三方变更'].filter(change => change['业务表'] === 'composite');
              assert.deepEqual(composites.map(change => change['记录键'].record_uid.value).sort(), [...values].sort());
            }
            if (name === 'mismatch') {
              assert.ok(result['待处理问题'].some(issue => JSON.stringify(issue['目标实有']) === JSON.stringify(descriptor('-9223372036854775808'))));
            }
          } else if (format === 'csv') {
            const csvRows = parseCSV(text);
            const rows = csvRows.filter(row => row[0] === '三方变更').map(row => row.slice(1, 9));
            checkRecords(rows, values, parentCase, name === 'mismatch');
            if (name === 'mismatch') assert.ok(csvRows.some(row => row[0] === '待处理问题' && row[1] === 'typed_links' && row[6] === '整数 · -9223372036854775808'));
          } else {
            const reportPage = await context.newPage();
            await reportPage.goto('file://' + destination);
            const rows = await reportPage.locator('tbody tr').evaluateAll(rows => rows.map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent.trim())));
            checkRecords(rows, values, parentCase, name === 'mismatch');
            if (name === 'mismatch') assert.ok(rows.some(row => row[0] === 'typed_links' && row[5] === '整数 · -9223372036854775808'));
            await reportPage.close();
          }
        }
        await page.screenshot({ path: path.join(artifactDir, 'integer-' + name + '.png'), fullPage: true });
      }
      await page.setViewportSize({ width: 375, height: 812 });
      const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(dimensions.scroll <= dimensions.width + 1, '完整整数键不能使窄屏页面溢出：' + JSON.stringify(dimensions));
      await page.screenshot({ path: path.join(artifactDir, 'integer-narrow.png'), fullPage: true });
    } else if (scenario === 'narrow-keyboard') {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.locator('#load-demo').focus();
      await page.keyboard.press('Enter');
      await page.locator('#demo-label').waitFor({ state: 'visible' });
      await page.locator('#evidence-complete').focus();
      await page.keyboard.press('Space');
      assert.equal(await page.locator('#evidence-complete').isChecked(), true);
      await page.locator('#run-audit').focus();
      await page.keyboard.press('Enter');
      await page.locator('#report-result').waitFor({ state: 'visible' });
      assert.match(await page.locator('#status-label').innerText(), /通过/);
      const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(dimensions.scroll <= dimensions.width + 1, JSON.stringify(dimensions));
      await page.screenshot({ path: path.join(artifactDir, 'narrow.png'), fullPage: true });
    } else throw new Error('unknown browser scenario: ' + scenario);
    assert.deepEqual(errors, [], 'no uncaught JavaScript errors');
    assert.ok(networks.every(url => url.startsWith(baseUrl) || url.startsWith('blob:') || url.startsWith('data:')), 'product must only request local resources');
    await page.screenshot({ path: path.join(artifactDir, scenario + '.png'), fullPage: true });
    console.log(JSON.stringify({ scenario, browser: browser.version(), outcome: 'passed', artifacts: artifactDir }));
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error.stack); process.exit(1); });
