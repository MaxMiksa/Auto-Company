const { defineConfig } = require('@playwright/test');
const path = require('node:path');
const runId = process.env.PLAYWRIGHT_JSON_OUTPUT_FILE
  ? path.basename(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE, '.json')
  : `local-${Date.now()}-${process.pid}`;

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  expect: { timeout: 5000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: path.join('.auto-company', 'browser-results', runId),
  reporter: [['list'], ['junit', { outputFile: `.auto-company/checks/${runId}.xml` }]],
  use: {
    baseURL: 'http://127.0.0.1:4188',
    viewport: { width: 1366, height: 900 },
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
      args: ['--no-sandbox']
    }
  },
  webServer: {
    command: 'npm start',
    url: 'http://127.0.0.1:4188',
    reuseExistingServer: false,
    timeout: 10000
  }
});
