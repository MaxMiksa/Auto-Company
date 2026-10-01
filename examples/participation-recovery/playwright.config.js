import { defineConfig } from '@playwright/test';
import { basename } from 'node:path';

const run = process.env.PLAYWRIGHT_JSON_OUTPUT_FILE
  ? basename(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE).replace(/[^a-zA-Z0-9_.-]/g, '-')
  : Date.now();

export default defineConfig({
  testDir: './tests',
  testMatch: 'browser.spec.js',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 5000 },
  outputDir: `.auto-company/checks/browser-artifacts-${run}`,
  use: {
    baseURL: 'http://127.0.0.1:4189',
    browserName: 'chromium',
    timezoneId: 'UTC',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm start',
    url: 'http://127.0.0.1:4189',
    reuseExistingServer: false,
    timeout: 15000,
  },
});
