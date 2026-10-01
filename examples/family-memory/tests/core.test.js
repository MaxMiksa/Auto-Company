import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, updateSession, addParticipant, updateParticipant, addMemory, updateMemory, withdrawMemory, addQuestion, answerQuestion, addStory, updateStory, removeStory, validateSession, exportMarkdown, exportJSON, importJSON } from '../core.js';

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

test('完整合成活动：署名、互问补证、并列分歧与可追溯共同故事', () => {
  let state = fixture();
  state = updateSession(state, { title: '院门前的合影', date: '2026-10-01', place: '家中餐桌', prompt: '先各说一分钟，也可以跳过。' });
  state = addQuestion(state, { fromId: state.participants[2].id, toId: state.participants[0].id, sourceIds: [state.memories[0].id, state.memories[1].id], text: '照片里有没有能分辨季节的树叶？' });
  state = answerQuestion(state, state.questions[0].id, { text: '树上还挂着几片黄叶，但我也不确定。' });
  const answer = state.memories.at(-1);
  assert.equal(answer.participantId, state.participants[0].id);
  assert.equal(state.questions[0].answerMemoryId, answer.id);
  state = addStory(state, { title: '一次季节尚未确定的合影', memoryIds: state.memories.map(item => item.id), note: '三段原话由家人手动归组。', disagreement: '秋天与春天的说法仍并列，尚未确认。' });
  const output = exportMarkdown(state);
  for (const text of ['阿姨', '舅舅', '秋天', '春天', '仍并列', '树上还挂着几片黄叶', state.memories[0].id, state.questions[0].id, answer.id, '旧文件不会被自动撤销']) assert.ok(output.includes(text), text);
  assert.deepEqual(importJSON(exportJSON(state)), state);
});

test('写操作不修改输入，验证也返回独立规范副本', () => {
  const state = fixture();
  const before = JSON.stringify(state);
  const next = updateSession(state, { title: '新标题' });
  next.memories[0].text = '只改副本';
  const clone = validateSession(state);
  clone.participants[0].name = '副本名字';
  assert.equal(JSON.stringify(state), before);
});

test('自愿跳过与未回应分别留存，跳过不生成原话或虚假共识', () => {
  let state = fixture();
  state = addQuestion(state, { fromId: state.participants[0].id, toId: state.participants[1].id, sourceIds: [], text: '可以回忆一下吗？' });
  const count = state.memories.length;
  assert.ok(exportMarkdown(state).includes('待回应'));
  state = answerQuestion(state, state.questions[0].id, { skip: true });
  assert.equal(state.questions[0].status, 'skipped');
  assert.equal(state.memories.length, count);
  assert.equal(state.questions[0].answerMemoryId, null);
  assert.ok(exportMarkdown(state).includes('自愿跳过'));
  assert.throws(() => answerQuestion(state, state.questions[0].id, { text: '再回答' }), /已经/);
});

test('手动改故事成员时不能沿用旧派生文字，允许重新明确填写', () => {
  let state = fixture();
  state = addStory(state, { title: 'REMOVE_SECRET_标题', memoryIds: state.memories.map(value => value.id), note: 'REMOVE_SECRET_注记', disagreement: 'REMOVE_SECRET_分歧' });
  const story = state.stories[0];
  let next = updateStory(state, story.id, { title: story.title, memoryIds: [story.memoryIds[1]], note: story.note, disagreement: story.disagreement });
  assert.ok(!exportJSON(next).includes('REMOVE_SECRET_'));
  next = updateStory(state, story.id, { title: '重新核对的标题', memoryIds: [story.memoryIds[1]], note: '重新核对的注记', disagreement: '' });
  assert.equal(next.stories[0].title, '重新核对的标题');
  assert.equal(removeStory(next, story.id).stories.length, 0);
});


function own(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }
