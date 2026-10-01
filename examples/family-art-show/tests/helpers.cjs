const fs = require('node:fs/promises');
const { expect } = require('@playwright/test');

// Synthetic artwork made in the real browser; no photographs of real children.
async function artwork(page, width, height, mimeType = 'image/png') {
  const dataUrl = await page.evaluate(({ width, height, mimeType }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#123456';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, Math.floor(height / 2), 12, 12);
    ctx.fillStyle = '#ffff00';
    ctx.fillRect(width - 12, 0, 12, 12);
    return canvas.toDataURL(mimeType);
  }, { width, height, mimeType });
  const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mimeType];
  return { name: `synthetic-${width}x${height}.${extension}`, mimeType,
    buffer: Buffer.from(dataUrl.split(',')[1], 'base64') };
}

async function readDownload(download) {
  return JSON.parse(await fs.readFile(await download.path(), 'utf8'));
}

async function selectBackup(page, data) {
  await page.locator('#import-backup').setInputFiles({
    name: 'synthetic-backup.json', mimeType: 'application/json',
    buffer: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data))
  });
}

async function assertNoHorizontalOverflow(page) {
  const sizes = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth
  }));
  expect(sizes.document).toBeLessThanOrEqual(sizes.viewport + 1);
  expect(sizes.body).toBeLessThanOrEqual(sizes.viewport + 1);
}

async function assertImageFaithful(image, width, height) {
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  const result = await image.evaluate(img => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const pixel = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3);
    const style = getComputedStyle(img);
    return { width: img.naturalWidth, height: img.naturalHeight,
      fit: style.objectFit,
      background: pixel(20, 20), left: pixel(2, Math.floor(img.naturalHeight / 2) + 2),
      right: pixel(img.naturalWidth - 2, 2) };
  });
  expect(result.width / result.height).toBeCloseTo(width / height, 3);
  expect(result.fit).toBe('contain');
  // The product compresses photos to WebP. Allow small encoding differences,
  // while checking both edge marks and the dark original background survive.
  for (const [actual, expected] of [[result.background, [18, 52, 86]],
    [result.left, [255, 0, 0]], [result.right, [255, 255, 0]]]) {
    actual.forEach((channel, index) => expect(Math.abs(channel - expected[index])).toBeLessThan(25));
  }
}

async function addWork(page, { title, words = '', image = null, included = true }) {
  await ready(page);
  await page.locator('#art-title').fill(title);
  await page.locator('#art-words').fill(words);
  await page.locator(included ? '#art-included' : '#art-excluded').check();
  if (image) await page.locator('#art-image').setInputFiles(image);
  await page.locator('#save-artwork').click();
  await expect(workRow(page, title)).toBeVisible();
}

function workRow(page, title) {
  return page.locator('.artwork-row').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
}

async function exportBackup(page) {
  await ready(page);
  const pending = page.waitForEvent('download');
  await page.locator('#export-backup').click();
  return readDownload(await pending);
}

async function ready(page) {
  await expect(page.locator('#save-status')).not.toHaveText('正在读取本机记录…');
}

module.exports = { artwork, readDownload, selectBackup, addWork, workRow, exportBackup, ready, assertNoHorizontalOverflow,
  assertImageFaithful };
