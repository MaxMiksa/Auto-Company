import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const evidenceRoot = fileURLToPath(new URL('./test-results/', import.meta.url));

export default defineConfig({
  testDir: './tests',
  testMatch: 'browser.spec.js',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  retries: 0,
  timeout: 30000,
  reporter: [['list']],
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || evidenceRoot,
  ...(!process.env.PRODUCT_URL ? { webServer: {
    command: 'node serve.cjs 4173', url: 'http://127.0.0.1:4173', reuseExistingServer: false,
  } } : {}),
  use: {
    baseURL: process.env.PRODUCT_URL || 'http://127.0.0.1:4173',
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { launchOptions: { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } } : {}),
  },
});
