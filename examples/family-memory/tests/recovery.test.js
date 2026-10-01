import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, updateSession, addParticipant, updateParticipant, addMemory, updateMemory, withdrawMemory, addQuestion, answerQuestion, removeQuestion, addStory, updateStory, removeStory, validateSession, exportMarkdown, exportJSON, importJSON } from '../core.js';

function family(count = 3) {
  let state = createSession();
  for (const name of ['阿姨', '舅舅', '晚辈', '外婆', '叔叔'].slice(0, count)) state = addParticipant(state, { name, consent: true });
  return state;
}

function memory(state, person, text, visibility = 'public') {
  return addMemory(state, { participantId: state.participants[person].id, text, eventHint: '院门前的旧照片', visibility });
}

function fixture() {
  let state = family();
  state = memory(state, 0, '我记得是秋天，大家在院门前拍照。');
  state = memory(state, 1, '我记得是春天，还穿着薄外套。');
  return state;
}

test('支持一人试用及五位亲属，第六位拒绝', () => {
  let state = family(1);
  state = memory(state, 0, '我愿意先试着讲一段。');
  state = addQuestion(state, { fromId: state.participants[0].id, toId: state.participants[0].id, sourceIds: [], text: '还有什么细节？' });
  assert.equal(state.questions.length, 1);
  assert.throws(() => addParticipant(family(5), { name: '第六位', consent: true }), /不超过 5/);
});

test('自愿同意必须明确，未同意者不能投稿或加入互问', () => {
  assert.throws(() => addParticipant(createSession(), { name: '阿姨' }), /明确/);
  let state = family(1);
  state = addParticipant(state, { name: '暂不参加', consent: false });
  assert.throws(() => memory(state, 1, '不应该录入'), /自愿/);
  assert.throws(() => addQuestion(state, { fromId: state.participants[0].id, toId: state.participants[1].id, sourceIds: [], text: '问题' }), /自愿/);
});

test('私密原话仅进完整备份，不进故事、互问或Markdown', () => {
  let state = fixture();
  state = memory(state, 2, 'PRIVATE_SECRET_旧宅', 'private');
  const privateId = state.memories.at(-1).id;
  assert.ok(exportJSON(state).includes('PRIVATE_SECRET_旧宅'));
  assert.ok(!exportMarkdown(state).includes('PRIVATE_SECRET_旧宅'));
  assert.ok(!exportMarkdown(state).includes(privateId));
  assert.throws(() => addStory(state, { title: '私密不能归组', memoryIds: [privateId] }), /共同留存/);
  assert.throws(() => addQuestion(state, { fromId: state.participants[0].id, toId: state.participants[1].id, sourceIds: [privateId], text: '不能泄漏' }), /私密/);
});

test('撤回清除原话、互问及派生标题注记分歧中的敏感标记', () => {
  let state = fixture();
  state = updateMemory(state, state.memories[0].id, { text: 'SENSITIVE_祖屋门牌' });
  const withdrawnId = state.memories[0].id;
  state = addQuestion(state, { fromId: state.participants[1].id, toId: state.participants[0].id, sourceIds: [withdrawnId], text: 'SENSITIVE_祖屋门牌是不是九号？' });
  state = answerQuestion(state, state.questions[0].id, { text: 'SENSITIVE_祖屋门牌是九号。' });
  const answerId = state.questions[0].answerMemoryId;
  state = addStory(state, { title: 'SENSITIVE_祖屋门牌的故事', memoryIds: [withdrawnId, state.memories[1].id, answerId], note: 'SENSITIVE_祖屋门牌注记', disagreement: 'SENSITIVE_祖屋门牌分歧' });
  const oldExport = exportMarkdown(state);
  const next = withdrawMemory(state, withdrawnId);
  assert.equal(next.questions.length, 0);
  assert.equal(next.memories.length, 1);
  assert.equal(next.stories.length, 1);
  assert.equal(next.stories[0].title, '待重新核对的故事');
  assert.equal(next.stories[0].note, '');
  assert.equal(next.stories[0].disagreement, '');
  assert.ok(!exportJSON(next).includes('SENSITIVE_'));
  assert.ok(!exportMarkdown(next).includes(withdrawnId));
  assert.ok(!exportMarkdown(next).includes(answerId));
  assert.ok(oldExport.includes('祖屋门牌'), '已生成旧文件不受本地撤回影响，Markdown语法字符会被转义');
  assert.ok(exportJSON(state).includes('SENSITIVE_'), '原输入不得原地修改');
});

test('撤回引用链递归清除回答，完全空的故事删除', () => {
  let state = fixture();
  const originalId = state.memories[0].id;
  state = addQuestion(state, { fromId: state.participants[0].id, toId: state.participants[1].id, sourceIds: [originalId], text: '第一问' });
  state = answerQuestion(state, state.questions.at(-1).id, { text: '第一段答案' });
  const firstAnswer = state.memories.at(-1).id;
  state = addQuestion(state, { fromId: state.participants[1].id, toId: state.participants[2].id, sourceIds: [firstAnswer], text: '根据第一段再问' });
  state = answerQuestion(state, state.questions.at(-1).id, { text: '第二段答案' });
  state = addStory(state, { title: '只能依赖这条链', memoryIds: [originalId, firstAnswer, state.memories.at(-1).id] });
  state = withdrawMemory(state, originalId);
  assert.equal(state.questions.length, 0);
  assert.equal(state.stories.length, 0);
  assert.equal(state.memories.length, 1);
});

test('编辑原话后保持公开归属但重置派生文字，改私密则移出故事', () => {
  let state = fixture();
  const memoryId = state.memories[0].id;
  state = addStory(state, { title: 'OLD_DERIVED_标题', memoryIds: state.memories.map(value => value.id), note: 'OLD_DERIVED_注记', disagreement: 'OLD_DERIVED_分歧' });
  state = addQuestion(state, { fromId: state.participants[1].id, toId: state.participants[0].id, sourceIds: [memoryId], text: 'OLD_DERIVED_问题' });
  state = updateMemory(state, memoryId, { text: '修订后的完整原话' });
  assert.ok(state.stories[0].memoryIds.includes(memoryId));
  assert.ok(!exportJSON(state).includes('OLD_DERIVED_'));
  state = updateMemory(state, memoryId, { visibility: 'private' });
  assert.ok(!state.stories[0].memoryIds.includes(memoryId));
  assert.ok(!exportMarkdown(state).includes('修订后的完整原话'));
});

test('修改回答原话会清除旧互问答案和派生文字', () => {
  let state = fixture();
  state = addQuestion(state, { fromId: state.participants[0].id, toId: state.participants[1].id, sourceIds: [], text: '请补充' });
  state = answerQuestion(state, state.questions[0].id, { text: 'OLD_ANSWER' });
  const answerId = state.questions[0].answerMemoryId;
  state = updateMemory(state, answerId, { text: '更正的答案' });
  assert.equal(state.questions.length, 0);
  assert.ok(!exportJSON(state).includes('OLD_ANSWER'));
  assert.equal(state.memories.find(value => value.id === answerId).text, '更正的答案');
});

test('定点撤回无来源的现场问题，原活动和原话保持不变', () => {
  let state = fixture();
  state = addQuestion(state, { fromId: state.participants[0].id, toId: state.participants[1].id, sourceIds: [], text: 'QUESTION_SECRET_手误问题' });
  const questionId = state.questions[0].id;
  const before = exportJSON(state);
  const next = removeQuestion(state, questionId);
  assert.equal(next.questions.length, 0);
  assert.deepEqual(next.memories, state.memories);
  assert.deepEqual(next.participants, state.participants);
  assert.ok(!exportJSON(next).includes('QUESTION_SECRET_'));
  assert.ok(!exportMarkdown(next).includes('QUESTION_SECRET_'));
  assert.equal(exportJSON(state), before, '不得修改原输入');
  assert.throws(() => removeQuestion(next, questionId), /互问不存在或已撤回/);
});

test('撤回已答问题递归清理回答及派生故事，保留原始来源原话', () => {
  let state = fixture();
  const sourceIds = state.memories.map(value => value.id);
  state = addQuestion(state, { fromId: state.participants[0].id, toId: state.participants[1].id, sourceIds, text: 'QUESTION_SECRET_原始问题' });
  const questionId = state.questions[0].id;
  state = answerQuestion(state, questionId, { text: 'QUESTION_SECRET_第一段回答' });
  const answerId = state.questions[0].answerMemoryId;
  state = addQuestion(state, { fromId: state.participants[1].id, toId: state.participants[2].id, sourceIds: [answerId], text: 'QUESTION_SECRET_派生问题' });
  state = answerQuestion(state, state.questions.at(-1).id, { text: 'QUESTION_SECRET_第二段回答' });
  const secondAnswerId = state.questions.at(-1).answerMemoryId;
  state = addStory(state, { title: 'QUESTION_SECRET_故事标题', memoryIds: [...sourceIds, answerId, secondAnswerId], note: 'QUESTION_SECRET_注记', disagreement: 'QUESTION_SECRET_分歧' });
  const before = exportJSON(state);
  const next = removeQuestion(state, questionId);
  assert.equal(next.questions.length, 0);
  assert.deepEqual(next.memories.map(value => value.id), sourceIds);
  assert.equal(next.stories[0].title, '待重新核对的故事');
  assert.deepEqual(next.stories[0].memoryIds, sourceIds);
  assert.equal(next.stories[0].note, '');
  assert.equal(next.stories[0].disagreement, '');
  assert.ok(!exportJSON(next).includes('QUESTION_SECRET_'));
  assert.equal(exportJSON(state), before, '不得修改原输入');
});

test('撤销参与同意会清除该人的原话与相关互问', () => {
  let state = fixture();
  state = addStory(state, { title: '旧共同故事', memoryIds: state.memories.map(value => value.id), note: '旧的整理' });
  state = addQuestion(state, { fromId: state.participants[0].id, toId: state.participants[1].id, sourceIds: [], text: '互问' });
  state = answerQuestion(state, state.questions[0].id, { text: '相关回答' });
  const next = updateParticipant(state, state.participants[0].id, { consent: false });
  assert.equal(next.participants[0].consent, false);
  assert.equal(next.questions.length, 0);
  assert.equal(next.memories.length, 1);
  assert.equal(next.stories[0].title, '待重新核对的故事');
});

test('坏备份、重复编号、断引用、不可信状态与超限均拒绝，原活动保持可恢复', () => {
  const state = fixture();
  const original = exportJSON(state);
  const invalid = [
    value => { value.version = 99; },
    value => { value.memories[0].participantId = 'missing'; },
    value => { value.memories[1].id = value.memories[0].id; },
    value => { value.participants[0].consent = 'true'; },
    value => { value.title = '超'.repeat(201); },
    value => { value.memories[0].visibility = 'everything'; },
    value => { value.date = '2026-02-30'; },
    value => { value.memories[0].text = '\u0000恶意控制字符'; },
    value => { value.stories.push({ id: 'bad-story', title: '缺失出处', memoryIds: ['missing'], note: '', disagreement: '' }); }
  ];
  assert.throws(() => importJSON('{oops'), /有效 JSON/);
  assert.throws(() => importJSON('x'.repeat(3000001)), /3 MB/);
  assert.throws(() => importJSON('汉'.repeat(1000001)), /3 MB/, '按 UTF-8 字节限制中文备份');
  for (const mutate of invalid) {
    const changed = JSON.parse(original);
    mutate(changed);
    assert.throws(() => importJSON(JSON.stringify(changed)), Error);
    assert.equal(exportJSON(state), original);
  }
  assert.deepEqual(importJSON(original), state);
});

test('导入校验不能通过伪造回答引用或私密源绕过留存范围', () => {
  let state = fixture();
  state = addQuestion(state, { fromId: state.participants[0].id, toId: state.participants[1].id, sourceIds: [state.memories[0].id], text: '问题' });
  state = answerQuestion(state, state.questions[0].id, { text: '回答' });
  for (const mutate of [
    value => { value.questions[0].answer = '伪造'; },
    value => { value.memories[0].visibility = 'private'; },
    value => { value.memories.at(-1).visibility = 'private'; },
    value => { value.questions[0].status = 'skipped'; },
    value => { value.questions[0].sourceIds.push(value.questions[0].answerMemoryId); }
  ]) {
    const changed = JSON.parse(exportJSON(state));
    mutate(changed);
    assert.throws(() => validateSession(changed));
  }
});

test('HTML、脚本链接与原型字段仅为输入文字，不执行、不污染', () => {
  let state = family(1);
  const hostile = '<script>globalThis.familyInjected = true</script> [点我](javascript:alert(1)) ![图](https://bad.invalid)';
  state = memory(state, 0, hostile);
  state = updateSession(state, { title: '<img src=x onerror=alert(1)>' });
  const json = JSON.parse(exportJSON(state));
  Object.defineProperty(json, '__proto__', { value: { polluted: true }, enumerable: true });
  const loaded = importJSON(JSON.stringify(json));
  const output = exportMarkdown(loaded);
  assert.equal(globalThis.familyInjected, undefined);
  assert.equal({}.polluted, undefined);
  assert.ok(!output.includes('<script>'));
  assert.ok(!output.includes('<img'));
  assert.ok(output.includes('&lt;script&gt;'));
  assert.ok(output.includes('\\[点我\\]\\(javascript:alert\\(1\\)\\)'));
  assert.equal(loaded.memories[0].text, hostile);
  assert.ok(!own(loaded, '__proto__'));
});

function own(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }
