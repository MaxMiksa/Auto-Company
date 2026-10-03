import { test as base, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';

const test = base.extend({
  centerCycles: [6, { option: true }],
  centerExplorationCycles: [0, { option: true }],
  center: async ({ centerCycles, centerExplorationCycles }, use, testInfo) => {
    const child = spawn(process.env.AUTO_COMPANY_BROWSER_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
      ['-u', fileURLToPath(new URL('center-fixture-server.py', import.meta.url)), '--cycles', String(centerCycles), '--exploration-cycles', String(centerExplorationCycles)],
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

test('other products show four by default and expand with standard keyboard controls', async ({ page, center }) => {
  await page.route('**/api/center/v1/entries?*', async route => {
    const payload = await (await route.fetch()).json(), original = payload.data.items[0];
    payload.data.items = Array.from({ length: 12 }, (_, index) => ({ ...original,
      entryId: `${original.entryId}-${index}`, displayName: `Product ${index + 1}`,
      lastActivityAt: new Date(Date.now() - index * 60000).toISOString(),
      readonlyObservation: { readOnly: true, scoped: true, state: index === 0 ? 'running' : 'ended',
        processState: index === 0 ? 'running' : 'stopped', liveConfirmedAt: new Date().toISOString(), observedAt: new Date().toISOString() } }));
    payload.data.total = 12; payload.data.nextCursor = null;
    await route.fulfill({ json: payload });
  });
  await openCenter(page, center);
  const other = page.locator('.product-group').nth(1);
  await expect(other.locator('.product-row:visible')).toHaveCount(4);
  await expect(other.locator('.product-link:visible')).toHaveText(['Product 5', 'Product 6', 'Product 7', 'Product 8']);
  await expect(page.locator('.status-cell strong').first()).toHaveText('Running');
  const toggle = other.getByRole('button', { name: 'Show all 8', exact: true });
  await toggle.focus(); await page.keyboard.press('Enter');
  await expect(other.locator('.product-row:visible')).toHaveCount(8);
  await expect(other.getByRole('button', { name: 'Show less', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#settingsButton').click();
  await page.locator('#centerRefreshButton').click();
  await page.keyboard.press('Escape');
  await expect(other.locator('.product-row:visible')).toHaveCount(8);
  await other.getByRole('button', { name: 'Show less', exact: true }).click();
  await expect(other.locator('.product-row:visible')).toHaveCount(4);
  await page.locator('[data-filter="running"]').click();
  await expect(page.locator('.product-link:visible')).toHaveText(['Product 1']);
});

test('unconfirmed source status agrees across center and detail while English filters remain visible at 1064px', async ({ page, center }) => {
  await page.setViewportSize({ width: 1064, height: 750 });
  await openCenter(page, center);
  expect(await page.locator('[data-filter="archived"]').evaluate(node => {
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return node.contains(hit);
  })).toBe(true);
  await expect(page.locator('.status-cell > .status-symbol svg').first()).toHaveAttribute('data-lucide', 'circle-help');
  await page.goto(`${center.url}/products/${center.entryId}`);
  await expect(page.locator('#projectRuntimeStatus')).toContainText('Status unconfirmed');
  await expect(page.locator('#projectRuntimeStatus svg')).toHaveAttribute('data-lucide', 'circle-help');
  await expect(page.locator('#runtimeEvidence')).not.toBeEmpty();
  await expect(page.locator('#sidebarSlot')).toHaveText('No');
});

test('column controls sort globally, filter states and rounds, preserve focus, and show logo fallback', async ({ page, center }) => {
  await page.route('**/api/center/v1/entries?*', async route => {
    const response = await route.fetch(), payload = await response.json(), original = payload.data.items[0];
    const names = ['Zeta', 'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];
    const rounds = [6, 1, 5, 2, 4, 3], statuses = ['completed', 'running', 'completed', 'failed', 'not_started', 'startup_unconfirmed'];
    const runtimeStates = ['read_only', 'paused', 'ended', 'queued', 'idle', 'unknown'];
    payload.data.items = names.map((displayName, index) => ({ ...original, displayName, entryId: `${original.entryId}-${index}`, cycleNumber: rounds[index], latestCycleStatus: statuses[index], executionSummary: { state: runtimeStates[index] }, capabilities: { ...original.capabilities, execute: true }, latestWork: index === 0 ? { scope: 'exploration', cycleNumber: 2, isLatestCycle: false } : null, thumbnailUrl: index === 0 ? '/api/center/v1/invalid-preview' : null, iconUrl: null }));
    payload.data.total = names.length; payload.data.nextCursor = null;
    await route.fulfill({ json: payload });
  });
  await openCenter(page, center);
  await expect(page.locator('.product-group').first().locator('.product-row')).toHaveCount(4);
  await expect(page.locator('.thumbnail-missing-label')).toHaveCount(0);
  await expect(page.locator('.thumbnail-missing .product-icon svg')).toHaveCount(6);
  await expect(page.locator('.status-symbol svg')).toHaveCount(12);
  await expect(page.locator('[data-filter="running"] .filter-count')).toHaveCount(0);
  const productSort = page.locator('[data-focus-key="column:primary:name"]');
  await productSort.click();
  await expect(productSort).toBeFocused();
  await expect(page.locator('.product-group').first().locator('.product-link')).toHaveText(['Alpha', 'Beta', 'Delta', 'Epsilon']);
  await expect(page.locator('.product-group').first().locator('h2')).toContainText('Recent products');
  const runtime = page.locator('[data-focus-key="column:primary:status"]');
  await runtime.selectOption('filter:queued');
  await expect(runtime).toBeFocused();
  await expect(page.locator('.product-link')).toHaveText(['Gamma']);
  await expect(page.locator('[data-filter="queued"]')).toHaveAttribute('aria-pressed', 'true');
  await runtime.selectOption('filter:all');
  for (const [status, name] of [['paused', 'Alpha'], ['ended', 'Beta'], ['idle', 'Delta'], ['unknown', 'Epsilon']]) {
    await runtime.selectOption(`filter:${status}`);
    await expect(page.locator('.product-link')).toHaveText(status === 'unknown' ? ['Epsilon', 'Zeta'] : [name]);
    await expect(runtime).toBeFocused();
    await page.reload();
    await expect(runtime).toHaveValue(`filter:${status}`);
    await expect(page.locator('.product-link')).toHaveText(status === 'unknown' ? ['Epsilon', 'Zeta'] : [name]);
    await runtime.selectOption('filter:all');
  }
  await expect(page.locator('.work-source')).toHaveCount(0);
  const round = page.locator('[data-focus-key="column:primary:round"]');
  for (const [status, name, label] of [['not_started', 'Delta', 'Not started'], ['startup_unconfirmed', 'Epsilon', 'Startup unconfirmed']]) {
    await round.selectOption(`filter:${status}`);
    await expect(page.locator('.product-link')).toHaveText([name]);
    await expect(page.locator('.round-label')).toHaveText(label);
    await round.selectOption('filter:all');
  }
  await round.selectOption('filter:completed');
  await expect(page.locator('.product-link')).toHaveText(['Beta', 'Zeta']);
  await round.selectOption('sort:desc');
  await expect(page.locator('.product-link')).toHaveText(['Zeta', 'Beta']);
  await round.selectOption('filter:all');
  await expect(page.locator('.product-group').first().locator('.round-number')).toHaveText(['#06', '#05', '#04', '#03']);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(productSort).toBeVisible();
  await expect(round).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const evidence = fileURLToPath(new URL('../../acceptance/2026-10-03-live-dashboard/', import.meta.url));
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}/center-mobile-columns-fixture.png` });
  await page.setViewportSize({ width: 1064, height: 750 });
  await page.locator('[data-focus-key="column:primary:activity"]').click();
  await page.screenshot({ path: `${evidence}/center-columns-fixture.png` });
});

test('disconnected execution explains the disabled action inline without an info icon', async ({ page, center }) => {
  await page.route('**/api/center/v1/summary', async route => {
    const payload = await (await route.fetch()).json(); payload.data.executionAvailable = false;
    await route.fulfill({ json: payload });
  });
  await openCenter(page, center);
  await expect(page.locator('#newWorkButton')).toBeDisabled();
  await expect(page.locator('#newWorkInfo')).toHaveCount(0);
  await expect(page.locator('#newWorkUnavailable')).toBeVisible();
  await expect(page.locator('#newWorkUnavailable')).toContainText('No managed execution environment');
  expect(await page.locator('#capacitySummary').evaluate(node => !!node.closest('.queue-sidebar'))).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#newWorkUnavailable')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('center and long form obey every layout breakpoint, touch targets and enlarged text', async ({ page, center, browser }, testInfo) => {
  await openCenter(page, center);
  for (const width of [320, 359, 360, 390, 640, 641, 650, 651, 760, 761, 1000, 1001, 1064, 1440, 1450, 1800]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth, nodes: [...document.querySelectorAll('body *')].map(node => ({ tag: node.tagName, id: node.id, class: node.className, right: node.getBoundingClientRect().right })).filter(node => node.right > innerWidth && typeof node.class === 'string').slice(0, 8) }));
    expect(overflow.width <= overflow.viewport, `Center overflow at ${width}: ${JSON.stringify(overflow.nodes)}`).toBe(true);
  }
  const evidence = fileURLToPath(new URL('../../acceptance/2026-10-03-controls/fixtures/', import.meta.url));
  await mkdir(evidence, { recursive: true });
  await page.setViewportSize({ width: 1064, height: 750 });
  await page.screenshot({ path: `${evidence}/center-desktop-fixture.png` });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.screenshot({ path: `${evidence}/center-320-fixture.png` });
  await page.locator('#newWorkButton').click();
  await expect(page.locator('#newWorkTitle')).toBeFocused();
  await expect.poll(() => page.locator('.ac-dialog[data-state="open"]').evaluate(node => getComputedStyle(node).opacity)).toBe('1');
  const form = page.locator('#newWorkForm');
  const modal = await page.locator('.ac-dialog[data-state="open"]').boundingBox();
  expect(modal.x).toBeGreaterThanOrEqual(0); expect(modal.y).toBeGreaterThanOrEqual(0);
  expect(modal.x + modal.width).toBeLessThanOrEqual(320); expect(modal.y + modal.height).toBeLessThanOrEqual(844);
  expect(await form.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${evidence}/long-form-320-fixture.png` });
  await page.locator('#newWorkDialog .dialog-close').first().click();
  await page.setViewportSize({ width: 532, height: 844 });
  await page.addStyleTag({ content: 'html{font-size:32px!important}' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#newWorkButton').click();
  expect(await form.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect.poll(() => page.locator('.ac-dialog[data-state="open"]').evaluate(node => getComputedStyle(node).opacity)).toBe('1');
  await page.locator('#newWorkForm [name="direction"]').scrollIntoViewIfNeeded();
  await expect(page.locator('#newWorkForm [name="direction"]')).toBeInViewport();
  await page.locator('#newWorkForm [type="submit"]').scrollIntoViewIfNeeded();
  await expect(page.locator('#newWorkForm [type="submit"]')).toBeInViewport();
  await page.screenshot({ path: `${evidence}/long-form-enlarged-text-fixture.png` });
  await page.locator('#newWorkDialog .dialog-close').first().click();
  // A 1064x750 desktop at 200% browser zoom has a 532x375 CSS viewport.
  await page.addStyleTag({ content: 'html{font-size:16px!important}' });
  await page.setViewportSize({ width: 532, height: 375 });
  await page.locator('#newWorkButton').click();
  await expect.poll(() => page.locator('.ac-dialog[data-state="open"]').evaluate(node => getComputedStyle(node).opacity)).toBe('1');
  expect(await page.locator('#newWorkForm .work-layout').evaluate(node => node.clientHeight)).toBeGreaterThanOrEqual(120);
  const assertReadableBelowHeader = async locator => {
    await expect(locator).toBeInViewport({ ratio: 1 });
    const box = await locator.boundingBox(), header = await page.locator('#newWorkForm .dialog-header').boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(header.y + header.height);
    expect(box.y + box.height).toBeLessThanOrEqual(375);
  };
  await page.locator('#newWorkForm [name="count"]').scrollIntoViewIfNeeded();
  await assertReadableBelowHeader(page.locator('#newWorkForm [name="count"]'));
  await page.locator('#newWorkForm [name="direction"]').scrollIntoViewIfNeeded();
  await assertReadableBelowHeader(page.locator('#newWorkForm [name="direction"]'));
  await page.screenshot({ path: `${evidence}/long-form-200-percent-fields-fixture.png` });
  await page.locator('#newWorkForm [type="submit"]').scrollIntoViewIfNeeded();
  await assertReadableBelowHeader(page.locator('#newWorkForm [type="submit"]'));
  await expect(page.locator('#newWorkDialog .dialog-close').first()).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: `${evidence}/long-form-200-percent-fixture.png` });
  await page.locator('#newWorkDialog .dialog-close').first().click();
  const touch = await browser.newContext({ hasTouch: true, viewport: { width: 1000, height: 900 } });
  const touchPage = await touch.newPage();
  try {
    await openCenter(touchPage, center);
    const targets = await touchPage.locator('#newWorkButton, #importButton, #queueNavButton, #settingsButton, .row-actions button').evaluateAll(nodes => nodes.map(node => { const box = node.getBoundingClientRect(); return { width: box.width, height: box.height }; }));
    for (const target of targets) expect(target.height).toBeGreaterThanOrEqual(44);
    await touchPage.screenshot({ path: `${evidence}/center-coarse-1000-fixture.png` });
  } finally { await touch.close(); }
  await testInfo.attach('center-responsive-fixture', { path: `${evidence}/center-320-fixture.png`, contentType: 'image/png' });
});

test('center retains session search and filter on return and explains unavailable records', async ({ page, center }) => {
  await openCenter(page, center);
  const name = await page.locator('.product-link').first().textContent();
  await page.locator('#productSearch').fill(name);
  await expect(page.locator('#searchStatus')).toContainText('1 products found');
  await page.locator('[data-focus-key="column:primary:status"]').selectOption('filter:unknown');
  await expect(page.locator('.product-row')).toHaveCount(1);
  await expect(page.locator('.status-explanation')).toHaveCount(0);
  await page.locator('.product-link').click();
  await expect(page.locator('#journalBackLink')).toBeVisible();
  await page.locator('#journalBackLink').click();
  await expect(page.locator('#productSearch')).toHaveValue(name);
  await expect(page.locator('[data-focus-key="column:primary:status"]')).toHaveValue('filter:unknown');
  await page.locator('#productSearch').fill('unmatched-query');
  await expect(page.locator('#listState')).toContainText('unmatched-query');
  await expect(page.locator('#listState')).toContainText('Status unavailable');
  await page.locator('#listState button').click();
  await expect(page.locator('#productSearch')).toHaveValue('');
  await expect(page.locator('#productSearch')).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.recent-work').first()).toHaveAttribute('data-label', 'Latest work');
});

test('center refresh failure preserves last successful data time and retries in place', async ({ page, center }) => {
  await openCenter(page, center);
  const observed = await page.locator('#observedAt').getAttribute('title');
  const count = await page.locator('.product-row').count();
  let fail = true;
  await page.route('**/api/center/v1/entries?*', async route => fail ? route.fulfill({ status: 503, json: { code: 'UNAVAILABLE' } }) : route.continue());
  await expect(page.locator('#connectionNotice')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.product-row')).toHaveCount(count);
  await expect(page.locator('#observedAt')).toHaveAttribute('title', observed);
  await expect(page.locator('#connectionNotice')).toContainText('last records');
  fail = false;
  await page.locator('#connectionNotice button').click();
  await expect(page.locator('#connectionNotice')).toBeHidden();
});

test('center validation links field errors and guards repeated batch submission', async ({ page, center }) => {
  await openCenter(page, center);
  await page.locator('#newWorkButton').click();
  const input = page.locator('#newWorkForm [name="count"]');
  await input.fill('0');
  await page.locator('#newWorkForm [type="submit"]').click();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  const errorId = await input.getAttribute('aria-describedby');
  await expect(page.locator(`[id="${errorId}"]`)).toContainText('between 1 and 100');
  await input.fill('1');
  await expect(input).not.toHaveAttribute('aria-invalid', 'true');
  let writes = 0;
  await page.route('**/api/center/v1/explorations/batch', async route => {
    writes += 1;
    await new Promise(resolve => setTimeout(resolve, 800));
    await route.fulfill({ status: 503, json: { code: 'CONTEXT_UNAVAILABLE' } });
  });
  const idleWidth = (await page.locator('#newWorkForm [type="submit"]').boundingBox()).width;
  await page.locator('#newWorkForm [type="submit"]').click();
  await expect(page.locator('#newWorkForm')).toHaveAttribute('aria-busy', 'true');
  expect((await page.locator('#newWorkForm [type="submit"]').boundingBox()).width).toBe(idleWidth);
  await page.locator('#newWorkForm').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await expect(page.locator('#newWorkForm .form-status')).toContainText('Action did not complete');
  expect(writes).toBe(1);
  await expect(input).toHaveValue('1');
});

test('center automatic reading can be paused and manually resumed without losing records', async ({ page, center }) => {
  await openCenter(page, center);
  await page.locator('#settingsButton').click();
  await page.locator('#centerAutoRefresh-control').uncheck();
  await page.locator('#settingsDialog .dialog-close').first().click();
  let reads = 0;
  page.on('request', request => { if (request.url().endsWith('/api/center/v1/summary')) reads += 1; });
  await page.waitForTimeout(5400);
  expect(reads).toBe(0);
  await page.reload();
  await expect(page.locator('#observedAt')).not.toBeEmpty();
  await page.locator('#settingsButton').click();
  await expect(page.locator('#centerAutoRefresh-control')).not.toBeChecked();
  const before = reads;
  await page.locator('#centerRefreshButton').click();
  await expect.poll(() => reads).toBeGreaterThan(before);
  await expect(page.locator('#observedAt')).toContainText('Read at');
});

test('center restores reading position and moves focus when a refreshed product disappears', async ({ page, center }) => {
  let removeFirst = false;
  await page.route('**/api/center/v1/entries?*', async route => {
    const response = await route.fetch(), payload = await response.json(), original = payload.data.items[0];
    payload.data.items = Array.from({ length: 24 }, (_, index) => ({ ...original, entryId: index ? `${original.entryId}-${index}` : original.entryId, displayName: `Product ${index + 1}` }));
    if (removeFirst) payload.data.items.shift();
    payload.data.total = payload.data.items.length; payload.data.nextCursor = null;
    await route.fulfill({ json: payload });
  });
  await openCenter(page, center);
  await page.getByRole('button', { name: /Show all/ }).click();
  await page.evaluate(() => window.scrollTo(0, 500));
  await page.locator('.product-link').first().evaluate(link => link.click());
  await expect(page.locator('#journalBackLink')).toBeVisible();
  await page.locator('#journalBackLink').click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(400);
  await page.locator('.product-link').first().focus();
  removeFirst = true;
  await expect(page.locator('.product-link').first()).toHaveText('Product 2', { timeout: 8000 });
  await expect(page.locator('.product-link').first()).toBeFocused();
  await expect(page.locator('#searchStatus')).toContainText('Focus moved');
});

test('D catalog separates runtime from latest round, keeps title navigation and fits mobile', async ({ page, center }) => {
  await openCenter(page, center);
  const row = page.locator('.product-row').first();
  await expect(page.locator('.center-header #queueNavButton')).toHaveCount(0);
  await expect(row.locator('.row-actions a')).toHaveCount(0);
  await expect(row.locator('.latest-round')).toContainText('#06');
  await expect(row.locator('.latest-round')).toContainText('Completed');
  await expect(row.locator('.status-cell')).not.toContainText('Completed');
  await page.locator('#productSearch').fill('no-such-product');
  await expect(page.locator('.product-row')).toHaveCount(0);
  await page.locator('#productSearch').fill('');
  await expect(row).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#queueNavButton').click();
  await expect(page.locator('#capacityForm')).toBeVisible();
  await page.locator('#closeQueueButton').click();
  await row.locator('.product-link').click();
  await expect(page.locator('#cycleNumber')).toHaveText('06');
  await expect(page.locator('#runHeading')).toHaveCount(0);
  await expect(page.locator('.history-row .progress-completed')).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('D reference keeps recent products independent of running state and uses compact geometry', async ({ page, center }) => {
  await page.route('**/api/center/v1/entries?*', async route => {
    const response = await route.fetch();
    const payload = await response.json();
    const entry = payload.data.items[0];
    payload.data.items = Array.from({ length: 6 }, (_, index) => ({ ...entry,
      entryId: index ? `${entry.entryId}-${index}` : entry.entryId,
      displayName: `Product ${index + 1}`, executionSummary: { state: 'unknown' },
      latestCycleStatus: ['completed', 'pending', 'interrupted', 'completed_with_timeout', 'failed', 'unknown'][index],
      lastActivityAt: `2026-09-${String(26 - index).padStart(2, '0')}T01:00:00Z`,
    }));
    payload.data.total = 6; payload.data.nextCursor = null;
    await route.fulfill({ json: payload });
  });
  await page.setViewportSize({ width: 1064, height: 750 });
  await openCenter(page, center);
  const groups = page.locator('.product-group');
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0).locator('h2')).toHaveText('Recent products4');
  await expect(groups.nth(1).locator('h2')).toHaveText('Other products2');
  await expect(groups.nth(0).locator('.product-row')).toHaveCount(4);
  await expect(groups.nth(1).locator('.product-row')).toHaveCount(2);
  await expect(groups.nth(0).locator('.latest-round .status-symbol')).toHaveClass([
    'status-symbol completed', 'status-symbol queued', 'status-symbol paused', 'status-symbol paused',
  ]);
  expect((await page.locator('.header-inner').boundingBox()).height).toBe(42);
  // Unknown-state reasons must remain readable; 66px is a minimum, not a cap.
  expect((await groups.nth(0).locator('.product-row').first().boundingBox()).height).toBeGreaterThanOrEqual(66);
  await expect(page.locator('.status-explanation')).toHaveCount(0);
  const fonts = await page.locator('.product-name').first().evaluate(node => ({ family: getComputedStyle(node).fontFamily, size: getComputedStyle(node).fontSize }));
  expect(fonts.family).toContain('Arial'); expect(fonts.size).toBe('16px');
  await page.locator('#productSearch').fill('Product 6');
  await expect(page.locator('.product-row')).toHaveCount(1);
  await expect(page.locator('.product-link')).toHaveText('Product 6');
  await page.locator('#productSearch').fill('');
  await page.locator('#profileButton').click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await expect(page.locator('#settingsDialog')).toBeVisible();
});

test('expired active evidence is unconfirmed rather than zero running', async ({ page, center }) => {
  await page.route('**/api/center/v1/summary', async route => {
    const payload = await (await route.fetch()).json();
    payload.data.currentRequests = [{ requestId: 'expired-request', entryId: center.entryId,
      state: 'running', liveConfirmedAt: '2000-01-01T00:00:00Z' }];
    payload.data.occupiedCount = 1;
    await route.fulfill({ json: payload });
  });
  await openCenter(page, center);
  await expect(page.locator('#capacitySummary')).toHaveText('Runtime status unconfirmed');
});

test('configuration templates persist, mixed groups freeze settings, and clearing default uses last submission', async ({ page, center }) => {
  await openCenter(page, center);
  await page.locator('#newWorkButton').click();
  const first = page.locator('.work-group').first();
  await first.locator('[name="engine"]').selectOption('codex');
  await first.locator('[name="model"]').fill('gpt-6.1-sol');
  await first.locator('[name="effort"]').selectOption('high');
  await first.locator('.template-manage-toggle').click();
  await first.locator('.template-name').fill('My high configuration');
  await first.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(first.locator('.template-status')).toHaveText('Template settings saved.');
  await first.getByRole('button', { name: 'Set as default', exact: true }).click();
  await expect(first.locator('.template-select option:checked')).toContainText('Default');
  await first.locator('[name="count"]').fill('2');
  await page.locator('#addWorkGroup').click();
  const second = page.locator('.work-group').nth(1);
  await expect(second.locator('[name="model"]')).toHaveValue('gpt-6.1-sol');
  await second.locator('[name="effort"]').selectOption('xhigh');
  await second.locator('[name="count"]').fill('2');
  const sent = page.waitForRequest(request => request.url().endsWith('/explorations/batch') && request.method() === 'POST');
  await page.locator('#newWorkForm > .dialog-actions [type="submit"]').click();
  const batch = (await sent).postDataJSON();
  expect(batch.groups.map(group => [group.count, group.config.effort, group.direction])).toEqual([[2, 'high', ''], [2, 'xhigh', '']]);
  await expect(page.locator('#newWorkDialog')).not.toBeVisible();
  await page.reload();
  await expect(page.locator('#observedAt')).not.toBeEmpty();
  await page.locator('#newWorkButton').click();
  await expect(page.locator('.work-group').first().locator('[name="effort"]')).toHaveValue('high');
  await page.locator('#newWorkDialog .dialog-close').first().click();
  await page.locator('#settingsButton').click();
  await expect(page.locator('#settingsForm .template-select')).toBeVisible();
  await page.locator('#settingsForm .template-editor .disclosure-trigger').click();
  await page.getByRole('button', { name: 'Clear default template', exact: true }).click();
  await expect(page.locator('#settingsForm .template-status')).toHaveText('Template settings saved.');
  await page.locator('#settingsDialog .dialog-close').first().click();
  await page.locator('#newWorkButton').click();
  await expect(page.locator('.work-group').first().locator('[name="effort"]')).toHaveValue('xhigh');
  const prefs = (await (await page.request.get(`${center.url}/api/center/v1/preferences`)).json()).data;
  expect(prefs.templates[0].config.effort).toBe('high');
  expect(prefs.templates[0].config).not.toHaveProperty('direction');
});

test('concurrency is editable in the existing queue and unlimited persists across reload', async ({ page, center }) => {
  await openCenter(page, center);
  await page.locator('#queueNavButton').click();
  await expect(page.locator('#capacityForm [name="capacity"]')).toHaveValue('4');
  await page.locator('#capacityForm [name="capacity"]').fill('2');
  await page.locator('#capacityForm [type="submit"]').click();
  await expect(page.locator('#capacityForm .form-status')).toHaveText('Concurrency updated.');
  await page.locator('#capacityForm [role="checkbox"]').check();
  await page.locator('#capacityForm [type="submit"]').click();
  await expect.poll(async () => (await (await page.request.get(`${center.url}/api/center/v1/summary`)).json()).data.maxConcurrentProjects).toBeNull();
  await page.reload();
  await expect(page.locator('#observedAt')).not.toBeEmpty();
  await page.locator('#queueNavButton').click();
  await expect(page.locator('#capacityForm [role="checkbox"]')).toBeChecked();
  await expect(page.locator('#capacityForm [name="capacity"]')).toBeDisabled();
});

test('group editor preserves drafts, supports keyboard switching, and reveals invalid hidden fields', async ({ page, center }) => {
  await openCenter(page, center);
  await page.locator('#newWorkButton').click();
  const first = page.locator('.work-group').first();
  await first.locator('[name="count"]').fill('2');
  await first.locator('[name="direction"]').fill('First direction');
  await first.locator('[name="model"]').fill('gpt-6.1-sol');
  await page.locator('#addWorkGroup').click();
  let second = page.locator('.work-group').nth(1);
  await second.locator('[name="effort"]').selectOption('xhigh');
  await second.locator('[name="direction"]').fill('Second direction');
  await second.locator('[data-count-step="1"]').click();
  await expect(page.locator('#workBatchSummary')).toHaveText('4 projects · 2 groups');
  await page.locator('#workGroupTabs [role="tab"]').first().click();
  await expect(first).toBeVisible();
  await expect(second).not.toBeVisible();
  await expect(first.locator('[name="direction"]')).toHaveValue('First direction');
  await expect(first.locator('[name="model"]')).toHaveValue('gpt-6.1-sol');
  await page.locator('#workGroupTabs [role="tab"]').first().press('ArrowDown');
  await expect(second.locator('[name="direction"]')).toHaveValue('Second direction');
  await expect(second.locator('[name="effort"]')).toHaveValue('xhigh');
  await second.locator('.remove-group').click();
  await expect(first).toBeVisible();
  await expect(first.locator('.remove-group')).not.toBeVisible();
  await page.locator('#addWorkGroup').click();
  second = page.locator('.work-group').nth(1);
  await expect(second.locator('[name="direction"]')).toHaveValue('');
  await expect(second.locator('[name="effort"]')).toHaveValue('high');
  await second.locator('[name="count"]').fill('2');
  await page.locator('#workGroupTabs [role="tab"]').first().click();
  await first.locator('[name="count"]').fill('99');
  const submit = page.locator('#newWorkForm [type="submit"]');
  await expect(submit).toBeDisabled();
  await first.locator('[name="count"]').fill('0');
  await page.locator('#workGroupTabs [role="tab"]').nth(1).click();
  await submit.click();
  await expect(first).toBeVisible();
  await expect(first.locator('[name="count"]')).toBeFocused();
  await first.locator('[name="count"]').fill('2');
  const sent = page.waitForRequest(request => request.url().endsWith('/explorations/batch') && request.method() === 'POST');
  await submit.click();
  expect((await sent).postDataJSON().groups.map(group => [group.count, group.direction])).toEqual([[2, 'First direction'], [2, '']]);
});

test('Chinese batch and queue controls fit desktop and narrow screens', async ({ page, center }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openCenter(page, center);
  await page.locator('#settingsButton').click();
  await page.locator('#settingsForm [name="language"]').selectOption('zh-CN');
  await page.locator('#settingsForm [type="submit"]').click();
  await expect(page.locator('#settingsDialog')).not.toBeVisible();
  await page.locator('#newWorkButton').click();
  await expect(page.locator('.work-group [name="effort"]')).toHaveValue('high');
  await expect(page.locator('#newWorkForm [type="submit"]')).toBeInViewport();
  const editor = page.locator('.work-group');
  expect((await editor.locator('[name="engine"]').boundingBox()).y).toBeLessThan((await editor.locator('[name="model"]').boundingBox()).y);
  expect((await editor.locator('[name="productLanguage"]').boundingBox()).y).toBeLessThan((await editor.locator('[name="effort"]').boundingBox()).y);
  await page.screenshot({ path: testInfo.outputPath('dialog-b-desktop-zh.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#addWorkGroup').click();
  await expect(page.locator('.work-group')).toHaveCount(2);
  expect(await page.locator('#newWorkDialog').evaluate(node => node.scrollWidth <= node.clientWidth)).toBeTruthy();
  await expect(page.locator('#newWorkForm [type="submit"]')).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('dialog-b-narrow-zh.png') });
  await page.locator('#newWorkDialog .dialog-close').first().click();
  await page.locator('#queueNavButton').click();
  await expect(page.locator('#capacityForm [type="submit"]')).toBeVisible();
  await expect.poll(() => page.locator('[data-slot=sheet-content]').evaluate(node => Math.round(node.getBoundingClientRect().left))).toBe(0);
  expect(await page.locator('#capacityForm').evaluate(node => node.scrollWidth <= node.clientWidth)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('queue-narrow-zh.png') });
});

test('default autonomous creation uses empty text and preserves preparation failures after reload', async ({ page, center }) => {
  await openCenter(page, center);
  await page.locator('#newWorkButton').click();
  const created = page.waitForRequest(request => request.url().endsWith('/api/center/v1/explorations/batch') && request.method() === 'POST');
  await page.locator('#newWorkForm [type="submit"]').click();
  expect((await created).postDataJSON().groups[0].direction).toBe('');
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
  await expect(page.locator('#historyList [data-disclosure]')).toHaveCount(5);
  await page.locator('#tab-usage').click();
  await page.locator('#usagePeriod').selectOption('all');
  await expect(page.locator('#usageSummary .usage-group')).toHaveCount(6);
  await expect(page.locator('#usageSummary')).toContainText('1 of 1');
  await expect(page.locator('#usageRows tr')).toHaveCount(6);
  expect(await page.locator('#usageRows tr').evaluateAll(rows => rows.reduce((sum, row) => sum + Number(row.cells[5].textContent.replace(/,/g, '')), 0))).toBe(60);
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
  const view = page.locator('.product-link').first();
  await view.focus();
  await page.waitForTimeout(5500);
  await expect(view).toBeFocused();
  const queuedProduct = page.locator('.queue-preview-name').first();
  await queuedProduct.focus();
  await page.waitForTimeout(5500);
  await expect(queuedProduct).toBeFocused();
  await page.locator('.product-row .more-button').first().click();
  const action = page.locator('[role=menuitem]:not([data-disabled])').first();
  await action.focus();
  const label = await action.textContent();
  await page.waitForTimeout(5500);
  expect(await page.evaluate(() => document.activeElement?.textContent)).toBe(label);
  await action.press('Escape');
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
    await expect(page.locator('#historyList [data-disclosure]')).toHaveCount(35);
    const oldest = page.locator('#historyList [data-disclosure]').last();
    await oldest.locator('.disclosure-trigger').click();
    await expect(oldest).toContainText('Recorded fixture detail 1');
    await page.locator('#tab-usage').click();
    await page.locator('#usagePeriod').selectOption('all');
    await expect(page.locator('#usageSummary .usage-group')).toHaveCount(36);
    await expect(page.locator('#usageSummary')).toContainText('1 of 1');
    await expect(page.locator('#usageRows tr')).toHaveCount(36);
    expect(await page.locator('#usageRows tr').evaluateAll(rows => rows.reduce((sum, row) => sum + Number(row.cells[5].textContent.replace(/,/g, '')), 0))).toBe(360);
  });
});

test.describe('continuous linked exploration history', () => {
  test.use({ centerExplorationCycles: 3 });
  test('default product page includes exploration and retains its original scoped log', async ({ page, center }) => {
    await page.goto(`${center.url}/products/${center.entryId}`);
    await expect(page.locator('#historyList [data-disclosure]')).toHaveCount(8);
    await expect(page.locator('#cycleNumber')).toHaveText('09');
    await expect(page.locator('#historyList .history-number-value')).toHaveText(['08', '07', '06', '05', '04', '03', '02', '01']);
    const earliest = page.locator('#historyList [data-disclosure]').last();
    await earliest.locator('.disclosure-trigger').click();
    await expect(earliest).toContainText('Recorded exploration detail 1');
    const endpoint = `${center.url}/api/center/v1/entries/${center.entryId}`;
    const journal = (await (await page.request.get(`${endpoint}/journal?limit=100`)).json()).data;
    expect(journal.cycles).toHaveLength(9);
    expect(journal.cycles.slice(-3).map(row => row.id)).toEqual([...center.explorationCycleIds].reverse());
    expect(journal.cycles[0].number).toBe(6);
    expect(journal.cycles[0].sequenceNumber).toBe(9);
    const selected = (await (await page.request.get(`${endpoint}/journal?section=exploration&limit=100&sourceId=${center.sourceId}`)).json()).data;
    expect(selected.cycles.map(row => row.id)).toEqual([...center.explorationCycleIds].reverse());
    const log = await page.request.get(new URL(journal.cycles.at(-1).logUrl, center.url).href);
    expect(log.ok()).toBeTruthy();
    expect(await log.text()).toBe('exploration private log');
  });
});


test('shared shadcn menus and dialogs preserve focus, form nodes and keyboard boundaries', async ({ page, center }) => {
  await openCenter(page, center);
  await expect(page.locator('html')).toHaveAttribute('data-ui', 'shadcn');
  const trigger = page.locator('.product-row .more-button').first();
  await trigger.click();
  await page.getByRole('menuitem', { name: 'Manage sources', exact: true }).click();
  await expect(page.locator('[data-slot=dialog-content]')).toBeVisible();
  await page.locator('#sourceDialog button').first().press('Escape');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.locator('#confirmDialog .dialog-close').first().press('Escape');
  await expect(trigger).toBeFocused();
  await page.locator('#importButton').click();
  await page.locator('#importForm [name=root]').fill('draft-path');
  await page.locator('#importForm [name=root]').press('Tab');
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[data-slot=dialog-content]')))).toBeTruthy();
  await page.locator('#importDialog .dialog-close').first().click();
  await expect(page.locator('#importButton')).toBeFocused();
  await expect(page.locator('#importForm [name=root]')).toHaveValue('draft-path');
  await page.locator('#importButton').click();
  await expect(page.locator('#importForm [name=root]')).toHaveValue('');
  await page.locator('#importForm [name=root]').press('Escape');
  await expect(page.locator('#importButton')).toBeFocused();
});

test('standard controls own selection, reset, notifications and product search', async ({ page, center }) => {
  await openCenter(page, center);
  await page.locator('#newWorkButton').click();
  const form = page.locator('#newWorkForm');
  await expect(form.locator('[data-slot=native-select-wrapper] select').first()).toBeVisible();
  const choices = form.getByRole('radio');
  await expect(choices).toHaveCount(2);
  await expect(choices.last()).toBeChecked();
  await choices.last().focus(); await page.keyboard.press('ArrowLeft', { delay: 80 });
  await expect(choices.first()).toBeChecked();
  expect(await form.evaluate(node => new FormData(node).get('executionMode'))).toBe('start_now');
  await page.keyboard.press('Escape');
  await page.locator('#newWorkButton').click();
  await expect(choices.last()).toBeChecked();
  await page.locator('#addWorkGroup').click();
  await expect(form.locator('.work-group:not([hidden]) [data-slot=native-select-wrapper] select').first()).toBeVisible();
  await expect(form.getByRole('radio')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await page.locator('#settingsButton').click();
  await expect(page.locator('#settingsForm').getByRole('switch')).toHaveCount(1);
  await page.locator('#settingsForm [type=submit]').click();
  await expect(page.locator('[data-sonner-toast]')).toContainText('saved');
  await page.goto(`${center.url}/products/${center.entryId}`);
  await page.locator('#productSwitcherButton').click();
  await expect(page.locator('#productSwitcherControls [cmdk-list]').getByRole('option').first()).toBeVisible();
  const search = page.locator('#productSwitcherControls [cmdk-input]');
  await search.fill('unmatched-product-123');
  await expect(page.locator('[cmdk-empty]')).toBeVisible();
  await search.fill('');
  await expect(page.locator('#productSwitcherControls [cmdk-item]').first()).toBeVisible();
  await search.press('ArrowDown', { delay: 80 });
  await expect(page.locator('#productSwitcherControls [cmdk-item][aria-selected=true]')).toHaveCount(1);
  await search.press('Enter');
  await expect(page.locator('#cycleTitle')).toBeVisible();
  await page.locator('#productSwitcherButton').click();
  await expect(page.locator('#productSwitcherControls [cmdk-item]').first()).toBeVisible();
  await search.press('Escape'); await expect(page.locator('#productSwitcherButton')).toBeFocused();
});

test('catalog controls preserve search, preview choice and whole-row navigation', async ({ page, center }) => {
  await page.addInitScript(() => window.addEventListener('pagereveal', event => {
    if (event.viewTransition) event.viewTransition.ready.then(() => { window.navigationTransition = 'ready'; }, () => { window.navigationTransition = 'skipped'; });
  }));
  await openCenter(page, center);
  const search = page.locator('#productSearch');
  await page.mouse.move(0, 0);
  await expect.poll(async () => (await search.boundingBox()).width).toBeLessThan(50);
  await search.hover();
  await expect.poll(async () => (await search.boundingBox()).width).toBeGreaterThan(180);
  await search.fill('fixture');
  await page.locator('.brand').focus(); await page.mouse.move(0, 0);
  await expect.poll(async () => (await search.boundingBox()).width).toBeGreaterThan(180);
  await search.fill(''); await page.locator('.brand').focus(); await page.mouse.move(0, 0);
  await expect.poll(async () => (await search.boundingBox()).width).toBeLessThan(50);
  const filters = page.locator('#filters');
  await filters.locator('[data-filter=running]').click();
  await expect(filters.locator('[data-state=on]')).toHaveCount(1);
  await filters.locator('[data-filter=all]').click();
  await filters.locator('[data-filter=all]').click();
  await expect(filters.locator('[data-state=on]')).toHaveCount(1);
  await filters.locator('[data-filter=all]').focus(); await page.keyboard.press('ArrowRight'); await expect(filters.locator('[data-filter=running]')).toBeFocused(); await page.keyboard.press('Space');
  await expect(filters.locator('[data-filter=running]')).toHaveAttribute('data-state', 'on');
  await filters.locator('[data-filter=all]').click();
  const preview = page.locator('.preview-select').first();
  await preview.selectOption('none');
  await expect(page.locator('.product-example > *')).toHaveCount(0);
  await preview.selectOption('logo');
  await expect(page.locator('.product-example .product-icon').first()).toBeVisible();
  await preview.selectOption('screenshot');
  const row = page.locator(`.product-row[data-entry-id="${center.entryId}"]`);
  await row.locator('.recent-work').click();
  await expect(page).toHaveURL(`${center.url}/products/${center.entryId}`);
  await expect.poll(() => page.evaluate(() => window.navigationTransition)).toBe('ready');
  await expect(page.locator('#projectName')).toBeVisible();
  expect(await page.locator('#journalBackLink').evaluate(node => !!node.closest('.topbar'))).toBeTruthy();
  const history = page.locator('.history-row').first();
  await history.locator('.disclosure-trigger').click();
  await expect(history.locator('.cycle-report-surface')).toBeVisible();
  await expect(history.locator('.cycle-report-footer .cycle-log-link')).toBeVisible();
  const surfaces = await page.locator('.cycle-report-surface').evaluateAll(nodes => nodes.filter(n => n.offsetParent).map(n => getComputedStyle(n).backgroundColor));
  expect(new Set(surfaces).size).toBe(1);
  await page.locator('#journalBackLink').click();
  await expect(page.locator('.preview-select').first()).toHaveValue('screenshot');
  await expect(page.locator('#queueSidebarContent .queue-empty')).toHaveCount(0);
  for (const width of [390, 1359]) {
    await page.setViewportSize({ width, height: 919 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
});

test('reviewed layouts use white fields, compact settings and continuous product history', async ({ page, center }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openCenter(page, center);
  await expect(page.locator('.product-group-title').first()).toContainText('Recent products');
  const headings = await page.locator('.product-head').first().locator('th').allTextContents();
  expect(headings.map(text => text.trim().split('\n')[0])).toEqual(expect.arrayContaining(['Name', 'Latest work', 'Updated']));
  expect(headings[2]).toMatch(/^Runtime/);
  expect(headings[3]).toMatch(/Latest round/);
  await expect(page.locator('#capacitySummary')).toBeAttached();
  expect(await page.locator('#capacitySummary').evaluate(node => !!node.closest('.queue-sidebar'))).toBeTruthy();
  await expect(page.locator('.catalog-footer')).toHaveCount(0);
  expect(await page.locator('#productSearch').evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await page.locator('#settingsButton').click();
  await expect(page.locator('#settingsForm').getByRole('switch')).toBeVisible();
  for (const width of [1359, 390]) {
    await page.setViewportSize({ width, height: 919 });
    await expect.poll(async () => {
      const rect = await page.locator('#settingsForm').boundingBox();
      return rect.x >= 0 && rect.x + rect.width <= width;
    }).toBeTruthy();
    await expect(page.locator('#settingsForm [type=submit]')).toBeInViewport();
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('#settingsButton')).toBeFocused();
  await page.setViewportSize({ width: 1359, height: 919 });
  await page.goto(`${center.url}/products/${center.entryId}`);
  await expect(page.locator('#projectName')).toBeVisible();
  await expect(page.locator('#runtimeNotice')).toBeHidden();
  await expect(page.locator('.history-number .cycle-date')).toHaveCount(0);
  await expect(page.locator('.cycle-records h3')).toHaveCount(0);
  const layout = await page.evaluate(() => {
    const tabs = document.querySelector('[data-slot=tabs-list]');
    const node = document.querySelector('.history-row .progress-node');
    return { tabsScroll: ['auto', 'scroll'].includes(getComputedStyle(tabs).overflowY) && tabs.scrollHeight > tabs.clientHeight, icon: node.querySelector('svg').getBoundingClientRect().height, node: node.getBoundingClientRect().height,
      statusInName: !!document.querySelector('#projectRuntimeStatus').closest('.project-identity'), overflow: document.documentElement.scrollWidth > innerWidth };
  });
  expect(layout.tabsScroll).toBeFalsy();
  expect(layout.icon).toBe(layout.node);
  expect(layout.statusInName).toBeTruthy();
  expect(layout.overflow).toBeFalsy();
});
