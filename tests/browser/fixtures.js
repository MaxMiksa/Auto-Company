import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { test as base, expect } from "@playwright/test";

export { expect };

export const test = base.extend({
  scenario: ["default", { option: true }],

  dashboard: async ({ scenario }, use, testInfo) => {
    const python = process.env.AUTO_COMPANY_BROWSER_PYTHON
      || (process.platform === "win32" ? "python" : "python3");
    const child = spawn(python, ["-u", fileURLToPath(new URL("fixture-server.py", import.meta.url)),
      "--scenario", scenario], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let log = "";
    child.stderr.on("data", (chunk) => { log += chunk.toString(); });
    const closed = new Promise((resolve) => child.once("close", resolve));
    const lines = createInterface({ input: child.stdout });
    try {
      const dashboard = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Dashboard did not start:\n${log}`)), 10000);
        const finish = (error, value) => {
          clearTimeout(timer);
          if (error) reject(error);
          else resolve(value);
        };
        child.once("error", (error) => finish(error));
        child.once("exit", (code) => finish(new Error(`Dashboard exited (${code}):\n${log}`)));
        lines.once("line", (line) => {
          try { finish(null, JSON.parse(line)); }
          catch (error) { finish(error); }
        });
      });
      await use(dashboard);
    } finally {
      child.stdin.end();
      let timer;
      await Promise.race([closed, new Promise((resolve) => {
        timer = setTimeout(() => { child.kill(); resolve(); }, 5000);
      })]);
      clearTimeout(timer);
      lines.close();
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach("dashboard-server.log", { body: log, contentType: "text/plain" });
      }
    }
  },

  page: async ({ page, dashboard, scenario }, use) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // Fonts are cosmetic; smoke tests require no external network requests.
    await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
    await page.route("https://fonts.gstatic.com/**", (route) => route.abort());
    await page.goto(dashboard.url);
    await expect(page.locator("#projectName")).toHaveText("Browser Fixture");
    await expect(page.locator("#runtimeState")).toHaveText(scenario === "running-cycle" ? "Running" : "Stopped");
    await page.locator("#settingsButton").click();
    await page.locator('#settingsDialog [role=switch]').setChecked(false);
    await page.locator("#closeSettingsButton").click();
    await use(page);
    expect(errors, "Unexpected dashboard JavaScript errors").toEqual([]);
  },
});
