import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const secret = '撤回标记甲';
const privateText = '仅本机私密标记乙';

async function open(page) {
  page.on('dialog', dialog => dialog.accept());
  await page.exposeBinding('reviewConfirmation', async () => {
    const modal = page.locator('#confirmation-dialog');
    if (page.confirmName) { await modal.locator('#confirmation-name').fill(page.confirmName); page.confirmName = null; }
    const action = page.confirmNext || 'accept'; page.confirmNext = null;
    await modal.locator(`[data-confirm="${action}"]`).click();
  });
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      new MutationObserver(changes => {
        if (changes.some(change => change.target.id === 'confirmation-dialog' && change.target.open)) {
          window.reviewConfirmation().catch(() => {});
        }
      }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['open'] });
    });
  });
  await page.goto('/');
  await expect(page.locator('#session-title')).toBeVisible();
}

async function participant(page, name) {
  await page.locator('#participant-name').fill(name);
  await page.locator('#participant-consent').check();
  await page.locator('#participant-form button[type="submit"]').click();
  await expect(page.locator('#participants-list')).toContainText(name);
}

async function prepare(page) {
  await page.locator('#session-title').fill('院门前的合影');
  await page.locator('#session-date').fill('2026-10-01');
  await page.locator('#session-place').fill('家里');
  await page.locator('#session-prompt').fill('各自说说那次合影，也可以跳过。');
  await page.locator('#session-form button[type="submit"]').click();
  await participant(page, '阿禾');
  await participant(page, '阿森');
}

async function addMemory(page, name, text, visibility = 'public') {
  await page.locator('#memory-participant').selectOption({ label: name });
  await page.locator('#memory-text').fill(text);
  await page.locator(`#memory-form input[value="${visibility}"]`).check();
  await page.locator('#memory-submit').click();
  await expect(page.locator('#memories-list')).toContainText(text);
}

async function downloadText(page, selector) {
  await expect(page.locator('#confirmation-dialog')).toBeHidden();
  const pending = page.waitForEvent('download');
  await page.locator(selector).click();
  const download = await pending;
  const content = await readFile(await download.path(), 'utf8');
  return { content, name: download.suggestedFilename() };
}

async function addQuestion(page, text, { from = '阿禾', to = '阿森', sourceIds = [] } = {}) {
  await page.locator('#question-from').selectOption({ label: from });
  await page.locator('#question-to').selectOption({ label: to });
  const sources = page.locator('#question-sources input[type="checkbox"]');
  for (let i = 0; i < await sources.count(); i++) {
    const source = sources.nth(i);
    await source.setChecked(sourceIds.includes(await source.getAttribute('value')));
  }
  await page.locator('#question-text').fill(text);
  await page.locator('#question-form button[type="submit"]').click();
  const entry = page.locator('#questions-list .entry').last();
  await expect(entry.locator('.entry-text')).toHaveText(text);
  const id = await entry.getAttribute('data-question-id');
  expect(id).toBeTruthy();
  return { id, entry: page.locator(`#questions-list [data-question-id="${id}"]`) };
}

async function restoreBackup(page, content) {
  await page.locator('#import-file').setInputFiles({ name: 'draft-boundary.json', mimeType: 'application/json', buffer: Buffer.from(content) });
  await expect(page.locator('#message')).toContainText('已从备份恢复活动');
  await page.locator('[data-step="questions"]').click();
}

async function expectDraftsAbsent(page, markers) {
  const inputValues = await page.locator('textarea').evaluateAll(inputs => inputs.map(input => input.value).join('\n'));
  const localContent = await page.evaluate(() => Object.values(localStorage).join('\n'));
  const json = (await downloadText(page, '#export-json')).content;
  await page.locator('[data-step="stories"]').click();
  const markdown = (await downloadText(page, '#export-markdown')).content;
  await page.evaluate(() => { window.print = () => {}; });
  await page.locator('#print-stories').click();
  for (const marker of markers) {
    expect(inputValues).not.toContain(marker);
    expect(localContent).not.toContain(marker);
    expect(json).not.toContain(marker);
    expect(markdown).not.toContain(marker);
    await expect(page.locator('body')).not.toContainText(marker);
    await expect(page.locator('#print-content')).not.toContainText(marker);
  }
  await page.locator('[data-step="questions"]').click();
}

test('并行填写按问题编号保留，保存一条、切步骤及其他条目重绘不清空其余回答', async ({ page }) => {
  await open(page);
  await page.locator('#demo-button').click();
  await page.locator('[data-step="questions"]').click();
  const people = { from: '阿宁（虚构）', to: '外婆（虚构）' };
  const first = await addQuestion(page, '父验收合成问题一：那次是什么季节？', people);
  const second = await addQuestion(page, '父验收合成问题二：你记得什么颜色？', people);
  const firstText = '父验收合成回答一：夏季。';
  const secondText = '父验收合成回答二：蓝色。\n第二行仍待补充。';
  const thirdText = '同题但独立编号的第三条草稿';
  await first.entry.locator('textarea').fill(firstText);
  await second.entry.locator('textarea').fill(secondText);
  await expect(first.entry.locator('textarea')).toHaveValue(firstText);
  await expect(second.entry.locator('textarea')).toHaveValue(secondText);
  const third = await addQuestion(page, '父验收合成问题二：你记得什么颜色？', people);
  await third.entry.locator('textarea').fill(thirdText);
  await expect(first.entry.locator('textarea')).toHaveValue(firstText);
  await expect(second.entry.locator('textarea')).toHaveValue(secondText);
  await first.entry.getByRole('button', { name: '保存回应' }).click();
  await expect(first.entry).toContainText(firstText);
  await expect(first.entry.locator('textarea')).toHaveCount(0);
  await expect(second.entry.locator('textarea')).toHaveValue(secondText);
  await expect(third.entry.locator('textarea')).toHaveValue(thirdText);
  await page.screenshot({ path: '.auto-company/screenshots/multiple-answer-drafts.png', fullPage: true });
  await page.locator('#question-from').selectOption({ label: people.from });
  await page.locator('#question-to').selectOption({ label: people.to });
  await page.locator('#question-text').fill('仍在拟写的独立问题草稿');
  const selectedQuestionSource = page.locator('#question-sources input[type="checkbox"]').first();
  const questionSourceId = await selectedQuestionSource.getAttribute('value');
  await selectedQuestionSource.check();
  await page.locator('[data-step="stories"]').click();
  await page.locator('#story-title').fill('仍在整理的故事标题草稿');
  await page.locator('#story-note').fill('未保存的故事注记草稿');
  await page.locator('#story-disagreement').fill('未保存的不同记得草稿');
  const selectedStorySource = page.locator('#story-sources input[type="checkbox"]').first();
  const storySourceId = await selectedStorySource.getAttribute('value');
  await selectedStorySource.check();
  await page.locator('[data-step="prepare"]').click();
  await page.locator('#session-title').fill('尚未保存的活动标题草稿');
  await participant(page, '新增虚构参与者');
  await expect(page.locator('#session-title')).toHaveValue('尚未保存的活动标题草稿');
  await page.locator('[data-step="memories"]').click();
  await addMemory(page, '新增虚构参与者', '独立原话操作引起普通重绘');
  const memory = page.locator('#memories-list .entry').filter({ hasText: '独立原话操作引起普通重绘' });
  await memory.getByRole('button', { name: '编辑原话' }).click();
  await page.locator('#memory-text').fill('这次编辑决定取消');
  await page.locator('#memory-cancel').click();
  await memory.getByRole('button', { name: '编辑原话' }).click();
  await page.locator('#memory-text').fill('已修正的独立原话');
  await page.locator('#memory-submit').click();
  await page.locator('#memory-text').fill('还未保存的另一段独立原话草稿');
  await page.locator('[data-step="questions"]').click();
  await expect(second.entry.locator('textarea')).toHaveValue(secondText);
  await expect(third.entry.locator('textarea')).toHaveValue(thirdText);
  await second.entry.getByRole('button', { name: '保存回应' }).click();
  await expect(second.entry).toContainText('第二行仍待补充');
  await expect(third.entry.locator('textarea')).toHaveValue(thirdText);
  await expect(page.locator('#question-text')).toHaveValue('仍在拟写的独立问题草稿');
  await expect(page.locator('#question-sources input[type="checkbox"][value="' + questionSourceId + '"]')).toBeChecked();
  await expect(page.locator('#story-title')).toHaveValue('仍在整理的故事标题草稿');
  await expect(page.locator('#story-note')).toHaveValue('未保存的故事注记草稿');
  await expect(page.locator('#story-disagreement')).toHaveValue('未保存的不同记得草稿');
  await expect(page.locator('#story-sources input[type="checkbox"][value="' + storySourceId + '"]')).toBeChecked();
  await expect(page.locator('#memory-text')).toHaveValue('还未保存的另一段独立原话草稿');
  await expect(page.locator('#session-title')).toHaveValue('尚未保存的活动标题草稿');
  const saved = (await downloadText(page, '#export-json')).content;
  const questions = JSON.parse(saved).questions;
  expect(questions.find(question => question.id === first.id).answer).toBe(firstText);
  expect(questions.find(question => question.id === second.id).answer).toBe(secondText);
  expect(saved).not.toContain(thirdText);
  expect(await page.evaluate(() => Object.values(localStorage).join('\n'))).not.toContain(thirdText);
});

test('显式跳过只清该问题的草稿，其他同题问题仍保留且旧编号恢复不复活草稿', async ({ page }) => {
  await open(page);
  await prepare(page);
  await page.locator('[data-step="questions"]').click();
  const skipped = await addQuestion(page, '重复文字但独立的问题');
  const retained = await addQuestion(page, '重复文字但独立的问题');
  const backup = (await downloadText(page, '#export-json')).content;
  const skippedText = '跳过后必须清除的草稿甲';
  const retainedText = '跳过其他问题时应保留的草稿乙';
  await skipped.entry.locator('textarea').fill(skippedText);
  await retained.entry.locator('textarea').fill(retainedText);
  await skipped.entry.getByRole('button', { name: '这次跳过' }).click();
  await expect(skipped.entry).toContainText('自愿跳过');
  await expect(skipped.entry.locator('textarea')).toHaveCount(0);
  await expect(retained.entry.locator('textarea')).toHaveValue(retainedText);
  await expectDraftsAbsent(page, [skippedText]);
  await expect(retained.entry.locator('textarea')).toHaveValue(retainedText);
  await restoreBackup(page, backup);
  await expect(skipped.entry.locator('textarea')).toHaveValue('');
  await expect(retained.entry.locator('textarea')).toHaveValue('');
  await expectDraftsAbsent(page, [skippedText, retainedText]);
});

test('撤回单个问题清其回答草稿，取消撤回与无关问题草稿均不受损', async ({ page }) => {
  await open(page);
  await prepare(page);
  await page.locator('[data-step="questions"]').click();
  const withdrawn = await addQuestion(page, '准备撤回的问题');
  const retained = await addQuestion(page, '仍待回答的问题');
  const backup = (await downloadText(page, '#export-json')).content;
  const withdrawnText = '问题撤回不得泄露的草稿丙';
  const retainedText = '问题撤回应保留的无关草稿丁';
  await withdrawn.entry.locator('textarea').fill(withdrawnText);
  await retained.entry.locator('textarea').fill(retainedText);
  page.removeAllListeners('dialog');
  page.confirmNext = 'cancel';
  await withdrawn.entry.getByRole('button', { name: '撤回问题' }).click();
  await expect(withdrawn.entry.locator('textarea')).toHaveValue(withdrawnText);
  await expect(retained.entry.locator('textarea')).toHaveValue(retainedText);
  page.on('dialog', dialog => dialog.accept());
  await withdrawn.entry.getByRole('button', { name: '撤回问题' }).click();
  await expect(withdrawn.entry).toHaveCount(0);
  await expect(retained.entry.locator('textarea')).toHaveValue(retainedText);
  await expectDraftsAbsent(page, [withdrawnText]);
  await expect(retained.entry.locator('textarea')).toHaveValue(retainedText);
  await restoreBackup(page, backup);
  await expect(withdrawn.entry.locator('textarea')).toHaveValue('');
  await expect(retained.entry.locator('textarea')).toHaveValue('');
  await expectDraftsAbsent(page, [withdrawnText, retainedText]);
});

test('撤回原话递归清理派生问题草稿，独立问题保留且恢复旧备份不复活草稿', async ({ page }) => {
  await open(page);
  await prepare(page);
  await page.locator('[data-step="memories"]').click();
  await addMemory(page, '阿禾', '将撤回的合成来源原话');
  const source = page.locator('#memories-list .entry').filter({ hasText: '将撤回的合成来源原话' });
  const sourceId = await source.getAttribute('data-memory-id');
  await page.locator('[data-step="questions"]').click();
  const seed = await addQuestion(page, '来源上的第一层问题', { sourceIds: [sourceId] });
  await seed.entry.locator('textarea').fill('作为第二层问题来源的合成回答');
  await seed.entry.getByRole('button', { name: '保存回应' }).click();
  const seeded = JSON.parse((await downloadText(page, '#export-json')).content);
  const answerId = seeded.questions.find(question => question.id === seed.id).answerMemoryId;
  const affected = await addQuestion(page, '回答上的第二层问题', { sourceIds: [answerId] });
  const retained = await addQuestion(page, '不引用来源的独立问题');
  const backup = (await downloadText(page, '#export-json')).content;
  const affectedText = '原话递归撤回必须清理的草稿戊';
  const retainedText = '原话撤回应保留的独立草稿己';
  await affected.entry.locator('textarea').fill(affectedText);
  await retained.entry.locator('textarea').fill(retainedText);
  await page.locator('[data-step="memories"]').click();
  await source.getByRole('button', { name: '撤回原话' }).click();
  await page.locator('[data-step="questions"]').click();
  await expect(seed.entry).toHaveCount(0);
  await expect(affected.entry).toHaveCount(0);
  await expect(retained.entry.locator('textarea')).toHaveValue(retainedText);
  await expectDraftsAbsent(page, [affectedText]);
  await restoreBackup(page, backup);
  await expect(affected.entry.locator('textarea')).toHaveValue('');
  await expect(retained.entry.locator('textarea')).toHaveValue('');
  await expectDraftsAbsent(page, [affectedText, retainedText]);
});

test('撤销参与清直接及原话关联回答草稿，其余参与者的独立草稿保留', async ({ page }) => {
  await open(page);
  await prepare(page);
  await participant(page, '阿宁');
  await page.locator('[data-step="memories"]').click();
  await addMemory(page, '阿禾', '撤销参与者的合成来源');
  const sourceId = await page.locator('#memories-list .entry').getAttribute('data-memory-id');
  await page.locator('[data-step="questions"]').click();
  const direct = await addQuestion(page, '直接问将撤销的参与者', { from: '阿森', to: '阿禾' });
  const indirect = await addQuestion(page, '其他人互问但引用撤销者原话', { from: '阿森', to: '阿宁', sourceIds: [sourceId] });
  const retained = await addQuestion(page, '其他人的无关独立问题', { from: '阿森', to: '阿宁' });
  const backup = (await downloadText(page, '#export-json')).content;
  const directText = '参与撤销直接问题草稿庚';
  const indirectText = '参与撤销来源关联草稿辛';
  const retainedText = '参与撤销应保留的其他人草稿壬';
  await direct.entry.locator('textarea').fill(directText);
  await indirect.entry.locator('textarea').fill(indirectText);
  await retained.entry.locator('textarea').fill(retainedText);
  await page.locator('[data-step="prepare"]').click();
  const person = page.locator('#participants-list .participant-chip').filter({ hasText: '阿禾' });
  await person.getByRole('button', { name: '撤销参与' }).click();
  await expect(person).toContainText('已撤销参与');
  await page.locator('[data-step="questions"]').click();
  await expect(direct.entry).toHaveCount(0);
  await expect(indirect.entry).toHaveCount(0);
  await expect(retained.entry.locator('textarea')).toHaveValue(retainedText);
  await expectDraftsAbsent(page, [directText, indirectText]);
  await page.locator('[data-step="prepare"]').click();
  await person.getByRole('button', { name: '重新同意参与' }).click();
  await page.locator('[data-step="questions"]').click();
  await expect(direct.entry).toHaveCount(0);
  await expect(indirect.entry).toHaveCount(0);
  await expect(retained.entry.locator('textarea')).toHaveValue(retainedText);
  await restoreBackup(page, backup);
  await expect(direct.entry.locator('textarea')).toHaveValue('');
  await expect(indirect.entry.locator('textarea')).toHaveValue('');
  await expect(retained.entry.locator('textarea')).toHaveValue('');
  await expectDraftsAbsent(page, [directText, indirectText, retainedText]);
});

test('失败保存、坏备份及取消导入保留草稿，成功替换与撤销替换清空同编号旧草稿', async ({ page }) => {
  test.setTimeout(60000);
  await open(page);
  await prepare(page);
  await page.locator('[data-step="questions"]').click();
  const first = await addQuestion(page, '恢复边界的第一个问题');
  const second = await addQuestion(page, '恢复边界的第二个问题');
  const backup = (await downloadText(page, '#export-json')).content;
  const firstText = '失败或取消操作应保留的草稿癸';
  const secondText = '另一条仍在填写的恢复边界草稿';
  await first.entry.locator('textarea').fill(' \n ');
  await second.entry.locator('textarea').fill(secondText);
  await first.entry.getByRole('button', { name: '保存回应' }).click();
  await expect(page.locator('#message')).toContainText(/回答|原话|不能为空|填写/);
  await expect(first.entry.locator('textarea')).toHaveValue(' \n ');
  await expect(second.entry.locator('textarea')).toHaveValue(secondText);
  await first.entry.locator('textarea').fill(firstText);
  await page.locator('#import-file').setInputFiles({ name: 'broken-drafts.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await expect(page.locator('#message')).toContainText('当前手册未被替换');
  await expect(first.entry.locator('textarea')).toHaveValue(firstText);
  await expect(second.entry.locator('textarea')).toHaveValue(secondText);
  expect((await downloadText(page, '#export-json')).content).toBe(backup);
  page.removeAllListeners('dialog');
  page.confirmNext = 'cancel';
  await page.locator('#import-file').setInputFiles({ name: 'cancelled-drafts.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
  await expect(page.locator('#import-file')).toHaveValue('');
  await expect(first.entry.locator('textarea')).toHaveValue(firstText);
  await expect(second.entry.locator('textarea')).toHaveValue(secondText);
  page.on('dialog', dialog => dialog.accept());
  await restoreBackup(page, backup);
  await expect(first.entry.locator('textarea')).toHaveValue('');
  await expect(second.entry.locator('textarea')).toHaveValue('');
  await page.locator('#undo-clear').click();
  await page.locator('[data-step="questions"]').click();
  await expect(first.entry.locator('textarea')).toHaveValue('');
  await expect(second.entry.locator('textarea')).toHaveValue('');
  for (const replacement of ['#new-session', '#demo-button']) {
    await first.entry.locator('textarea').fill(firstText);
    await second.entry.locator('textarea').fill(secondText);
    await page.locator('[data-step="prepare"]').click();
    await page.locator(replacement).click();
    await expect(first.entry).toHaveCount(0);
    await expect(second.entry).toHaveCount(0);
    await page.locator('#undo-clear').click();
    await page.locator('[data-step="questions"]').click();
    await expect(first.entry.locator('textarea')).toHaveValue('');
    await expect(second.entry.locator('textarea')).toHaveValue('');
  }
  await expectDraftsAbsent(page, [firstText, secondText]);
});

test('可见操作完成四步、回应跳过、分歧、成果下载、打印、刷新与撤回', async ({ page }) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await open(page);
  await prepare(page);
  await page.locator('[data-step="memories"]').click();
  await addMemory(page, '阿禾', `${secret}：我记得是1998年中秋。`);
  await addMemory(page, '阿森', '我记得是1999年中秋，院子里挂着灯。');
  await addMemory(page, '阿禾', privateText, 'private');
  await page.locator('[data-step="questions"]').click();
  await page.locator('#question-from').selectOption({ label: '阿森' });
  await page.locator('#question-to').selectOption({ label: '阿禾' });
  await page.locator('#question-sources input[type="checkbox"]').first().check();
  await page.locator('#question-text').fill(`${secret}：你还记得谁拍的照片？`);
  await page.locator('#question-form button[type="submit"]').click();
  const firstQuestion = page.locator('#questions-list .entry').first();
  await firstQuestion.locator('textarea').fill(`${secret}：舅舅拿着相机，但年份我不确定。`);
  await firstQuestion.locator('form button[type="submit"]').click();
  await expect(firstQuestion).toContainText('舅舅拿着相机');
  await page.locator('#question-from').selectOption({ label: '阿禾' });
  await page.locator('#question-to').selectOption({ label: '阿森' });
  await page.locator('#question-text').fill('还有其他细节想补充吗？');
  await page.locator('#question-form button[type="submit"]').click();
  await page.locator('#questions-list .entry').last().getByRole('button', { name: /跳过/ }).click();
  await expect(page.locator('#questions-list')).toContainText('跳过');
  await page.locator('[data-step="stories"]').click();
  await expect(page.locator('#story-sources')).not.toContainText(privateText);
  await page.locator('#story-title').fill(`${secret}的共同故事`);
  const sources = page.locator('#story-sources input[type="checkbox"]');
  for (let i = 0; i < await sources.count(); i++) await sources.nth(i).check();
  await page.locator('#story-note').fill(`${secret}：家人共同归组，年份未定。`);
  await page.locator('#story-disagreement').fill(`${secret}：阿禾记得1998年，阿森记得1999年，两种说法并列。`);
  await page.locator('#story-submit').click();
  await expect(page.locator('#stories-list')).toContainText('两种说法并列');
  await expect(page.locator('#stories-list')).toContainText('阿禾');
  await expect(page.locator('#stories-list')).toContainText('阿森');
  const backup = await downloadText(page, '#export-json');
  const saved = JSON.parse(backup.content);
  expect(saved.memories).toHaveLength(4);
  expect(saved.questions.map(question => question.status)).toEqual(['answered', 'skipped']);
  expect(backup.content).toContain(privateText);
  const markdown = await downloadText(page, '#export-markdown');
  expect(markdown.content).toContain('1998');
  expect(markdown.content).toContain('1999');
  expect(markdown.content).toContain('两种说法并列');
  expect(markdown.content).toContain(saved.memories[0].id);
  expect(markdown.content).not.toContain(privateText);
  await page.evaluate(() => { window.print = () => { window.printWasCalled = true; }; });
  await page.locator('#print-stories').click();
  await expect.poll(() => page.evaluate(() => window.printWasCalled)).toBe(true);
  await expect(page.locator('#print-content')).toContainText('阿禾');
  await expect(page.locator('#print-content')).not.toContainText(privateText);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#print-content')).toBeVisible();
  await expect(page.locator('.book')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await page.screenshot({ path: '.auto-company/screenshots/story-desktop.png', fullPage: true });
  await page.reload();
  await expect(page.locator('#count-memories')).toHaveText('4');
  await page.locator('[data-step="stories"]').click();
  await expect(page.locator('#stories-list')).toContainText(`${secret}的共同故事`);
  await page.locator('[data-step="memories"]').click();
  await page.locator('#memories-list .entry').filter({ hasText: `${secret}：我记得` }).getByRole('button', { name: /撤回/ }).click();
  const withdrawn = await downloadText(page, '#export-json');
  expect(withdrawn.content).not.toContain(secret);
  await expect(page.locator('#print-content')).not.toContainText(secret);
  expect(JSON.parse(withdrawn.content).memories).toHaveLength(2);
  await page.locator('[data-step="stories"]').click();
  await expect(page.locator('#stories-list')).toContainText('待重新核对的故事');
  const after = await downloadText(page, '#export-markdown');
  expect(after.content).not.toContain(secret);
  expect(after.content).not.toContain(privateText);
  expect(markdown.content).toContain(secret);
  await page.locator('#import-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(backup.content) });
  await expect(page.locator('#count-memories')).toHaveText('4');
  await page.locator('[data-step="stories"]').click();
  await expect(page.locator('#stories-list')).toContainText(`${secret}的共同故事`);
  expect(errors).toEqual([]);
});

test('坏备份拒绝且保存现有活动，合法备份仍能继续使用', async ({ page }) => {
  await open(page);
  await prepare(page);
  const before = await downloadText(page, '#export-json');
  await page.locator('#import-file').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await expect(page.locator('#message')).toContainText(/JSON|备份|读取/);
  expect((await downloadText(page, '#export-json')).content).toBe(before.content);
  const wrong = JSON.parse(before.content);
  wrong.memories.push({ id: 'bad', participantId: 'unknown', text: '错误引用', eventHint: '', visibility: 'public' });
  await page.locator('#import-file').setInputFiles({ name: 'bad-reference.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(wrong)) });
  await expect(page.locator('#message')).toContainText(/自愿|备份|原话/);
  expect((await downloadText(page, '#export-json')).content).toBe(before.content);
  await page.reload();
  await expect(page.locator('#current-title')).toHaveText('院门前的合影');
  await expect(page.locator('#count-participants')).toHaveText('2');
});

test('拒绝本地存储时明确提示，当前录入仍可下载备份', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('synthetic denied', 'QuotaExceededError'); }; });
  await open(page);
  await prepare(page);
  await expect(page.locator('#save-status')).toContainText(/未保存|无法保存|导出|失败/);
  const backup = JSON.parse((await downloadText(page, '#export-json')).content);
  expect(backup.title).toBe('院门前的合影');
  expect(backup.participants).toHaveLength(2);
});

for (const corrupted of ['{损坏缓存', '']) test(`损坏缓存${corrupted ? '乱码' : '空串'}不被覆盖，可导出后明确重开`, async ({ page }) => {
  await open(page);
  await prepare(page);
  const cacheKey = await page.evaluate(() => Object.keys(localStorage).find(key => {
    try { return JSON.parse(localStorage.getItem(key)).version === 1; } catch { return false; }
  }));
  expect(cacheKey).toBeTruthy();
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: cacheKey, value: corrupted });
  await page.reload();
  await expect(page.locator('#recovery')).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), cacheKey)).toBe(corrupted);
  expect((await downloadText(page, '#download-raw')).content).toBe(corrupted);
  await page.locator('#restart-recovery').click();
  await expect(page.locator('#recovery')).toBeHidden();
  await expect(page.locator('#count-participants')).toHaveText('0');
});

test('修正称呼与原话保持来源编号，故事派生文字重新核对', async ({ page }) => {
  await open(page);
  await participant(page, '旧称呼');
  await page.locator('[data-step="memories"]').click();
  await addMemory(page, '旧称呼', '更正前的原话');
  const original = JSON.parse((await downloadText(page, '#export-json')).content);
  await page.locator('[data-step="stories"]').click();
  await page.locator('#story-title').fill('旧派生标题');
  await page.locator('#story-note').fill('旧派生注记');
  await page.locator('#story-sources input').first().check();
  await page.locator('#story-submit').click();
  await page.locator('[data-step="memories"]').click();
  await page.locator('#memories-list').getByRole('button', { name: '编辑原话' }).click();
  await expect(page.locator('#memory-participant')).toBeDisabled();
  await page.locator('#memory-text').fill('更正后的原话');
  await page.locator('#memory-submit').click();
  await page.locator('[data-step="stories"]').click();
  await expect(page.locator('#stories-list')).toContainText('待重新核对的故事');
  await expect(page.locator('#stories-list')).not.toContainText('旧派生注记');
  await page.locator('[data-step="prepare"]').click();
  page.removeAllListeners('dialog');
  page.confirmName = '新称呼';
  await page.locator('#participants-list').getByRole('button', { name: '修改称呼' }).click();
  page.on('dialog', dialog => dialog.accept());
  await expect(page.locator('#participants-list')).toContainText('新称呼');
  const corrected = JSON.parse((await downloadText(page, '#export-json')).content);
  expect(corrected.memories[0].id).toBe(original.memories[0].id);
  expect(corrected.memories[0].participantId).toBe(original.memories[0].participantId);
  expect(corrected.memories[0].text).toBe('更正后的原话');
  await page.locator('[data-step="stories"]').click();
  await expect(page.locator('#stories-list')).toContainText('新称呼');
});

test('清空可取消和撤销，空活动不捏造故事', async ({ page }) => {
  await open(page);
  await participant(page, '试用者');
  page.removeAllListeners('dialog');
  page.confirmNext = 'cancel';
  await page.locator('#new-session').click();
  await expect(page.locator('#count-participants')).toHaveText('1');
  page.on('dialog', dialog => dialog.accept());
  await page.locator('#new-session').click();
  await expect(page.locator('#count-participants')).toHaveText('0');
  await page.locator('#undo-clear').click();
  await expect(page.locator('#count-participants')).toHaveText('1');
  await page.locator('[data-step="stories"]').click();
  await page.locator('#story-title').fill('不能凭空生成');
  await page.locator('#story-submit').click();
  await expect(page.locator('#count-stories')).toHaveText('0');
  await expect(page.locator('#message')).toContainText(/原话|选择|至少/);
  await page.locator('[data-step="questions"]').click();
  await page.locator('#question-text').fill('无来源问题中的敏感标记丙');
  await page.locator('#question-form button[type="submit"]').click();
  await page.locator('#questions-list .entry').getByRole('button', { name: /跳过/ }).click();
  expect((await downloadText(page, '#export-json')).content).toContain('敏感标记丙');
  await page.locator('#questions-list .entry').getByRole('button', { name: '撤回问题' }).click();
  expect((await downloadText(page, '#export-json')).content).not.toContain('敏感标记丙');
});

test('用户HTML只作为文字显示，页面和打印不执行', async ({ page }) => {
  await open(page);
  await participant(page, '安全试用者');
  await page.locator('[data-step="memories"]').click();
  const hostile = '<img src=x onerror="window.injectedFamily=true">[点我](javascript:alert(1))';
  await addMemory(page, '安全试用者', hostile);
  expect(await page.evaluate(() => window.injectedFamily)).toBeUndefined();
  await expect(page.locator('#memories-list img')).toHaveCount(0);
  await page.locator('[data-step="stories"]').click();
  await page.locator('#story-title').fill('文字安全');
  await page.locator('#story-sources input').first().check();
  await page.locator('#story-submit').click();
  await page.evaluate(() => { window.print = () => {}; });
  await page.locator('#print-stories').click();
  expect(await page.evaluate(() => window.injectedFamily)).toBeUndefined();
  await expect(page.locator('#print-content img')).toHaveCount(0);
  const markdown = (await downloadText(page, '#export-markdown')).content;
  expect(markdown).not.toContain('<img');
  expect(markdown).toContain('&lt;img');
});

test('手机四步可操作且长原话不造成横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await participant(page, '手机试用者');
  await page.locator('[data-step="memories"]').click();
  await addMemory(page, '手机试用者', '这一段是合成回忆。' + '细节'.repeat(100));
  await page.locator('[data-step="questions"]').click();
  await expect(page.locator('#question-text')).toBeVisible();
  await page.locator('[data-step="stories"]').click();
  await page.locator('#story-title').fill('一人试用的故事');
  await page.locator('#story-sources input').first().check();
  await page.locator('#story-submit').click();
  await expect(page.locator('#stories-list')).toContainText('手机试用者');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '.auto-company/screenshots/story-mobile.png', fullPage: true });
  expect((await downloadText(page, '#export-markdown')).content).toContain('手机试用者');
});

test('页内确认保留危险说明，Escape取消且焦点回到原操作，确认后才清空', async ({ page }) => {
  await page.goto('/');
  await participant(page, '合成确认参与者');
  await page.locator('#new-session').click();
  const modal = page.getByRole('dialog', { name: '确认这次操作' });
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('请先下载完整备份');
  await expect(modal.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await expect(page.locator('#count-participants')).toHaveText('1');
  await expect(page.locator('#new-session')).toBeFocused();
  await page.locator('#new-session').click();
  await modal.getByRole('button', { name: '确认继续' }).click();
  await expect(page.locator('#count-participants')).toHaveText('0');
});

test('完整备份的隐私确认可用键盘取消，不发起下载', async ({ page }) => {
  await page.goto('/');
  const downloads = [];
  page.on('download', file => downloads.push(file.suggestedFilename()));
  await page.locator('#export-json').click();
  const modal = page.getByRole('dialog');
  await expect(modal).toContainText('私密原话、参与者称呼和所有互问');
  await page.keyboard.press('Enter');
  await expect(modal).toBeHidden();
  expect(downloads).toEqual([]);
  await expect(page.locator('#export-json')).toBeFocused();
});
