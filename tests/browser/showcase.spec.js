import { test as base, expect } from "@playwright/test";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exampleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../examples");
const catalogSlugs = [
  "chart-proof", "coi-chase-desk", "crm-migration-proof", "crossed-island-experiment",
  "cuecheck", "disclosure-qa-spike", "dual-flavor-table", "family-art-show",
  "family-memory", "field-return-audit", "ifc-source-preflight", "participation-recovery",
  "payment-recovery-audit", "rest-rhythm", "reversible-room", "scope-sheet",
  "scopefence", "spec-evidence", "tabledelta", "tactile-preflight", "text-meter", "tujiandan",
];
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const test = base.extend({
  examples: async ({}, use) => {
    const server = http.createServer(async (request, response) => {
      try {
        const url = new URL(request.url, "http://127.0.0.1");
        const pathname = decodeURIComponent(url.pathname);
        const file = path.resolve(exampleRoot, `.${pathname}${pathname.endsWith("/") ? "index.html" : ""}`);
        if (!file.startsWith(`${exampleRoot}${path.sep}`)) { response.writeHead(403).end(); return; }
        const data = await fs.readFile(file);
        response.writeHead(200, { "Content-Type": `${types[path.extname(file)] || "application/octet-stream"}; charset=utf-8` }).end(data);
      } catch { response.writeHead(404).end(); }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try { await use(`http://127.0.0.1:${server.address().port}`); }
    finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  },
  page: async ({ page }, use) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await use(page);
    expect(errors, "Example JavaScript errors").toEqual([]);
  },
});

test("Public catalog has 22 runnable entries and preserves the CLI entrypoint", async () => {
  const entries = await fs.readdir(exampleRoot, { withFileTypes: true });
  expect(entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort()).toEqual(catalogSlugs);
  const catalog = await fs.readFile(path.join(exampleRoot, "README.md"), "utf8");
  for (const slug of catalogSlugs) {
    expect(catalog, `${slug} catalog link`).toContain(`](${slug}/)`);
    await fs.access(path.join(exampleRoot, slug, "README.md"));
    if (slug === "payment-recovery-audit") continue;
    await fs.access(path.join(exampleRoot, slug, slug === "disclosure-qa-spike" ? "web/index.html" : "index.html"));
  }
  for (const slug of ["disclosure-qa-spike", "ifc-source-preflight", "field-return-audit"]) {
    await fs.access(path.join(exampleRoot, slug, "server.py"));
  }
  const { stdout } = await promisify(execFile)(process.execPath, ["bin/audit.js", "fixtures/demo.json", "--pretty"], {
    cwd: path.join(exampleRoot, "payment-recovery-audit"),
  });
  expect(JSON.parse(stdout).totals.residual_opportunity).toBe(20000);
});

for (const slug of catalogSlugs.filter(slug => !["payment-recovery-audit", "disclosure-qa-spike", "ifc-source-preflight", "field-return-audit"].includes(slug))) {
  test(`Public ${slug} entry loads from examples with an actual visible heading`, async ({ page, examples }) => {
    const response = await page.goto(`${examples}/${slug}/`);
    expect(response.status()).toBe(200);
    await expect(page.getByRole("heading").first()).toBeVisible();
    await expect(page).not.toHaveTitle("");
  });
}

test("Migrated TableDelta reads both sample CSVs and exports their actual differences", async ({ page, examples }) => {
  await page.goto(`${examples}/tabledelta/`);
  await page.locator("#load-example").click();
  await expect(page.locator("#key-column")).toBeEnabled();
  await page.locator("#key-column").selectOption("编号");
  await page.locator("#compare").click();
  for (const type of ["added", "deleted", "modified", "unchanged"]) await expect(page.locator(`#count-${type}`)).toHaveText("1");
  const pending = page.waitForEvent("download");
  await page.locator("#download").click();
  const file = await pending;
  const text = await fs.readFile(await file.path(), "utf8");
  expect(text).toContain("钢笔");
  expect(text).toContain("10");
  expect(() => JSON.parse(text)).not.toThrow();
});

test("Migrated CueCheck loads its clean SRT and downloads the actual subtitle file", async ({ page, examples }) => {
  await page.goto(`${examples}/cuecheck/`);
  await page.locator("#load-clean").click();
  await expect(page.locator("#stat-cues")).not.toHaveText("0");
  await expect(page.locator("#stat-errors")).toHaveText("0");
  const pending = page.waitForEvent("download");
  await page.locator("#download-srt").click();
  const file = await pending;
  expect(file.suggestedFilename()).toMatch(/\.srt$/);
  const text = await fs.readFile(await file.path(), "utf8");
  expect(text).toContain("-->");
  expect(text).toContain("\n");
});

test("Text Meter counts actual Unicode input and resets through its controls", async ({ page, examples }) => {
  await page.goto(`${examples}/text-meter/`);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.locator("#text-input").fill("One 😀\nTwo");
  await expect(page.locator("#character-count")).toHaveText("9");
  await expect(page.locator("#non-whitespace-count")).toHaveText("7");
  await expect(page.locator("#word-count")).toHaveText("3");
  await expect(page.locator("#line-count")).toHaveText("2");
  await page.locator("#clear-button").click();
  await expect(page.locator("#text-input")).toBeEmpty();
  await expect(page.locator("#word-count")).toHaveText("0");
  await page.locator("#sample-button").click();
  await expect(page.locator("#text-input")).not.toBeEmpty();
  await expect(page.locator("#word-count")).not.toHaveText("0");
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

for (const decision of ["approved", "declined"]) {
  test(`ScopeFence returns the ${decision} link and handles same-tab navigation`, async ({ page, examples }) => {
    await page.goto(`${examples}/scopefence/`);
    await page.getByLabel("Project name").fill("Website revision");
    await page.getByLabel("What changed?").fill("Add the agreed pricing comparison section.");
    await page.getByLabel("Price impact (USD)").fill("0");
    await page.getByLabel("Timeline impact (days)").fill("0");
    await page.getByRole("button", { name: "Create decision link" }).click();
    const draft = await page.locator('[data-copy-label="Copy link"]').getAttribute("data-copy");
    await page.goto(draft);
    await expect(page.locator("#decision-heading")).toBeVisible();
    await page.locator(`[data-decision="${decision}"]`).click();
    await page.locator("#confirm-decision").click();
    const returned = await page.locator("#final-link").inputValue();
    await page.goto(`${examples}/scopefence/`);
    await page.goto(returned);
    await expect(page.locator("h1")).toHaveText(`This link says: ${decision}.`);
    await expect(page.locator("body")).toContainText("Anyone with the link can alter its encoded data");
    await page.getByRole("link", { name: "ScopeFence home" }).click();
    await expect(page.locator("#receipt-form")).toBeVisible();
    await page.goto(`${examples}/scopefence/#r=not-valid-json`);
    await expect(page.locator("#receipt-form")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  });
}

test("Chinese scope sheet blocks incomplete export and downloads actual form values", async ({ page, examples, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`${examples}/scope-sheet/`);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.locator("#doc-price")).toHaveText("¥ —");
  await page.locator("#download-button").click();
  await expect(page.locator("#action-message")).toContainText("请先");
  await page.locator("#example-button").click();
  await expect(page.locator("#doc-price")).toHaveText("¥ 2,800");
  await page.locator('[name="project"]').fill("中文验收项目");
  await page.locator('[name="project"]').press("Enter");
  await expect(page.locator('[name="project"]')).toHaveValue("中文验收项目");
  await expect(page.locator("#doc-project")).toContainText("中文验收项目");
  await page.locator("#copy-button").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("中文验收项目");
  const download = page.waitForEvent("download");
  await page.locator("#download-button").click();
  const file = await download;
  expect(file.suggestedFilename()).toContain("中文验收项目");
  const text = await fs.readFile(await file.path(), "utf8");
  expect(text).toContain("中文验收项目");
  expect(text).toContain("¥ 2,800");
  await page.locator('[name="price"]').fill("-1");
  await expect(page.locator("#doc-price")).toHaveText("¥ —");
  await page.locator("#copy-button").click();
  await expect(page.locator("#action-message")).toContainText("报价");
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});
