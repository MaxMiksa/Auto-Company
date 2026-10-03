import { test, expect } from "./fixtures.js";

async function refreshRecords(page) {
  await page.locator("#settingsButton").click();
  await page.locator("#refreshButton").click();
  await page.locator("#closeSettingsButton").click();
}

async function stopRun(page) {
  await page.locator("#stopButton").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Stop run", exact: true }).click();
}

test("opens the default work journal and refreshes through visible controls", async ({ page, dashboard }) => {
  await expect(page).toHaveTitle(/Work journal/);
  await expect(page.locator("#currentCycle")).toContainText("Browser smoke cycle completed");
  await expect(page.locator('a[href="/legacy"]:visible')).toHaveCount(0);
  expect((await page.request.get(`${dashboard.url}/legacy`)).status()).toBe(404);
  await expect(page.locator("#startButton")).toBeEnabled();
  await expect(page.locator("#stopButton")).toBeDisabled();
  await page.locator("#tab-logs").click();
  await expect(page.locator("#logText")).toContainText("Browser fixture runtime log");
  await expect(page.locator("#rawText")).toBeHidden();
  await page.locator("#runtimeDiagnostics .disclosure-trigger").click();
  await expect(page.locator("#rawText")).toContainText(/State=stopped|Loop: NOT RUNNING/);
  const status = page.waitForResponse((response) => response.url().endsWith("/api/journal"));
  await page.locator("#settingsButton").click();
  await page.locator("#refreshButton").click();
  await page.locator("#closeSettingsButton").click();
  expect((await status).status()).toBe(200);
  await expect(page.locator("#runtimeState")).toHaveText("Stopped");
});

test("saves shared language through HTTP and retains it after reload", async ({ page, dashboard }) => {
  await page.locator("#settingsButton").click();
  await page.locator("#languageSelect").selectOption("zh-CN");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.locator("#tab-work")).toHaveText("工作记录");
  const response = await page.request.get(`${dashboard.url}/api/language`);
  expect(await response.json()).toMatchObject({
    language: "zh-CN", nextLanguage: "zh-CN", source: "saved", locked: false, pending: false,
  });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page.locator("#settingsButton").click();
  await expect(page.locator("#languageSelect")).toHaveValue("zh-CN");
});

test.describe("an active product", () => {
  test.use({ scenario: "active-product" });

  test("keeps the current language while saving the next product preference", async ({ page, dashboard }) => {
    const before = await (await page.request.get(`${dashboard.url}/api/language`)).json();
    expect(before).toMatchObject({ language: "en", nextLanguage: "en", locked: true });
    await page.locator("#settingsButton").click();
    await page.locator("#languageSelect").selectOption("zh-CN");
    await expect(page.locator("#languageHint")).toContainText(/English.*Simplified Chinese/);
    await expect(page.locator("#languageStatus")).toContainText(/next product|new product/i);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.reload();
    await page.locator("#settingsButton").click();
    await expect(page.locator("#languageHint")).toContainText(/English.*Simplified Chinese/);
    await expect(page.locator("#languageSelect")).toHaveValue("zh-CN");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    const after = await (await page.request.get(`${dashboard.url}/api/language`)).json();
    expect(after).toMatchObject({
      language: "en", nextLanguage: "zh-CN", locked: true, pending: true, productId: before.productId,
    });
  });
});

test.describe("server errors", () => {
  test.use({ scenario: "save-failure" });

  test("shows language and action failures without claiming success", async ({ page }) => {
    await page.locator("#settingsButton").click();
    const save = page.waitForResponse((response) => response.url().endsWith("/api/language")
      && response.request().method() === "POST");
    await page.locator("#languageSelect").selectOption("zh-CN");
    expect((await save).status()).toBe(500);
    await expect(page.locator("#languageStatus")).toContainText("The language change was not confirmed.");
    await expect(page.locator("#languageSelect")).toHaveValue("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.locator("#closeSettingsButton").click();
    await page.locator("#startButton").click();
    await expect(page.locator("#actionStatus")).toContainText(/Could not confirm.*Start run/);
    await expect(page.locator("#actionStatus")).toContainText("Host actions are disabled in browser smoke tests.");
    await expect(page.locator("#startButton")).toBeEnabled();
    await expect(page.locator("#runtimeState")).toHaveText("Stopped");
  });
});

test("shows a failed journal request and recovers on refresh", async ({ page }) => {
  await page.route("**/api/journal", (route) => route.fulfill({
    status: 503, contentType: "application/json", body: JSON.stringify({ error: "Smoke test unavailable" }),
  }));
  await refreshRecords(page);
  await expect(page.locator("#connectionError")).toBeVisible();
  await expect(page.locator("#runtimeState")).toHaveText("Status unavailable");
  await expect(page.locator("#startButton")).toBeDisabled();
  await expect(page.locator("#stopButton")).toBeDisabled();
  await expect(page.locator("#currentCycle")).toContainText("Browser smoke cycle completed");
  await page.unroute("**/api/journal");
  await refreshRecords(page);
  await expect(page.locator("#connectionError")).toBeHidden();
  await expect(page.locator("#runtimeState")).toHaveText("Stopped");
  await expect(page.locator("#startButton")).toBeEnabled();
});

test("a stale journal refresh cannot undo a confirmed shared-language save", async ({ page }) => {
  let release;
  let received;
  const held = new Promise((resolve) => { release = resolve; });
  const captured = new Promise((resolve) => { received = resolve; });
  await page.route("**/api/journal", async (route) => {
    const response = await route.fetch();
    received();
    await held;
    await route.fulfill({ response });
  }, { times: 1 });
  await refreshRecords(page);
  await captured;
  await page.locator("#settingsButton").click();
  await page.locator("#languageSelect").selectOption("zh-CN");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  release();
  await expect(page.locator("#refreshButton")).toBeEnabled();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.locator("#languageSelect")).toHaveValue("zh-CN");
});

test("unavailable bootstrap stays usable and can recover from visible controls", async ({ page }) => {
  await page.route("**/api/journal", (route) => route.fulfill({
    status: 503, contentType: "application/json", body: JSON.stringify({ error: "Unavailable" }),
  }));
  await page.reload();
  await expect(page.locator("#connectionError")).toBeVisible();
  await expect(page.locator("#refreshButton")).toBeEnabled();
  await expect(page.locator("#startButton")).toBeDisabled();
  await expect(page.locator("#stopButton")).toBeDisabled();
  await page.locator("#settingsButton").click();
  await expect(page.locator("#settingsDialog")).toBeVisible();
  await page.locator("#closeSettingsButton").click();
  await page.unroute("**/api/journal");
  await refreshRecords(page);
  await expect(page.locator("#connectionError")).toBeHidden();
  await expect(page.locator("#currentCycle")).toContainText("Browser smoke cycle completed");
  await expect(page.locator("#runtimeState")).toHaveText("Stopped");
});

test.describe("host action boundary", () => {
  test.use({ scenario: "action-success" });

  test("stop is immediate during a slow refresh and disables duplicate controls", async ({ page }) => {
    await page.locator("#startButton").click();
    await expect(page.locator("#stopButton")).toBeEnabled();
    let releaseStatus, releaseStop;
    let statusSeen, stopSeen;
    const statusGate = new Promise((resolve) => { releaseStatus = resolve; });
    const stopGate = new Promise((resolve) => { releaseStop = resolve; });
    const statusReceived = new Promise((resolve) => { statusSeen = resolve; });
    const stopReceived = new Promise((resolve) => { stopSeen = resolve; });
    await page.route("**/api/journal", async (route) => {
      const response = await route.fetch();
      statusSeen();
      await statusGate;
      await route.fulfill({ response });
    }, { times: 1 });
    await page.route("**/api/action/stop", async (route) => {
      stopSeen();
      await stopGate;
      await route.continue();
    }, { times: 1 });
    await refreshRecords(page);
    await statusReceived;
    await stopRun(page);
    await stopReceived;
    await expect(page.locator("#runtimeState")).toHaveText("Stopping");
    await expect(page.locator("#startButton")).toBeDisabled();
    await expect(page.locator("#stopButton")).toBeDisabled();
    releaseStatus();
    releaseStop();
    await expect(page.locator("#runtimeState")).toHaveText("Stopped");
    await expect(page.locator("#startButton")).toBeEnabled();
  });

  test("start and stop use the real HTTP protocol and refresh verified state", async ({ page, dashboard }) => {
    const start = page.waitForResponse((response) => response.url().endsWith("/api/action/start"));
    await page.locator("#startButton").click();
    expect((await start).request().method()).toBe("POST");
    expect((await start).request().postData()).toBe("{}");
    await expect(page.locator("#runtimeState")).toHaveText("Running");
    await expect(page.locator("#startButton")).toBeDisabled();
    await expect(page.locator("#stopButton")).toBeEnabled();
    const running = await (await page.request.get(`${dashboard.url}/api/journal`)).json();
    expect(running).toMatchObject({ readOnly: false, runtime: { available: true, processState: "running" } });
    const stop = page.waitForResponse((response) => response.url().endsWith("/api/action/stop"));
    await stopRun(page);
    expect((await stop).request().method()).toBe("POST");
    await expect(page.locator("#runtimeState")).toHaveText("Stopped");
    await expect(page.locator("#stopButton")).toBeDisabled();
    await expect(page.locator("#startButton")).toBeEnabled();
  });
});

test.describe("a verified running cycle", () => {
  test.use({ scenario: "running-cycle" });

  test("failed stop remains visible after reload and permits retry only", async ({ page }) => {
    await stopRun(page);
    await expect(page.locator("#runtimeState")).toHaveText("Stop incomplete — retry Stop");
    await expect(page.locator("#startButton")).toBeDisabled();
    await expect(page.locator("#stopButton")).toBeEnabled();
    await page.reload();
    await expect(page.locator("#runtimeState")).toHaveText("Stop incomplete — retry Stop");
    await expect(page.locator("#stopButton")).toBeEnabled();
  });

  test("shows current execution separately from the last completed report", async ({ page, dashboard }) => {
    await expect(page.locator("#cycleNumber")).toHaveText("02");
    await expect(page.locator("#currentCycle")).toContainText(/running|progress/i);
    await expect(page.locator("#currentCycle")).not.toContainText("Browser smoke cycle completed");
    await expect(page.locator("#historyList")).toContainText("Browser smoke cycle completed");
    const payload = await (await page.request.get(`${dashboard.url}/api/journal`)).json();
    expect(payload.cycles[0]).toMatchObject({ id: "cycle-0002-browser", status: "running", active: true, endedAt: null });
    await page.locator("#tab-logs").click();
    await page.locator("#logSelect").selectOption("cycle-0002-browser");
    await expect(page.locator("#logText")).toContainText("Current cycle fixture log");
    await expect(page.locator("#startButton")).toBeDisabled();
    await expect(page.locator("#stopButton")).toBeEnabled();
  });
});
