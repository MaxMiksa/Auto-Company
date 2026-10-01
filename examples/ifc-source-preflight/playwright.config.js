const { defineConfig } = require('@playwright/test');
const path = require('node:path');
const python = process.env.IFC_PYTHON || path.join('.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: 'browser.spec.js',
  outputDir: '.auto-company/checks/browser-output',
  timeout: 45000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:8766', headless: true, trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {} },
  projects: [
    { name: '桌面', use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 } } },
    { name: '窄屏', use: { browserName: 'chromium', viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: `"${python}" server.py --port 8766`,
    url: 'http://127.0.0.1:8766/api/health',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
