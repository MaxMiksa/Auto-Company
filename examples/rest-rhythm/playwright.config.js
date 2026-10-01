import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'browser.test.js',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  reporter: [['list']],
  outputDir: '.auto-company/browser-results',
  use: {
    baseURL: 'http://127.0.0.1:43127',
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `${process.platform === 'win32' ? 'python' : 'python3'} -m http.server 43127 --bind 127.0.0.1 --directory .`,
    url: 'http://127.0.0.1:43127',
    reuseExistingServer: false,
    timeout: 15000,
  },
});
