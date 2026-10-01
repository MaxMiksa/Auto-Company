const { defineConfig } = require('@playwright/test');
const { existsSync } = require('node:fs');
const path = require('node:path');

const localLibraries = path.join(__dirname, '.auto-company/browser-libs/usr/lib/x86_64-linux-gnu');
const runName = process.env.PLAYWRIGHT_JSON_OUTPUT_FILE
  ? path.parse(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE).name
  : process.env.ISLAND_CHECK_REPORT || 'browser-report';
const launchOptions = existsSync(localLibraries)
  ? { env: { ...process.env, LD_LIBRARY_PATH: [localLibraries, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } }
  : {};

module.exports = defineConfig({
  testDir: './tests',
  testMatch: 'browser.spec.js',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 30000,
  reporter: [['list'], ['json', { outputFile: `.auto-company/checks/${process.env.ISLAND_CHECK_REPORT || 'browser-report'}.json` }]],
  outputDir: `.auto-company/checks/artifacts/${runName}`,
  use: {
    browserName: 'chromium',
    headless: true,
    reducedMotion: 'reduce',
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions,
  },
});
