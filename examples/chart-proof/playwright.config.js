const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests', testMatch: '**/browser.spec.js', timeout: 30000,
  fullyParallel: false, workers: 1,
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || 'test-results',
  reporter: [['list']],
  use: {
    baseURL: process.env.PRODUCT_URL || 'http://127.0.0.1:8766',
    headless: true, acceptDownloads: true,
    ...(process.env.CHART_PROOF_CHROMIUM ? { launchOptions: { executablePath: process.env.CHART_PROOF_CHROMIUM } } : {}),
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
  ...(!process.env.PRODUCT_URL ? { webServer: {
    command: 'node serve.cjs 8766', url: 'http://127.0.0.1:8766',
    reuseExistingServer: false, timeout: 10000,
  } } : {}),
});
