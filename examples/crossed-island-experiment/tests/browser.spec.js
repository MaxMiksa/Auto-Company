const { test, expect } = require('@playwright/test');
const { readFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const entry = pathToFileURL(path.join(__dirname, '../index.html')).href;
async function evidence(name) {
  const folder = path.join(__dirname, '../.auto-company/checks');
  await mkdir(folder, { recursive: true });
  return path.join(folder, name);
}
async function noOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}
const a = {
  name: '虚构旅人甲', landmark: '回声灯塔', detail: '甲图样_螺旋红线',
  reason: '甲缘由_给迷路的纸船留一束灯', prediction: '甲预测_对方会用贝壳搭桥', rule: 'moon',
};
const b = {
  name: '虚构旅人乙', landmark: '盐晶花园', detail: '乙图样_蓝色方格',
  reason: '乙缘由_留下可以听见风的玻璃叶', prediction: '乙预测_对方会在潮水前等待', rule: 'low',
};
const actionA = '我踏着浅滩，把写着名字的纸灯放在潮线旁。';
const actionB = '我在月光下递出灯，让贝壳上的影子指向花园。';

function main(page) { return page.locator('main[data-stage]'); }
async function stage(page, value) { await expect(main(page)).toHaveAttribute('data-stage', value); }
async function start(page) {
  await page.goto(entry);
  await stage(page, 'intro');
  await page.getByTestId('start').click();
  await stage(page, 'createA');
}
async function author(page, fields) {
  const form = page.getByTestId('author-form');
  for (const field of ['name', 'landmark', 'detail', 'reason', 'prediction']) {
    await form.locator(`[name="${field}"]`).fill(fields[field]);
  }
  await form.locator('[name="rule"]').selectOption(fields.rule);
  await form.locator('[type="submit"]').click();
}
async function hidden(page, people = [a, b]) {
  const bodyText = await page.locator('body').textContent();
  for (const person of people) {
    for (const field of ['detail', 'reason', 'prediction']) {
      expect(bodyText, `${field} 提前出现在页面 DOM`).not.toContain(person[field]);
    }
  }
}
async function bothCreated(page, personA = a, personB = b) {
  await start(page);
  await author(page, personA);
  await stage(page, 'handoffB');
  await hidden(page, [personA]);
  await page.getByTestId('continue').click();
  await stage(page, 'createB');
  await hidden(page, [personA]);
  await author(page, personB);
  await stage(page, 'handoffA');
  await hidden(page, [personA, personB]);
}
async function toReveal(page, personA = a, personB = b) {
  const chosenActionA = personB.rule === 'low' ? actionA : '我在潮汐浮台上放置纸灯，让涨潮的水托起它。';
  const chosenActionB = personA.rule === 'moon' ? actionB : '我用晨间反光把贝壳上的光送向花园。';
  await bothCreated(page, personA, personB);
  await page.getByTestId('continue').click();
  await stage(page, 'actionA');
  await expect(main(page)).toContainText(personB.rule === 'low' ? '踏浅滩' : '潮汐浮台');
  await hidden(page, [personA, personB]);
  await page.getByTestId('action-form').locator('[name="action"]').fill(chosenActionA);
  await page.getByTestId('action-form').locator('[type="submit"]').click();
  await stage(page, 'handoffActionB');
  await hidden(page, [personA, personB]);
  await page.getByTestId('continue').click();
  await stage(page, 'actionB');
  await expect(main(page)).toContainText(personA.rule === 'moon' ? '夜间递灯' : '晨间反光');
  await hidden(page, [personA, personB]);
  await page.getByTestId('action-form').locator('[name="action"]').fill(chosenActionB);
  await page.getByTestId('action-form').locator('[type="submit"]').click();
  await stage(page, 'reveal');
  for (const person of [personA, personB]) {
    for (const field of ['landmark', 'detail', 'reason', 'prediction']) {
      await expect(main(page)).toContainText(person[field]);
    }
  }
  await expect(main(page)).toContainText(chosenActionA);
  await expect(main(page)).toContainText(chosenActionB);
}
async function toDecision(page, personA = a, personB = b) {
  await toReveal(page, personA, personB);
  await page.getByTestId('continue').click();
  await stage(page, 'decision');
}
async function vote(page, voteA, voteB, joint = '我们把灯塔与花园写进同一张地图，记下共同愿意付出的代价。') {
  const form = page.getByTestId('decision-form');
  await form.locator('[name="voteA"]').selectOption(voteA);
  await form.locator('[name="voteB"]').selectOption(voteB);
  await form.locator('[name="joint"]').fill(joint);
  await form.locator('[name="reflectionA"]').fill('甲回望_我原以为需要赶路，但你让我看到等待。');
  await form.locator('[name="reflectionB"]').fill('乙回望_我原以为留下才是保留，但你让我看到改变。');
  await form.locator('[type="submit"]').click();
}
async function download(page, id, testInfo) {
  const pending = page.waitForEvent('download');
  await page.getByTestId(id).click();
  const file = await pending;
  const path = testInfo.outputPath(file.suggestedFilename());
  await file.saveAs(path);
  expect(await file.failure()).toBeNull();
  return { text: await readFile(path, 'utf8'), path };
}
async function upload(page, text) {
  await page.getByTestId('import-json').setInputFiles({
    name: 'synthetic-crossed-island.json', mimeType: 'application/json', buffer: Buffer.from(text),
  });
}

test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\//, route => route.abort());
});

test.describe('核心流程', () => {
  test('双方封存、对方规则、揭晓、留路及两种下载', async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(entry);
    await stage(page, 'intro');
    await page.screenshot({ path: await evidence('desktop-intro.png'), fullPage: true, animations: 'disabled' });
    await toDecision(page);
    await vote(page, 'road', 'road');
    await stage(page, 'finished');
    const artifact = page.getByTestId('artifact');
    await expect(artifact).toContainText('灯塔');
    await expect(artifact).toContainText('花园');
    await expect(artifact).toContainText('离岛路留下');
    await expect(artifact).toContainText('原物外形失去');
    await expect(artifact).toContainText('甲回望_');
    await page.screenshot({ path: await evidence('desktop-finished.png'), fullPage: true, animations: 'disabled' });
    const json = await download(page, 'export-json', testInfo);
    expect(() => JSON.parse(json.text)).not.toThrow();
    const markdown = await download(page, 'export-md', testInfo);
    for (const exported of [json.text, markdown.text]) {
      for (const person of [a, b]) {
        for (const field of ['name', 'landmark', 'detail', 'reason', 'prediction']) expect(exported).toContain(person[field]);
      }
      expect(exported).toContain(actionA);
      expect(exported).toContain(actionB);
      expect(exported).toContain('甲回望_');
      expect(exported).toContain('乙回望_');
    }
    expect(errors).toEqual([]);
  });

  test('日光与涨潮改变行动；留物明确放弃通路', async ({ page }) => {
    await toDecision(page, { ...a, rule: 'sun' }, { ...b, rule: 'high' });
    await vote(page, 'objects', 'objects');
    await stage(page, 'finished');
    await expect(page.getByTestId('artifact')).toContainText('原物');
    await expect(page.getByTestId('artifact')).toContainText(/放弃|失去|没有/);
    await expect(page.getByTestId('artifact')).toContainText('通路');
  });

  test('双方票不一致时保留决定页，并可重新形成共同选择', async ({ page }) => {
    await toDecision(page);
    await vote(page, 'road', 'objects', '');
    await stage(page, 'decision');
    await expect(page.getByTestId('notice')).toContainText(/一致|分歧|不同|同意/);
    await expect(page.getByTestId('decision-form').locator('[name="joint"]')).toHaveValue('');
    await vote(page, 'objects', 'objects');
    await stage(page, 'finished');
  });

  test('恶意自由文字仅按文本展示，不创建元素或执行脚本', async ({ page }, testInfo) => {
    const payload = '<img src=x onerror="window.__storyInjected=1"><script>window.__storyInjected=2</script>';
    const unsafeA = { ...a, landmark: '<img src=x onerror="window.__storyInjected=1">', detail: payload, reason: payload, prediction: payload };
    await toDecision(page, unsafeA, b);
    await vote(page, 'road', 'road');
    await stage(page, 'finished');
    await expect(page.getByTestId('artifact')).toContainText(payload);
    expect(await page.evaluate(() => window.__storyInjected)).toBeUndefined();
    await expect(page.locator('img[onerror], script:not([src])')).toHaveCount(0);
    const json = await download(page, 'export-json', testInfo);
    const savedA = JSON.parse(json.text).authors.A;
    for (const field of ['landmark', 'detail', 'reason', 'prediction']) {
      expect(savedA[field]).toBe(unsafeA[field]);
    }
  });

  test('手机无横向溢出，键盘可开始；纸面入口与成果打印可用', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(entry);
    await stage(page, 'intro');
    await noOverflow(page);
    await page.screenshot({ path: await evidence('mobile-intro.png'), fullPage: true, animations: 'disabled' });
    await page.getByTestId('start').focus();
    await expect(page.getByTestId('start')).toBeFocused();
    await page.keyboard.press('Enter');
    await stage(page, 'createA');
    await noOverflow(page);
    for (const field of ['name', 'landmark', 'detail', 'reason', 'prediction', 'rule']) {
      const control = page.getByTestId('author-form').locator(`[name="${field}"]`);
      expect(await control.evaluate(el => el.labels?.length || 0), `${field} 缺少原生 label`).toBeGreaterThan(0);
    }
    await author(page, a);
    await page.getByTestId('continue').click();
    await noOverflow(page);
    await author(page, b);
    await page.getByTestId('continue').click();
    await noOverflow(page);
    await page.getByTestId('action-form').locator('[name="action"]').fill(actionA);
    await page.getByTestId('action-form').locator('[type="submit"]').click();
    await page.getByTestId('continue').click();
    await noOverflow(page);
    await page.getByTestId('action-form').locator('[name="action"]').fill(actionB);
    await page.getByTestId('action-form').locator('[type="submit"]').click();
    await page.getByTestId('continue').click();
    await noOverflow(page);
    await vote(page, 'road', 'road');
    await stage(page, 'finished');
    await noOverflow(page);
    await page.screenshot({ path: await evidence('mobile-finished.png'), fullPage: true, animations: 'disabled' });
    const paper = page.getByTestId('paper-pack');
    const paperURL = await paper.getAttribute('href');
    expect(paperURL).toBeTruthy();
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByTestId('artifact')).toBeVisible();
    await expect(page.getByTestId('new-game')).toBeHidden();
    await page.pdf({ path: testInfo.outputPath('finished-print.pdf'), format: 'A4', printBackground: true });
    await page.goto(new URL(paperURL, entry).href);
    await expect(page.locator('body')).toContainText('交错岛');
    await expect(page.locator('body')).toContainText('阿岚');
    await expect(page.locator('body')).toContainText('雨生');
    await expect(page.locator('.sheet')).toHaveCount(5);
    const sheets = await page.locator('.sheet').evaluateAll(elements => elements.map(el => {
      const footer = el.querySelector('footer');
      return {
        scroll: el.scrollHeight, box: el.clientHeight, footer: Boolean(footer),
        footerBottom: footer ? footer.getBoundingClientRect().bottom - el.getBoundingClientRect().top : null,
      };
    }));
    for (const [index, sheet] of sheets.entries()) {
      expect(sheet.scroll, `纸面包第 ${index + 1} 页溢出`).toBeLessThanOrEqual(sheet.box + 1);
      expect(sheet.footer, `纸面包第 ${index + 1} 页缺少页脚`).toBe(true);
      expect(sheet.footerBottom, `纸面包第 ${index + 1} 页页脚进入底部留白`).toBeLessThan(sheet.box - 25);
    }
    await page.pdf({ path: await evidence('paper.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true });
  });
});

test.describe('恢复与边界', () => {
  test('未封存草稿刷新恢复，暂停遮住内容，继续保留输入', async ({ page }) => {
    await start(page);
    const form = page.getByTestId('author-form');
    await form.locator('[name="reason"]').fill('未封存草稿_保存这艘橙色纸船');
    await form.locator('[name="landmark"]').fill('草稿灯塔');
    await page.reload();
    await stage(page, 'createA');
    await expect(page.getByTestId('author-form').locator('[name="reason"]')).toHaveValue('未封存草稿_保存这艘橙色纸船');
    await page.getByTestId('pause').click();
    await expect(page.getByTestId('author-form')).toHaveCount(0);
    expect(await page.locator('body').textContent()).not.toContain('未封存草稿_');
    await page.reload();
    await expect(page.getByTestId('resume')).toBeVisible();
    await page.getByTestId('resume').click();
    await stage(page, 'createA');
    await expect(page.getByTestId('author-form').locator('[name="reason"]')).toHaveValue('未封存草稿_保存这艘橙色纸船');
    await expect(page.getByTestId('author-form').locator('[name="landmark"]')).toHaveValue('草稿灯塔');
  });

  test('坏 JSON 与伪造完成快照不能覆盖现有封存作品', async ({ page }, testInfo) => {
    await bothCreated(page);
    const before = await download(page, 'export-json', testInfo);
    for (const invalid of ['{broken json', '{"stage":"finished","ending":{"choice":"road"}}']) {
      await upload(page, invalid);
      await expect(page.getByTestId('notice')).toContainText('导入未完成，当前进度已保留');
      await expect(page.getByTestId('confirm-import')).toHaveCount(0);
      await stage(page, 'handoffA');
      const after = await download(page, 'export-json', testInfo);
      expect(JSON.parse(after.text)).toEqual(JSON.parse(before.text));
    }
  });

  test('有效快照先确认替换，恢复到原阶段并继续完成', async ({ page }, testInfo) => {
    await bothCreated(page);
    const saved = await download(page, 'export-json', testInfo);
    await page.getByTestId('continue').click();
    await stage(page, 'actionA');
    await upload(page, saved.text);
    await expect(page.getByTestId('confirm-import')).toBeVisible();
    await stage(page, 'actionA');
    await page.getByTestId('confirm-import').click();
    await stage(page, 'handoffA');
    await hidden(page);
    for (const control of ['new-game', 'stop']) {
      await page.getByTestId(control).click();
      await expect(page.locator('#confirm-dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('#confirm-dialog')).toBeHidden();
      await stage(page, 'handoffA');
      await hidden(page);
    }
    await page.getByTestId('continue').click();
    await page.getByTestId('action-form').locator('[name="action"]').fill(actionA);
    await page.getByTestId('action-form').locator('[type="submit"]').click();
    await page.getByTestId('continue').click();
    await page.getByTestId('action-form').locator('[name="action"]').fill(actionB);
    await page.getByTestId('action-form').locator('[type="submit"]').click();
    await page.getByTestId('continue').click();
    await vote(page, 'road', 'road');
    await stage(page, 'finished');
    await expect(page.getByTestId('artifact')).toContainText(a.reason);
  });

  test('中途停止保留已有部分作品并注明未有共同结局', async ({ page }, testInfo) => {
    await start(page);
    await author(page, a);
    await page.getByTestId('stop').click();
    await expect(page.getByTestId('confirm-stop')).toBeVisible();
    await stage(page, 'handoffB');
    await page.getByTestId('confirm-stop').click();
    await stage(page, 'finished');
    await expect(page.getByTestId('artifact')).toContainText(a.reason);
    await expect(page.getByTestId('artifact')).toContainText(/未.*共同|没有共同|独立地图|中途停止/);
    const json = await download(page, 'export-json', testInfo);
    expect(json.text).toContain(a.reason);
    expect(json.text).not.toContain(b.reason);
  });

  test('开始新局需要确认，确认后刷新不会恢复旧作品', async ({ page }) => {
    await bothCreated(page);
    await page.getByTestId('new-game').click();
    await expect(page.getByTestId('confirm-new')).toBeVisible();
    await stage(page, 'handoffA');
    await page.getByTestId('confirm-new').click();
    await stage(page, 'intro');
    await page.reload();
    await stage(page, 'intro');
    await page.getByTestId('start').click();
    await expect(page.getByTestId('author-form').locator('[name="reason"]')).toHaveValue('');
  });
});
