import { expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LOCK_WORDS = ["林晚", "还开着就好", "缺口"];

test.describe("编译轨 round-trip", () => {
  test("fixture 导入还原草稿与提示词", async ({ page }) => {
    const fixturePath = path.resolve(
      __dirname,
      "../../scripts/fixtures/accept-compile-export.json",
    );
    const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as {
      draft: { intent: string };
      compiled: { prompt: string; locksDigest: string };
    };

    await page.goto("/studio");
    await expect(page.getByTestId("studio-intent")).toBeVisible();

    await page.getByTestId("studio-import-file").setInputFiles(fixturePath);

    await expect(page.getByTestId("studio-import-note")).toContainText("已导入导演包");
    await expect(page.getByTestId("studio-import-note")).toContainText("编译轨交付，非成片");

    await expect(page.getByTestId("studio-intent")).toHaveValue(fixture.draft.intent);

    const prompt = page.getByTestId("studio-prompt");
    await expect(prompt).not.toContainText("还没有编译");
    for (const word of LOCK_WORDS) {
      await expect(prompt).toContainText(word);
    }
    await expect(prompt).toContainText(fixture.compiled.prompt.slice(0, 40));
  });

  test("编译 → 下载 → 重载 → 导入 round-trip", async ({ page }) => {
    await page.goto("/studio");
    const intent = page.getByTestId("studio-intent");
    await expect(intent).toBeVisible();
    await expect(intent).not.toHaveValue("", { timeout: 15_000 });

    const originalIntent = await intent.inputValue();
    expect(originalIntent.length).toBeGreaterThan(10);

    await page.getByTestId("studio-compile").click();

    const prompt = page.getByTestId("studio-prompt");
    await expect(prompt).not.toContainText("还没有编译");
    for (const word of LOCK_WORDS) {
      await expect(prompt).toContainText(word);
    }

    const promptBefore = await prompt.textContent();
    expect(promptBefore).toBeTruthy();

    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("studio-download-bundle").click();
    const download = await downloadPromise;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cineforge-e2e-"));
    const bundlePath = path.join(tmpDir, download.suggestedFilename());
    await download.saveAs(bundlePath);

    const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf-8")) as {
      schema: string;
      meta: { compileOnly: boolean };
      draft: { intent: string };
      compiled: { prompt: string };
    };
    expect(bundle.schema).toBe("jingchang.compile.v1");
    expect(bundle.meta.compileOnly).toBe(true);
    expect(bundle.draft.intent).toBe(originalIntent);
    expect(bundle.compiled.prompt).toBe(promptBefore);

    await page.reload();
    await expect(intent).toBeVisible();
    await expect(intent).not.toHaveValue("", { timeout: 15_000 });

    await page.getByTestId("studio-import-file").setInputFiles(bundlePath);

    await expect(page.getByTestId("studio-import-note")).toContainText("已导入导演包");
    await expect(intent).toHaveValue(originalIntent);
    await expect(page.getByTestId("studio-prompt")).toHaveText(promptBefore!);
  });
});
