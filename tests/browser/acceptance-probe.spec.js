import { test, expect } from './fixtures.js';

test('disposable acceptance probe: browser failure must block the CI gate', async ({ page }) => {
  await expect(page).toHaveTitle('Auto Company Control Deck');
  expect(false, 'Intentional acceptance failure; this draft PR must never be merged').toBe(true);
});
