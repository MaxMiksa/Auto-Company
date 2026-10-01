import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 30000,
  expect: { timeout: 6000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: '.auto-company/browser-results',
  webServer: { command: 'npm start', url: 'http://127.0.0.1:4187', reuseExistingServer: false },
  use: {
    baseURL: process.env.FAMILY_MEMORY_BASE_URL || 'http://127.0.0.1:4187',
    browserName: 'chromium',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.FAMILY_MEMORY_BROWSER ? { executablePath: process.env.FAMILY_MEMORY_BROWSER } : {}
  }
});
