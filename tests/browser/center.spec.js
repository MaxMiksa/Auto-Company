import { test as base, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const test = base.extend({
  centerCycles: [6, { option: true }],
  center: async ({ centerCycles }, use, testInfo) => {
    const child = spawn(process.env.AUTO_COMPANY_BROWSER_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
      ['-u', fileURLToPath(new URL('center-fixture-server.py', import.meta.url)), '--cycles', String(centerCycles)],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    child.stderr.on('data', chunk => { output += chunk; });
    const closed = new Promise(resolve => child.once('close', resolve));
    const lines = createInterface({ input: child.stdout });
    try {
      const center = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Center fixture timed out: ${output}`)), 15000);
        const finish = (error, value) => { clearTimeout(timer); error ? reject(error) : resolve(value); };
        child.once('error', error => finish(error));
        child.once('exit', code => finish(new Error(`Center fixture exited ${code}: ${output}`)));
        lines.once('line', line => { try { finish(null, JSON.parse(line)); } catch (error) { finish(error); } });
      });
      await use(center);
    } finally {
      child.stdin.end();
      let timer;
      await Promise.race([closed, new Promise(resolve => { timer = setTimeout(() => { child.kill(); resolve(); }, 5000); })]);
      clearTimeout(timer);
      lines.close();
      if (testInfo.status !== testInfo.expectedStatus) await testInfo.attach('center-server.log', { body: output, contentType: 'text/plain' });
    }
  },
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await use(page);
    expect(errors).toEqual([]);
  },
});

async function openCenter(page, center) {
  await page.goto(`${center.url}/center`);
  await expect(page.locator('#observedAt')).not.toBeEmpty();
}

test('default autonomous creation uses empty text and preserves preparation failures after reload', async ({ page, center }) => {
  await openCenter(page, center);
  await page.locator('#newWorkButton').click();
  const created = page.waitForRequest(request => request.url().endsWith('/api/center/v1/explorations') && request.method() === 'POST');
  await page.locator('#newWorkForm [type="submit"]').click();
  expect((await created).postDataJSON().direction).toBe('');
  await expect(page.locator('#newWorkDialog')).not.toBeVisible();
  await expect(page.locator('#queueContent')).toContainText(/framework|框架/i);
  const response = await page.request.get(`${center.url}/api/center/v1/operations`);
  const operations = (await response.json()).data.items;
  expect(operations).toHaveLength(1);
  expect(operations[0].state).toBe('failed');
  expect(operations[0].reason).toBe('FRAMEWORK_UNVERIFIED');
  expect(operations[0]).not.toHaveProperty('input');
  await page.reload();
  await expect(page.locator('#observedAt')).not.toBeEmpty();
  await page.locator('#queueNavButton').click();
  await expect(page.locator('#queueContent')).toContainText(/framework|框架/i);
  expect((await (await page.request.get(`${center.url}/api/center/v1/requests`)).json()).data.items).toHaveLength(0);
});

test('six product rounds retain earliest history and complete usage independently of visible rows', async ({ page, center }) => {
  await page.goto(`${center.url}/products/${center.entryId}`);
  await expect(page.locator('#historyList details')).toHaveCount(4);
  await expect(page.locator('#olderButton')).toBeVisible();
  await page.locator('#olderButton').click();
  await expect(page.locator('#historyList details')).toHaveCount(5);
  await page.locator('#tab-usage').click();
  await page.locator('#usagePeriod').selectOption('all');
  await expect(page.locator('#usageSummary')).toContainText('60');
  await expect(page.locator('#usageSummary')).toContainText('6 of 6');
  await expect(page.locator('#usageRows tr')).toHaveCount(6);
  const raw = await page.request.get(`${center.url}/api/center/v1/entries/${center.entryId}/resources/log-${center.firstCycleId}?sourceId=${center.sourceId}`);
  expect(raw.ok()).toBeTruthy();
  expect(await raw.text()).toContain('projects/one private log');
});

test('healthy product preview is a separate loopback link, never an artifact document URL', async ({ page, center }) => {
  await page.goto(`${center.url}/products/${center.entryId}`);
  const preview = page.locator(`a[href="${center.previewUrl}"]`);
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('rel', /noopener/);
});

async function queueFixture(page, center, attention) {
  const entry = { entryId: center.entryId, sourceId: center.sourceId, kind: 'product', displayName: 'Queue fixture',
    revision: 1, sourceRevision: 1, availability: 'available', capabilities: { execute: true }, executionSummary: { state: 'ended' } };
  const request = { requestId: 'request_fixture', entryId: center.entryId, revision: 1, displayName: entry.displayName,
    state: attention ? 'attention' : 'queued', ...(attention ? { dispatchId: 'dispatch_fixture', attentionReason: 'recovery_required' } : {}) };
  const send = (route, data) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ schemaVersion: 1, centerId: 'fixture', revision: 1, observedAt: new Date().toISOString(), data }) });
  await page.route('**/api/center/v1/summary', route => send(route, { language: 'en', dispatchEnabled: false, queueRevision: 1,
    executionAvailable: true, currentRequest: attention ? request : null, queuedCount: attention ? 0 : 1, attentionCount: attention ? 1 : 0 }));
  await page.route('**/api/center/v1/entries?*', route => send(route, { items: [entry], total: 1, nextCursor: null }));
  await page.route('**/api/center/v1/requests?*', route => send(route, { items: [request], revision: 1 }));
  await openCenter(page, center);
}

test('an owned attention dispatch retains stop controls', async ({ page, center }) => {
  await queueFixture(page, center, true);
  await page.locator('#queueNavButton').click();
  await expect(page.locator('#stopAllButton')).toBeEnabled();
  await expect(page.locator('#queueContent button').filter({ hasText: /^Stop/ })).toBeVisible();
});

test('automatic refresh preserves focused product-menu and queue actions', async ({ page, center }) => {
  await queueFixture(page, center, false);
  const view = page.locator('.row-actions a').first();
  await view.focus();
  await page.waitForTimeout(5500);
  await expect(view).toBeFocused();
  await page.locator('.more-button').click();
  const action = page.locator('.menu-content button').first();
  await action.focus();
  const label = await action.textContent();
  await page.waitForTimeout(5500);
  expect(await page.evaluate(() => document.activeElement?.textContent)).toBe(label);
  await page.locator('#queueNavButton').click();
  const cancel = page.locator('#queueContent button').filter({ hasText: /^Cancel$/ });
  await cancel.focus();
  await page.waitForTimeout(5500);
  await expect(cancel).toBeFocused();
});

test('preparing start-now work can be stopped before a request exists', async ({ page, center }) => {
  const send = (route, data) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ schemaVersion: 1,
    centerId: 'fixture', revision: 1, observedAt: new Date().toISOString(), data }) });
  await page.route('**/api/center/v1/operations', route => send(route, { items: [{ operationId: 'preparing-fixture',
    kind: 'exploration', state: 'preparing', createdAt: new Date().toISOString(), revision: 1 }] }));
  await page.route('**/api/center/v1/summary', route => send(route, { language: 'en', dispatchEnabled: false,
    queueRevision: 1, executionAvailable: true, currentRequest: null, queuedCount: 0, attentionCount: 0, preparationCount: 1 }));
  await openCenter(page, center);
  await page.locator('#queueNavButton').click();
  await expect(page.locator('#stopAllButton')).toBeEnabled();
  await expect(page.locator('#queueNavCount')).toHaveText('1');
});

test.describe('long product history', () => {
  test.use({ centerCycles: 36 });
  test('limited older rows load their recorded detail and keep scoped logs', async ({ page, center }) => {
    await page.goto(`${center.url}/products/${center.entryId}`);
    await expect(page.locator('#historyList details')).toHaveCount(4);
    await page.locator('#olderButton').click();
    await expect(page.locator('#historyList details')).toHaveCount(35);
    const oldest = page.locator('#historyList details').last();
    await oldest.locator('summary').click();
    await expect(oldest).toContainText('Recorded fixture detail 1');
    await page.locator('#tab-usage').click();
    await page.locator('#usagePeriod').selectOption('all');
    await expect(page.locator('#usageSummary')).toContainText('360');
    await expect(page.locator('#usageSummary')).toContainText('36 of 36');
  });
});
