import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Deliberately use new synthetic inputs rather than the app's sample button.
const headers = 'mpn,parameter,value,unit,revision,source,locator,quote';
const csvCell = (text) => `"${String(text).replaceAll('"', '""')}"`;
const specification = (value = '10', quote = `Declared pressure limit ${value} bar`, mpn = 'QA-SYNTH-42', unit = 'bar') =>
  `${headers}\n${[mpn, 'pressure_limit', value, unit, 'A', 'qa-synthetic.csv', 'table 2 / row 7', quote].map(csvCell).join(',')}`;
const requirements = 'mpn,parameter,operator,value,unit\nQA-SYNTH-42,pressure_limit,min,8,bar';

async function enterInputs(page, old = specification(), next = specification('6'), needs = requirements) {
  await page.locator('#old-input').fill(old);
  await page.locator('#new-input').fill(next);
  await page.locator('#requirements-input').fill(needs);
  await page.getByRole('button', { name: '执行核验' }).click();
}
async function selectFinding(page) {
  await expect(page.locator('#finding-rows tr')).toHaveCount(1);
  await page.locator('#finding-rows tr button').first().click();
}
async function saveReview(page) {
  await page.locator('#decision').selectOption('accepted');
  await page.getByLabel('复核姓名').fill('QA 合成复核者');
  await page.getByLabel('复核说明').fill('合成演练：记录接受意见，仍需保留机器阻断。');
  await page.getByRole('button', { name: '保存本条复核' }).click();
}
async function downloadText(page, button) {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  return readFile(path, 'utf8');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '把变更，核到原文。' })).toBeVisible();
});

test('custom evidence → block → human review → CSV / print / JSON → restore', async ({ page, context }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.getByLabel('项目名称').fill('QA 合成变更核验');
  await enterInputs(page);
  await selectFinding(page);
  await expect(page.locator('#evidence-severity')).toContainText('阻断');
  await expect(page.locator('#new-source')).toHaveText('qa-synthetic.csv');
  await expect(page.locator('#new-locator')).toHaveText('table 2 / row 7');
  await expect(page.locator('#new-quote')).toHaveText('Declared pressure limit 6 bar');
  await expect(page.locator('#evidence-requirement')).toContainText('8');
  await saveReview(page);
  await expect(page.locator('#finding-rows')).toContainText('人工接受');
  await expect(page.locator('#evidence-severity')).toContainText('阻断');
  await page.getByRole('button', { name: '执行核验' }).click();
  await expect(page.locator('#finding-rows')).toContainText('人工接受');
  await expect(page.locator('#evidence-severity')).toContainText('阻断');
  const exported = await downloadText(page, '下载核验 CSV');
  for (const required of ['qa-synthetic.csv', 'table 2 / row 7', 'Declared pressure limit 6 bar', 'QA 合成复核者', '阻断']) expect(exported).toContain(required);

  // Observe the generated print document; no system printer is invoked.
  await context.addInitScript(() => { window.print = () => {}; });
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: '打印 / 保存 PDF 报告' }).click();
  const popup = await popupPromise;
  await expect(popup.locator('body')).toContainText('QA 合成变更核验');
  await expect(popup.locator('body')).toContainText('阻断');
  await expect(popup.locator('body')).toContainText('Declared pressure limit 6 bar');
  await expect(popup.locator('body')).toContainText('QA 合成复核者');

  const backupText = await downloadText(page, '下载项目备份');
  const backup = JSON.parse(backupText);
  expect(backup.version).toBe(1);
  expect(backup.title).toBe('QA 合成变更核验');
  expect(backup.inputs).toEqual({ old: specification(), new: specification('6'), requirements });
  expect(Object.values(backup.reviews)).toEqual([expect.objectContaining({ decision: 'accepted', reviewer: 'QA 合成复核者' })]);

  await page.locator('#new-input').fill(specification('9'));
  await page.getByRole('button', { name: '执行核验' }).click();
  await expect(page.locator('#finding-rows')).not.toContainText('人工接受');
  await page.getByLabel('项目名称').fill('被替换的合成工作');
  await page.locator('#restore-project').setInputFiles({ name: 'qa-backup.json', mimeType: 'application/json', buffer: Buffer.from(backupText) });
  await expect(page.getByLabel('项目名称')).toHaveValue('QA 合成变更核验');
  await expect(page.locator('#new-input')).toHaveValue(specification('6'));
  await expect(page.locator('#finding-rows')).toContainText('人工接受');
  await selectFinding(page);
  await expect(page.locator('#evidence-severity')).toContainText('阻断');
  await page.reload();
  await expect(page.getByLabel('项目名称')).toHaveValue('QA 合成变更核验');
  await expect(page.locator('#finding-rows')).toContainText('人工接受');
  await expect(page.locator('#new-input')).toHaveValue(specification('6'));
  expect(pageErrors).toEqual([]);
});

test('corrupt JSON restore does not overwrite inputs, project title or saved review', async ({ page }) => {
  await page.getByLabel('项目名称').fill('必须保留的工作');
  await enterInputs(page);
  await selectFinding(page);
  await saveReview(page);
  for (const contents of ['{bad json', JSON.stringify({ version: 999, title: '坏备份' })]) {
    await page.locator('#restore-project').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from(contents) });
    await expect(page.locator('#status')).toContainText(/失败|无效|错误|不支持|不能|无法/);
    await expect(page.getByLabel('项目名称')).toHaveValue('必须保留的工作');
    await expect(page.locator('#old-input')).toHaveValue(specification());
    await expect(page.locator('#new-input')).toHaveValue(specification('6'));
    await expect(page.locator('#finding-rows')).toContainText('人工接受');
  }
});

test('bad CSV has a recoverable error and cannot export an obsolete audit', async ({ page }) => {
  await enterInputs(page);
  await expect(page.getByRole('button', { name: '下载核验 CSV' })).toBeEnabled();
  await page.locator('#new-input').fill(`${headers}\nQA-SYNTH-42,pressure_limit,6,bar,A,source,row,"unterminated`);
  await page.getByRole('button', { name: '执行核验' }).click();
  await expect(page.locator('#status')).toContainText(/引号|格式|失败|错误/);
  await expect(page.getByRole('button', { name: '下载核验 CSV' })).toBeDisabled();
  await page.locator('#new-input').fill(specification('6'));
  await page.getByRole('button', { name: '执行核验' }).click();
  await expect(page.getByRole('button', { name: '下载核验 CSV' })).toBeEnabled();
});

test('a malformed CSV upload cannot replace the current valid input and review', async ({ page }) => {
  await enterInputs(page);
  await selectFinding(page);
  await saveReview(page);
  const malformed = `${headers}\nQA-SYNTH-42,pressure_limit,6,bar,A,source,row,"unterminated`;
  await page.locator('#new-file').setInputFiles({ name: 'malformed.csv', mimeType: 'text/csv', buffer: Buffer.from(malformed) });
  await expect(page.locator('#status')).toContainText(/失败|引号|错误|未完成/);
  await expect(page.locator('#new-input')).toHaveValue(specification('6'));
  await expect(page.locator('#finding-rows')).toContainText('人工接受');
  await expect(page.getByRole('button', { name: '下载核验 CSV' })).toBeEnabled();
});

test('uploaded CSV and untrusted evidence stay visible as text', async ({ page }) => {
  const payload = '<img src=x onerror="globalThis.qaInjected=true"><script>globalThis.qaInjected=true</script>';
  for (const [selector, contents] of [['#old-file', specification()], ['#new-file', specification('6', payload)], ['#requirements-file', requirements]]) {
    await page.locator(selector).setInputFiles({ name: 'qa-input.csv', mimeType: 'text/csv', buffer: Buffer.from(contents) });
  }
  await expect(page.locator('#new-input')).toHaveValue(specification('6', payload));
  await page.getByRole('button', { name: '执行核验' }).click();
  await selectFinding(page);
  await expect(page.locator('#new-quote')).toHaveText(payload);
  await expect(page.locator('#new-quote img, #new-quote script')).toHaveCount(0);
  expect(await page.evaluate(() => globalThis.qaInjected)).toBeUndefined();
});

test('no requirements, conflicting rows and changing identity never appear clear', async ({ page }) => {
  await enterInputs(page, specification(), specification(), 'mpn,parameter,operator,value,unit');
  await selectFinding(page);
  await expect(page.locator('#evidence-severity')).toContainText(/待复核|阻断/);
  const conflict = `${specification()}\n${specification('6').split('\n')[1]}`;
  await enterInputs(page, specification(), conflict);
  await selectFinding(page);
  await expect(page.locator('#evidence-severity')).toContainText(/待复核|阻断/);
  await enterInputs(page, specification(), specification('10', 'Different synthetic part', 'QA-SYNTH-OTHER'));
  await expect(page.locator('#finding-rows tr')).toHaveCount(2);
  await expect(page.locator('#finding-rows')).toContainText('QA-SYNTH-42');
  await expect(page.locator('#finding-rows')).toContainText('QA-SYNTH-OTHER');
  await expect(page.getByTestId('severity')).toHaveText([/待复核|阻断/, /待复核|阻断/]);
});

test('unit conversion leaves each original quantity correctly labelled in the result table', async ({ page }) => {
  await enterInputs(page, specification(), specification('1000', 'Declared pressure limit 1000 kPa', 'QA-SYNTH-42', 'kPa'));
  await selectFinding(page);
  const row = page.locator('#finding-rows tr');
  await expect(row.locator('td').nth(1)).toContainText('10 bar');
  await expect(row.locator('td').nth(2)).toContainText('1000 kPa');
  await expect(page.locator('#evidence-severity')).toHaveText('未发现差异');
});

test('a partially entered draft can be backed up and restored without inventing a result', async ({ page }) => {
  await page.getByLabel('项目名称').fill('QA 未完成草稿');
  await page.locator('#old-input').fill('unfinished CSV, still editing');
  const draft = await downloadText(page, '下载项目备份');
  expect(JSON.parse(draft).reviews).toEqual({});
  await enterInputs(page);
  await page.locator('#restore-project').setInputFiles({ name: 'draft.json', mimeType: 'application/json', buffer: Buffer.from(draft) });
  await expect(page.getByLabel('项目名称')).toHaveValue('QA 未完成草稿');
  await expect(page.locator('#old-input')).toHaveValue('unfinished CSV, still editing');
  await expect(page.locator('#new-input')).toHaveValue('');
  await expect(page.locator('#finding-rows tr')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '下载核验 CSV' })).toBeDisabled();
});

test('TXT original can be read and restored; a forged attachment hash cannot replace work', async ({ page }) => {
  const content = 'hello';
  await page.getByLabel('项目名称').fill('QA 附件工作');
  await enterInputs(page);
  await page.locator('.attachment-area summary').click();
  await page.locator('#attachment-files').setInputFiles({ name: 'qa-evidence.txt', mimeType: 'text/plain', buffer: Buffer.from(content) });
  await expect(page.locator('#attachment-list')).toContainText('qa-evidence.txt');
  await page.getByRole('button', { name: '查看正文', exact: true }).click();
  await expect(page.locator('#text-dialog')).toBeVisible();
  await expect(page.locator('#text-dialog-content')).toHaveText(content);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  const backupText = await downloadText(page, '下载项目备份');
  const backup = JSON.parse(backupText);
  expect(backup.attachments).toHaveLength(1);
  expect(backup.attachments[0]).toEqual(expect.objectContaining({ name: 'qa-evidence.txt', type: 'text/plain', size: 5,
    sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824', data: 'aGVsbG8=' }));
  await page.getByRole('button', { name: '移除原件 qa-evidence.txt' }).click();
  await expect(page.locator('#attachment-list li')).toHaveCount(0);
  await page.locator('#restore-project').setInputFiles({ name: 'good-attachment.json', mimeType: 'application/json', buffer: Buffer.from(backupText) });
  await expect(page.locator('#attachment-list')).toContainText('qa-evidence.txt');
  backup.title = '不应覆盖工作';
  backup.attachments[0].sha256 = '0'.repeat(64);
  await page.locator('#restore-project').setInputFiles({ name: 'forged-attachment.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.locator('#status')).toContainText(/失败|摘要|不一致|损坏/);
  await expect(page.getByLabel('项目名称')).toHaveValue('QA 附件工作');
  await expect(page.locator('#new-input')).toHaveValue(specification('6'));
  await expect(page.locator('#attachment-list')).toContainText('qa-evidence.txt');
});

test('the supplied demonstration actually completes an audit', async ({ page }) => {
  await page.getByRole('button', { name: '载入示例项目' }).click();
  await expect(page.locator('#finding-rows tr').first()).toBeVisible();
  await expect(page.locator('#finding-rows')).toContainText(/待复核|阻断/);
  await expect(page.getByRole('button', { name: '下载核验 CSV' })).toBeEnabled();
  await expect(page.locator('#status')).toContainText('示例');
  await expect(page.locator('#status')).not.toHaveClass(/error/);
});

test('narrow screen keeps the input and review task usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enterInputs(page);
  await selectFinding(page);
  await expect(page.locator('#evidence-severity')).toContainText('阻断');
  await expect(page.getByLabel('复核姓名')).toBeVisible();
  await saveReview(page);
  await expect(page.locator('#finding-rows')).toContainText('人工接受');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
