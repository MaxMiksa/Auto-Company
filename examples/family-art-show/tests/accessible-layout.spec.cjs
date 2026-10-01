const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test, expect } = require('@playwright/test');
const { artwork, addWork, assertNoHorizontalOverflow } = require('./helpers.cjs');

for (const width of [320, 390]) {
  test(`${width}px 手机完成准备、主持和回顾，没有页面横向溢出`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await assertNoHorizontalOverflow(page);
    await addWork(page, { title: '没有空格的长名字'.repeat(8), words: '长原话不应挤出手机屏幕'.repeat(50), image: await artwork(page, 900, 300) });
    await assertNoHorizontalOverflow(page);
    await page.locator('#start-show').click();
    await expect(page.locator('#stage-title')).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`phone-${width}-host.png`), fullPage: true });
    await page.locator('#host-next').click();
    await expect(page.locator('#review-view')).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });
}

test('键盘可跳到正文、填写作品、改变同意状态并控制主持', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await page.locator('#art-title').focus();
  await page.keyboard.type('键盘办展');
  await page.keyboard.press('Tab');
  await expect(page.locator('#art-words')).toBeFocused();
  await page.keyboard.type('自己决定是否讲。');
  await page.locator('#art-included').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#art-included')).toBeChecked();
  await page.locator('#save-artwork').focus();
  const focusStyle = await page.locator('#save-artwork').evaluate(el => {
    const style = getComputedStyle(el);
    return { outline: style.outlineStyle, shadow: style.boxShadow };
  });
  expect(focusStyle.outline !== 'none' || focusStyle.shadow !== 'none').toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.locator('.artwork-row')).toHaveCount(1);
  await page.locator('#start-show').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#stage-title')).toHaveText('键盘办展');
  await page.locator('#host-pause').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#paused-message')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#paused-message')).toBeHidden();
  await page.locator('#host-next').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#review-view')).toBeVisible();
});

test('直接打开本地HTML也能办展，核心任务无需网络请求', async ({ page }) => {
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href);
  await expect(page.getByRole('heading', { name: /每一件作品，.*都有自己的位置。/ })).toBeVisible();
  await addWork(page, { title: '本地打开的展会' });
  await page.locator('#start-show').click();
  await expect(page.locator('#stage-title')).toHaveText('本地打开的展会');
  await page.locator('#host-next').click();
  await expect(page.locator('#review-view')).toBeVisible();
  expect(requests.filter(url => /^https?:/.test(url))).toEqual([]);
});
