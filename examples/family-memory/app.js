import { createSession, updateSession, addParticipant, updateParticipant, addMemory, updateMemory, withdrawMemory, addQuestion, answerQuestion, removeQuestion, addStory, updateStory, removeStory, validateSession, exportMarkdown, exportJSON, importJSON } from './core.js';

const STORAGE_KEY = 'family-memory-session-v1';
const $ = id => document.getElementById(id);
let state = createSession();
let blocked = false;
let rawCache = null;
let undoState = null;
let editingMemory = null;
let editingStory = null;
let currentStep = 'prepare';
let saved = false;
let hasChanges = false;
let saveLabel = '尚未保存';
const answerDrafts = new Map();

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function button(text, handler, className = '') {
  const element = node('button', text, className);
  element.type = 'button';
  element.addEventListener('click', handler);
  return element;
}
function tell(text, error = false) {
  $('message').textContent = text;
  $('message').classList.toggle('error', error);
}
function persist() {
  hasChanges = true;
  try {
    localStorage.setItem(STORAGE_KEY, exportJSON(state));
    saved = true;
    hasChanges = false;
    saveLabel = `已保存到这台设备 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    saved = false;
    saveLabel = '尚未保存：浏览器存储不可用，请下载完整备份';
  }
  $('save-status').textContent = saveLabel;
  $('save-status').classList.toggle('unsaved', !saved);
}
function commit(next, message, keepUndo = false) {
  if (blocked) throw new Error('请先下载原始缓存，再明确重新开始；当前缓存不会被覆盖。');
  const validated = validateSession(next);
  const clearedDrafts = reconcileDrafts(validated);
  state = validated;
  if (!keepUndo) undoState = null;
  persist();
  render();
  tell(message + (clearedDrafts ? ' 关联的未保存表单草稿已清理；其他草稿继续保留在本页。' : '') + (saved ? '' : ' 内容仍在本页，请立即下载完整 JSON 备份，关闭页面会丢失未保存内容。'), !saved);
}
function attempt(action) {
  try { Promise.resolve(action()).catch(error => tell(error.message || '操作未完成，请检查输入。', true)); } catch (error) { tell(error.message || '操作未完成，请检查输入。', true); }
}

function openConfirmation(message, initialName) {
  const dialog = $('confirmation-dialog');
  if (dialog.open) return Promise.resolve(initialName === undefined ? false : null);
  const previousFocus = document.activeElement;
  const editingName = initialName !== undefined;
  $('confirmation-title').textContent = editingName ? '修改参与者称呼' : '确认这次操作';
  $('confirmation-message').textContent = message;
  $('confirmation-name-field').hidden = !editingName;
  $('confirmation-name').value = editingName ? initialName : '';
  $('confirmation-accept').textContent = editingName ? '保存称呼' : '确认继续';
  dialog.returnValue = 'cancel';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      const accepted = dialog.returnValue === 'accept';
      if (previousFocus?.isConnected) previousFocus.focus();
      resolve(editingName ? (accepted ? $('confirmation-name').value : null) : accepted);
    }, { once: true });
    dialog.showModal();
    // 危险操作默认停在取消；修改称呼默认停在输入框。
    $(editingName ? 'confirmation-name' : 'confirmation-cancel').focus();
  });
}
function askConfirmation(message) { return openConfirmation(message); }
function askName(message, value) { return openConfirmation(message, value); }

function name(participantId) { return state.participants.find(person => person.id === participantId)?.name || '已撤回的参与者'; }
function empty(container, text) {
  const box = node('div', undefined, 'empty-state');
  box.append(node('p', text));
  container.append(box);
}
function fields(form) { return Object.fromEntries(new FormData(form)); }
function chosen(containerId) { return [...$(containerId).querySelectorAll('input:checked')].map(input => input.value); }
function reconcileDrafts(next) {
  let clearedDrafts = false;
  const openQuestions = new Set(next.questions.filter(question => question.status === 'open').map(question => question.id));
  for (const questionId of answerDrafts.keys()) {
    if (openQuestions.has(questionId)) continue;
    if (!next.questions.some(question => question.id === questionId)) clearedDrafts = true;
    answerDrafts.delete(questionId);
  }

  // 撤回或修订来源后，仅清理明确关联的草稿，不能把旧文字带回已清理的内容。
  const changedMemories = new Set(state.memories.filter(memory => {
    const remaining = next.memories.find(item => item.id === memory.id);
    return !remaining || ['participantId', 'text', 'eventHint', 'visibility'].some(key => remaining[key] !== memory[key]);
  }).map(memory => memory.id));
  const withdrawnParticipants = new Set(state.participants.filter(person => person.consent && !next.participants.some(item => item.id === person.id && item.consent)).map(person => person.id));
  if (withdrawnParticipants.has($('memory-participant').value) || (editingMemory && changedMemories.has(editingMemory))) { resetMemoryForm(); clearedDrafts = true; }
  if (withdrawnParticipants.has($('question-from').value) || withdrawnParticipants.has($('question-to').value) || chosen('question-sources').some(id => changedMemories.has(id))) { $('question-form').reset(); clearedDrafts = true; }
  const previousStory = state.stories.find(story => story.id === editingStory);
  const remainingStory = next.stories.find(story => story.id === editingStory);
  if (chosen('story-sources').some(id => changedMemories.has(id)) || (editingStory && (!remainingStory || JSON.stringify(previousStory) !== JSON.stringify(remainingStory)))) { resetStoryForm(); clearedDrafts = true; }
  return clearedDrafts;
}
function showStep(step, focus = true) {
  currentStep = step;
  document.querySelectorAll('.chapter').forEach(chapter => { chapter.hidden = chapter.id !== `step-${step}`; });
  document.querySelectorAll('[data-step]').forEach(tab => {
    if (tab.dataset.step === step) tab.setAttribute('aria-current', 'step');
    else tab.removeAttribute('aria-current');
  });
  if (focus) {
    $('workspace').focus({ preventScroll: true });
    $('workspace').scrollIntoView({ block: 'start', behavior: 'auto' });
  }
}
function sessionFields() {
  for (const field of ['title', 'date', 'place', 'prompt']) $(`session-${field}`).value = state[field];
}
function participantOptions(select) {
  const previous = select.value;
  select.replaceChildren();
  const willing = state.participants.filter(person => person.consent);
  const option = node('option', willing.length ? '请选择参与者' : '先到“准备”添加自愿参与者');
  option.value = '';
  select.append(option);
  for (const person of willing) {
    const item = node('option', person.name);
    item.value = person.id;
    select.append(item);
  }
  if (willing.some(person => person.id === previous)) select.value = previous;
  else if (willing.length === 1) select.value = willing[0].id;
}
function sourceOptions(containerId, selected = null) {
  const container = $(containerId);
  const active = selected || chosen(containerId);
  container.replaceChildren();
  const publicMemories = state.memories.filter(memory => memory.visibility === 'public');
  if (!publicMemories.length) { empty(container, '还没有可共同留存的原话。先在“讲述”里保存一段公开原话。'); return; }
  for (const memory of publicMemories) {
    const label = node('label', undefined, 'check-line source-option');
    const input = node('input');
    input.type = 'checkbox';
    input.value = memory.id;
    input.checked = active.includes(memory.id);
    input.name = containerId === 'story-sources' ? 'memoryIds' : 'sourceIds';
    const content = node('span');
    content.append(node('b', `${name(memory.participantId)}：${memory.text.length > 100 ? memory.text.slice(0, 100) + '…' : memory.text}`), node('small', `${memory.eventHint || '未填写线索'} · 原话 ${memory.id}`));
    label.append(input, content);
    container.append(label);
  }
}
function renderParticipants() {
  const container = $('participants-list');
  container.replaceChildren();
  for (const person of state.participants) {
    const chip = node('div', undefined, 'participant-chip');
    chip.append(node('span', person.name), node('small', person.consent ? '自愿参与' : '已撤销参与'));
    chip.append(button('修改称呼', () => attempt(async () => {
      const nextName = await askName('修改这位参与者的署名或称呼；其原话和故事署名会一起更新。', person.name);
      if (nextName === null) return;
      commit(updateParticipant(state, person.id, { name: nextName }), '已修改称呼；原话和故事中的署名同步更新。');
    }), 'text-button'));
    chip.append(button(person.consent ? '撤销参与' : '重新同意参与', () => attempt(async () => {
      const question = person.consent ? `确定撤销「${person.name}」的参与吗？这会清理其原话、相关互问和故事引用；称呼仍会保留。无法识别手动复制到无引用文字中的内容，请自行检查；已导出副本也需要自行删除。` : `「${person.name}」是否已重新明确同意本次记录与署名？`;
      if (!await askConfirmation(question)) return;
      commit(updateParticipant(state, person.id, { consent: !person.consent }), person.consent ? '已撤销参与并清理关联内容；称呼保留在参与者表中。' : '已记录重新同意参与。');
    }), 'text-button'));
    container.append(chip);
  }
}
function renderMemories() {
  const container = $('memories-list');
  container.replaceChildren();
  $('memory-list-count').textContent = `${state.memories.length} 段`;
  if (!state.memories.length) empty(container, '这里会留住每个人的原话。先讲一件具体的小事就好。');
  for (const memory of state.memories) {
    const article = node('article', undefined, 'entry');
    article.dataset.memoryId = memory.id;
    const header = node('div', undefined, 'entry-header');
    const identity = node('div');
    identity.append(node('p', name(memory.participantId), 'entry-author'), node('p', `${memory.eventHint || '未填写线索'} · 原话 ${memory.id}`, 'entry-meta'));
    header.append(identity, node('span', memory.visibility === 'private' ? '本地私密' : '可共同留存', `badge ${memory.visibility === 'private' ? 'private' : ''}`));
    const actions = node('div', undefined, 'entry-actions');
    actions.append(button('编辑原话', () => editMemory(memory)), button('撤回原话', () => attempt(async () => {
      if (!await askConfirmation('确定撤回这段原话吗？关联互问、回答及故事引用会被清理；受影响故事的标题和整理文字会重新待核对。手动复制到其他无引用文字中的同内容请自行检查；已下载或打印的副本请自行删除。')) return;
      commit(withdrawMemory(state, memory.id), '已撤回这段原话并清理关联内容。请检查其他手动复制的文字和已导出副本。');
    }), 'danger'));
    article.append(header, node('p', memory.text, 'entry-text'), actions);
    container.append(article);
  }
}
function renderQuestions() {
  const container = $('questions-list');
  container.replaceChildren();
  $('question-list-count').textContent = `${state.questions.length} 个`;
  if (!state.questions.length) empty(container, '听见一处想知道的细节，就留一个问题。也可以直接去整理故事。');
  for (const question of state.questions) {
    const article = node('article', undefined, 'entry');
    article.dataset.questionId = question.id;
    const header = node('div', undefined, 'entry-header');
    header.append(node('p', `${name(question.fromId)} 问 ${name(question.toId)}`, 'entry-author'), node('span', { open: '待回应', answered: '已回应', skipped: '自愿跳过' }[question.status], 'badge'));
    article.append(header, node('p', question.text, 'entry-text'), node('p', `出处：${question.sourceIds.length ? question.sourceIds.join('、') : '现场新问题'}`, 'entry-meta'));
    if (question.status === 'open') {
      const form = node('form', undefined, 'answer-form');
      const label = node('label', `由 ${name(question.toId)} 回应（将保存为公开原话）`);
      const text = node('textarea');
      text.id = `answer-${question.id}`;
      text.name = 'answer'; text.rows = 3; text.maxLength = 6000;
      text.value = answerDrafts.get(question.id) || '';
      text.addEventListener('input', () => {
        if (text.value) answerDrafts.set(question.id, text.value);
        else answerDrafts.delete(question.id);
      });
      label.htmlFor = text.id;
      const actions = node('div', undefined, 'button-row');
      const submit = node('button', '保存回应', 'primary'); submit.type = 'submit';
      actions.append(submit, button('这次跳过', () => attempt(() => commit(answerQuestion(state, question.id, { skip: true }), '已记录自愿跳过，无需说明理由。'))));
      form.append(label, text, actions);
      form.addEventListener('submit', event => { event.preventDefault(); attempt(() => commit(answerQuestion(state, question.id, { text: text.value, skip: false }), '回应已保存，并加入署名原话。')); });
      article.append(form);
    } else if (question.status === 'answered') article.append(node('p', `${name(question.toId)} 回应：\n${question.answer}\n原话编号：${question.answerMemoryId}`, 'answer-note'));
    const actions = node('div', undefined, 'entry-actions');
    actions.append(button('撤回问题', () => attempt(async () => {
      if (!await askConfirmation('撤回这个问题吗？它的回答原话及进一步关联的互问会被清理，受影响故事需要重新核对；作为问题出处的原话仍会保留。已导出副本请自行删除。')) return;
      commit(removeQuestion(state, question.id), '已撤回问题与关联回答。原始出处保留，受影响故事请重新核对。');
    }), 'danger'));
    article.append(actions);
    container.append(article);
  }
}
function storyPage(story, index, controls = true) {
  const article = node('article', undefined, 'entry story-page');
  article.dataset.storyId = story.id;
  article.append(node('p', `共同故事 / ${String(index + 1).padStart(2, '0')}`, 'story-number'), node('h3', story.title, 'entry-author'), node('p', `故事编号：${story.id}`, 'entry-meta'));
  if (story.note) article.append(node('p', story.note, 'story-note'));
  for (const memoryId of story.memoryIds) {
    const memory = state.memories.find(item => item.id === memoryId && item.visibility === 'public');
    if (!memory) continue;
    const quote = node('blockquote', memory.text);
    quote.append(node('cite', `${name(memory.participantId)} · ${memory.eventHint || '未填写线索'} · 原话 ${memory.id}`));
    article.append(quote);
  }
  if (story.disagreement) {
    const note = node('div', undefined, 'disagreement');
    note.append(node('strong', '不同记得 / 暂不下结论'), node('span', story.disagreement));
    article.append(note);
  }
  if (controls) {
    const actions = node('div', undefined, 'entry-actions');
    actions.append(button('编辑故事', () => editStory(story)), button('删除故事', () => attempt(async () => {
      if (!await askConfirmation('删除这页共同故事吗？原话仍然保留，已导出的副本需要自行处理。')) return;
      if (editingStory === story.id) resetStoryForm();
      commit(removeStory(state, story.id), '已删除这页故事；署名原话仍然保留。');
    }), 'danger'));
    article.append(actions);
  }
  return article;
}
function renderStories() {
  const container = $('stories-list');
  container.replaceChildren();
  $('story-list-count').textContent = `${state.stories.length} 页`;
  if (!state.stories.length) empty(container, '共同故事会出现在这里。它可以很短，但每段原话都有出处。');
  state.stories.forEach((story, index) => container.append(storyPage(story, index)));
}
function render() {
  $('print-content').replaceChildren();
  $('current-title').textContent = state.title;
  $('current-detail').textContent = [state.date, state.place, state.prompt].filter(Boolean).join(' · ') || '准备一张照片、一件旧物，或一个问题。';
  $('count-participants').textContent = state.participants.filter(person => person.consent).length;
  $('count-memories').textContent = state.memories.length;
  $('count-stories').textContent = state.stories.length;
  $('save-status').textContent = saveLabel;
  $('save-status').classList.toggle('unsaved', !saved);
  for (const selectId of ['memory-participant', 'question-from', 'question-to']) participantOptions($(selectId));
  renderParticipants(); renderMemories(); renderQuestions(); renderStories();
  sourceOptions('question-sources'); sourceOptions('story-sources');
  $('undo-clear').hidden = !undoState;
  for (const form of document.querySelectorAll('#workspace form')) for (const control of form.elements) control.disabled = blocked;
  if (editingMemory) $('memory-participant').disabled = true;
  for (const id of ['demo-button', 'new-session']) $(id).disabled = blocked;
}
function resetMemoryForm() {
  editingMemory = null;
  $('memory-form').reset();
  $('memory-form-heading').textContent = '留下一段讲述';
  $('memory-submit').textContent = '保存原话';
  $('memory-cancel').hidden = true;
  $('memory-participant').disabled = false;
}
function editMemory(memory) {
  editingMemory = memory.id;
  $('memory-participant').value = memory.participantId;
  $('memory-participant').disabled = true;
  $('memory-text').value = memory.text;
  $('memory-event').value = memory.eventHint;
  $('memory-form').elements.visibility.value = memory.visibility;
  $('memory-form-heading').textContent = '修改这段讲述';
  $('memory-submit').textContent = '保存修改';
  $('memory-cancel').hidden = false;
  tell('修改原话会清理关联互问，相关故事整理文字需重新核对。原话的署名保持不变。');
  $('memory-text').focus();
}
function resetStoryForm() {
  editingStory = null;
  $('story-form').reset();
  $('story-form-heading').textContent = '编一页共同故事';
  $('story-submit').textContent = '保存共同故事';
  $('story-cancel').hidden = true;
}
function resetDrafts() {
  answerDrafts.clear();
  $('session-form').reset();
  $('participant-form').reset();
  resetMemoryForm();
  resetStoryForm();
  $('question-form').reset();
}
function editStory(story) {
  editingStory = story.id;
  $('story-title').value = story.title;
  $('story-note').value = story.note;
  $('story-disagreement').value = story.disagreement;
  sourceOptions('story-sources', story.memoryIds);
  $('story-form-heading').textContent = '修改这页共同故事';
  $('story-submit').textContent = '保存故事修改';
  $('story-cancel').hidden = false;
  tell('更换出处时，请重新核对标题与整理文字；沿用原文字会被清空，以免遗漏撤回内容。');
  $('story-title').focus();
}
function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = node('a'); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function filename(extension) {
  return `${state.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').slice(0, 80) || '家族共忆'}.${extension}`;
}
function allowExport() { if (blocked) throw new Error('当前缓存未能读取，请先使用“下载原始缓存”保留原始内容。'); }
function preparePrint() {
  const container = $('print-content'); container.replaceChildren();
  container.append(node('h1', state.title), node('p', `${state.date || '日期未记录'} · ${state.place || '地点未记录'}\n共同故事、公开原话与互问；私密原话不在此页。不同记忆并列，不裁定事实。`, 'print-preface'));
  state.stories.forEach((story, index) => container.append(storyPage(story, index, false)));
  const used = new Set(state.stories.flatMap(story => story.memoryIds));
  const remaining = state.memories.filter(memory => memory.visibility === 'public' && !used.has(memory.id));
  if (remaining.length) {
    container.append(node('h2', '尚未归组的共同原话'));
    for (const memory of remaining) {
      const article = node('article', undefined, 'story-page');
      const quote = node('blockquote', memory.text);
      quote.append(node('cite', `${name(memory.participantId)} · ${memory.eventHint || '未填写线索'} · 原话 ${memory.id}`));
      article.append(quote); container.append(article);
    }
  }
  if (state.questions.length) {
    container.append(node('h2', '本次互问'));
    for (const question of state.questions) {
      const article = node('article', undefined, 'story-page');
      article.append(node('h3', `${name(question.fromId)} 问 ${name(question.toId)}`), node('p', question.text, 'entry-text'), node('p', `问题 ${question.id} · ${{ open: '待回应', answered: '已回应', skipped: '自愿跳过' }[question.status]}\n出处：${question.sourceIds.join('、') || '现场新问题'}`, 'print-preface'));
      if (question.answer) article.append(node('p', `${name(question.toId)} 回应：${question.answer}\n回答原话：${question.answerMemoryId}`, 'answer-note'));
      container.append(article);
    }
  }
}

document.querySelectorAll('[data-step]').forEach(tab => tab.addEventListener('click', () => showStep(tab.dataset.step)));
document.querySelectorAll('[data-go]').forEach(tab => tab.addEventListener('click', () => showStep(tab.dataset.go)));
$('session-form').addEventListener('submit', event => { event.preventDefault(); attempt(() => { commit(updateSession(state, fields(event.currentTarget)), '活动起点已保存。'); sessionFields(); }); });
$('participant-form').addEventListener('submit', event => {
  event.preventDefault();
  attempt(() => {
    const form = event.currentTarget;
    commit(addParticipant(state, { name: $('participant-name').value, consent: $('participant-consent').checked }), '已添加自愿参与者。');
    form.reset(); $('participant-name').focus();
  });
});
$('memory-form').addEventListener('submit', event => {
  event.preventDefault();
  attempt(() => {
    const values = fields(event.currentTarget);
    const next = editingMemory ? updateMemory(state, editingMemory, values) : addMemory(state, values);
    const message = editingMemory ? '原话已修改；关联互问和故事整理文字已清理，请重新核对。' : '原话已保存。可以把设备交给下一位讲述者。';
    resetMemoryForm();
    commit(next, message);
  });
});
$('memory-cancel').addEventListener('click', () => { resetMemoryForm(); render(); tell('已取消原话编辑。'); });
$('question-form').addEventListener('submit', event => {
  event.preventDefault();
  attempt(() => {
    const next = addQuestion(state, { ...fields(event.currentTarget), sourceIds: chosen('question-sources') });
    event.currentTarget.reset(); commit(next, '问题已留下。被问到的人可以回应，也可以自愿跳过。');
  });
});
$('story-form').addEventListener('submit', event => {
  event.preventDefault();
  attempt(() => {
    const values = { ...fields(event.currentTarget), memoryIds: chosen('story-sources') };
    const next = editingStory ? updateStory(state, editingStory, values) : addStory(state, values);
    resetStoryForm(); commit(next, '共同故事已保存。请与参与者一起核对，再导出留存。');
  });
});
$('story-cancel').addEventListener('click', () => { resetStoryForm(); sourceOptions('story-sources', []); tell('已取消故事编辑。'); });
$('export-json').addEventListener('click', () => attempt(async () => {
  allowExport();
  if (!await askConfirmation('完整 JSON 备份包含私密原话、参与者称呼和所有互问。请确认已获得参与者同意，并妥善保管。是否下载？')) return;
  download(exportJSON(state), filename('json'), 'application/json;charset=utf-8'); tell('已发起完整备份下载，请确认下载文件已保存在安全位置。');
}));
$('export-markdown').addEventListener('click', () => attempt(async () => {
  allowExport();
  if (!await askConfirmation('将下载共同故事、未归组公开原话和互问，不含私密原话。请先核对所有文字；导出后撤回无法收回已下载的副本。是否下载？')) return;
  download(exportMarkdown(state), filename('md'), 'text/markdown;charset=utf-8'); tell('已发起故事下载；包含公开原话与互问，请确认下载文件。');
}));
$('print-stories').addEventListener('click', () => attempt(async () => {
  allowExport();
  if (!await askConfirmation('将打印共同故事、公开原话和互问，不含私密原话。打印副本无法自动撤回。请先共同核对，是否继续？')) return;
  preparePrint(); window.print();
}));
$('import-button').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async event => {
  const input = event.currentTarget;
  const file = input.files[0];
  if (!file) return;
  try {
    if (file.size > 3000000) throw new Error('备份文件不能超过 3 MB。当前手册未改变。');
    const next = importJSON(await file.text());
    if (blocked) throw new Error('请先下载原始缓存并明确重新开始，再恢复备份；原始内容尚未覆盖。');
    if (!await askConfirmation('已检查备份格式。恢复将替换当前活动（包括私密原话）。请先备份当前内容；是否确认替换？')) return;
    undoState = state;
    resetDrafts();
    commit(next, '已从备份恢复活动。下一次修改或关闭本页前，可以撤销恢复。', true);
    $('undo-clear').textContent = '撤销恢复，回到上个活动';
    sessionFields(); showStep('prepare');
  } catch (error) { tell(`${error.message} 当前手册未被替换。`, true); }
  finally { input.value = ''; }
});
$('new-session').addEventListener('click', () => attempt(async () => {
  if (!await askConfirmation('清空这台设备上的当前活动并开始新活动？所有原话、互问和故事将被替换。请先下载完整备份。下一次修改或关闭本页后无法撤销，已导出的副本不会删除。')) return;
  undoState = state;
  resetDrafts();
  commit(createSession(), '已开始新活动。下一次修改或关闭本页前可以撤销清空；先前的导出副本不受影响。', true);
  $('undo-clear').textContent = '撤销清空'; sessionFields(); showStep('prepare');
}));
$('undo-clear').addEventListener('click', () => attempt(async () => {
  if (!undoState) return;
  if (!await askConfirmation('恢复上一次清空或替换前的活动？当前新活动会被替换，请先备份需要保留的内容。')) return;
  const next = undoState; undoState = null;
  resetDrafts(); commit(next, '已恢复上一个活动。'); sessionFields(); showStep('prepare');
}));
$('demo-button').addEventListener('click', () => attempt(async () => {
  if (!await askConfirmation('加载明确标记的虚构示例会替换当前活动。请先备份当前内容。下一次修改或关闭本页前可以撤销替换。是否继续？')) return;
  let demo = updateSession(createSession(), { title: '虚构示例 · 那张团圆饭桌', date: '2026-10-01', place: '虚构场景：家中客厅', prompt: '这些人物和回忆均为合成示例，不代表真实使用者。' });
  demo = addParticipant(demo, { name: '外婆（虚构）', consent: true });
  demo = addParticipant(demo, { name: '阿宁（虚构）', consent: true });
  demo = addMemory(demo, { participantId: demo.participants[0].id, text: '我记得那年是除夕。桌子小，大家把凳子挤在一起，菜却一道也没少。', eventHint: '虚构：一次春节团圆饭', visibility: 'public' });
  demo = addMemory(demo, { participantId: demo.participants[1].id, text: '我记得是初二，窗外还下着雨。那碗红烧肉最后是我吃完的。', eventHint: '虚构：同一次团圆饭', visibility: 'public' });
  demo = addMemory(demo, { participantId: demo.participants[1].id, text: '这是虚构的私密记录，仅用于说明它不会进入共同故事。', eventHint: '虚构：私密示例', visibility: 'private' });
  demo = addQuestion(demo, { fromId: demo.participants[1].id, toId: demo.participants[0].id, sourceIds: [demo.memories[0].id], text: '虚构问题：那张小桌子后来放到哪里了？' });
  demo = answerQuestion(demo, demo.questions[0].id, { text: '虚构回应：后来放到了阳台上，我拿它摆花。', skip: false });
  demo = addStory(demo, { title: '虚构故事 · 小桌子，大团圆', memoryIds: demo.memories.filter(memory => memory.visibility === 'public').map(memory => memory.id), note: '这是用于熟悉操作的合成示例。两个人想起了同一张饭桌，也留下了不同记得。', disagreement: '外婆记得是除夕，阿宁记得是初二；不选择其中一方为定论。' });
  undoState = state; resetDrafts();
  commit(demo, '已载入虚构示例。人物、原话与回应均非真实使用证据。下一次修改或关闭本页前可以撤销替换。', true);
  $('undo-clear').textContent = '撤销示例，恢复上个活动'; sessionFields();
}));
$('download-raw').addEventListener('click', () => { download(rawCache, '家族共忆-原始缓存.txt', 'text/plain;charset=utf-8'); tell('已发起原始缓存下载。请确认文件保存成功，再重新开始。'); });
$('restart-recovery').addEventListener('click', async () => {
  if (!await askConfirmation('确认已保留需要的原始缓存，并放弃当前无法读取的缓存内容？重新开始将覆盖原缓存，不能撤销。')) return;
  blocked = false; rawCache = null; $('recovery').hidden = true;
  state = createSession(); persist(); sessionFields(); render();
  tell(saved ? '已明确重新开始。可以创建新的活动。' : '已重新开始，但本地存储不可用。请使用完整备份保管活动。', !saved);
});
window.addEventListener('beforeunload', event => {
  if (!blocked && ((!saved && hasChanges) || answerDrafts.size)) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('storage', event => {
  if (event.key === STORAGE_KEY) {
    saved = false;
    saveLabel = '其他页面改变了本地活动，请先备份本页再刷新';
    $('save-status').textContent = saveLabel; $('save-status').classList.add('unsaved');
    tell('检测到同一浏览器的其他页面修改了活动。本页内容尚未同步，请立即备份本页；继续保存会覆盖其他页面的内容。', true);
  }
});

try {
  const cached = localStorage.getItem(STORAGE_KEY);
  if (cached !== null) {
    rawCache = cached;
    state = importJSON(cached);
    saved = true; saveLabel = '已恢复这台设备上的活动'; rawCache = null;
  } else { saved = false; saveLabel = '新手册 · 第一次保存后会留在这台设备'; }
} catch (error) {
  if (rawCache !== null) {
    blocked = true; saved = false; saveLabel = '缓存需要恢复，原始内容尚未覆盖';
    $('recovery').hidden = false;
    $('recovery-message').textContent = error.message || '上次的活动格式损坏。';
  } else { saved = false; saveLabel = '浏览器存储不可用，请使用完整备份'; tell('无法访问浏览器本地存储。仍可使用本页并导出完整备份；关闭后未备份的内容可能丢失。', true); }
}
sessionFields(); render(); showStep(currentStep, false);
