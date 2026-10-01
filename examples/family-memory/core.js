const LIMITS = { participants: 5, memories: 300, questions: 300, stories: 100, text: 6000, short: 200, backup: 3000000 };
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const fail = message => { throw new Error(message); };
const id = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}格式不正确`);
  return value;
}

function string(value, label, max = LIMITS.text, required = false) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) fail(`${label}应为不超过 ${max} 字的文字`);
  if (required && !value.trim()) fail(`${label}不能为空`);
  return value;
}

function identifier(value, label) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value)) fail(`${label}无效`);
  return value;
}

function list(value, label, max) {
  if (!Array.isArray(value) || value.length > max) fail(`${label}数量应不超过 ${max}`);
  return value;
}

function uniqueIds(items, label) {
  if (new Set(items.map(item => item.id)).size !== items.length) fail(`${label}编号重复`);
}

function references(value, label) {
  const result = list(value, label, LIMITS.memories).map(item => identifier(item, label));
  if (new Set(result).size !== result.length) fail(`${label}有重复编号`);
  return result;
}

export function createSession() {
  return { version: 1, id: id('session'), title: '一起把往事补完整', date: '', place: '', prompt: '一张旧照或一段往事', participants: [], memories: [], questions: [], stories: [] };
}

export function validateSession(input) {
  const source = object(input, '活动');
  if (source.version !== 1) fail('暂不支持这个备份版本');
  const state = {
    version: 1, id: identifier(source.id, '活动编号'),
    title: string(source.title, '活动标题', LIMITS.short, true),
    date: string(source.date, '日期', 10), place: string(source.place, '地点', LIMITS.short),
    prompt: string(source.prompt, '主持提示'),
    participants: list(source.participants, '参与者', LIMITS.participants).map(value => {
      const participant = object(value, '参与者');
      if (typeof participant.consent !== 'boolean') fail('请明确记录是否自愿参与');
      return { id: identifier(participant.id, '参与者编号'), name: string(participant.name, '称呼', 80, true), consent: participant.consent };
    }),
    memories: list(source.memories, '原话', LIMITS.memories).map(value => {
      const memory = object(value, '原话');
      if (!['public', 'private'].includes(memory.visibility)) fail('原话留存范围无效');
      return { id: identifier(memory.id, '原话编号'), participantId: identifier(memory.participantId, '讲述者编号'), text: string(memory.text, '原话', LIMITS.text, true), eventHint: string(memory.eventHint, '线索', LIMITS.short), visibility: memory.visibility };
    }),
    questions: list(source.questions, '互问', LIMITS.questions).map(value => {
      const question = object(value, '互问');
      if (!['open', 'answered', 'skipped'].includes(question.status)) fail('互问状态无效');
      return { id: identifier(question.id, '互问编号'), fromId: identifier(question.fromId, '提问者编号'), toId: identifier(question.toId, '回答者编号'), sourceIds: references(question.sourceIds, '互问原话'), text: string(question.text, '问题', LIMITS.text, true), status: question.status, answer: string(question.answer, '回答'), answerMemoryId: question.answerMemoryId === null ? null : identifier(question.answerMemoryId, '回答原话编号') };
    }),
    stories: list(source.stories, '故事', LIMITS.stories).map(value => {
      const story = object(value, '故事');
      return { id: identifier(story.id, '故事编号'), title: string(story.title, '故事标题', LIMITS.short, true), memoryIds: references(story.memoryIds, '故事原话'), note: string(story.note, '故事注记'), disagreement: string(story.disagreement, '不同说法') };
    })
  };
  if (state.date && !/^\d{4}-\d{2}-\d{2}$/.test(state.date)) fail('日期请使用 年-月-日 格式');
  if (state.date && (Number.isNaN(Date.parse(state.date)) || new Date(`${state.date}T00:00:00Z`).toISOString().slice(0, 10) !== state.date)) fail('日期不存在，请重新选择');
  for (const [collection, label] of [[state.participants, '参与者'], [state.memories, '原话'], [state.questions, '互问'], [state.stories, '故事']]) uniqueIds(collection, label);
  const participants = new Map(state.participants.map(item => [item.id, item]));
  const memories = new Map(state.memories.map(item => [item.id, item]));
  const willing = participantId => participants.get(participantId)?.consent === true;
  const publicMemory = memoryId => memories.get(memoryId)?.visibility === 'public';
  for (const memory of state.memories) if (!willing(memory.participantId)) fail('原话必须属于已自愿参与的亲属');
  for (const question of state.questions) {
    if (!willing(question.fromId) || !willing(question.toId)) fail('互问双方需要自愿参与');
    if (question.sourceIds.some(memoryId => !publicMemory(memoryId))) fail('互问引用的共同原话已缺失或为私密');
    if (question.status === 'answered') {
      const answer = memories.get(question.answerMemoryId);
      if (!answer || answer.participantId !== question.toId || answer.visibility !== 'public' || answer.text !== question.answer || question.sourceIds.includes(answer.id)) fail('回答与署名原话不一致');
    } else if (question.answer !== '' || question.answerMemoryId !== null) fail('未回答或跳过的问题不能保留回答');
  }
  const answers = state.questions.filter(question => question.answerMemoryId).map(question => question.answerMemoryId);
  if (new Set(answers).size !== answers.length) fail('一条回答原话不能属于多个互问');
  for (const story of state.stories) {
    if (!story.memoryIds.length || story.memoryIds.some(memoryId => !publicMemory(memoryId))) fail('故事需要至少一条仍可共同留存的原话');
  }
  if (new TextEncoder().encode(JSON.stringify(state, null, 2)).byteLength > LIMITS.backup) fail('完整活动备份超过 3 MB，请减少本次活动内容');
  return state;
}

function find(items, itemId, label) {
  const item = items.find(value => value.id === itemId);
  if (!item) fail(`${label}不存在或已撤回`);
  return item;
}

function patch(input, values, allowed) {
  object(values, '修改内容');
  for (const key of allowed) if (own(values, key)) input[key] = values[key];
}

export function updateSession(input, values) {
  const state = validateSession(input);
  patch(state, values, ['title', 'date', 'place', 'prompt']);
  return validateSession(state);
}

export function addParticipant(input, values) {
  const state = validateSession(input);
  state.participants.push({ id: id('person'), name: values.name, consent: values.consent });
  return validateSession(state);
}

// 删除来源后，连带删除由它产生的互问与回答，避免派生文字残留。
function invalidate(state, memoryIds) {
  const removed = new Set(memoryIds);
  let affected;
  do {
    affected = state.questions.filter(question => question.sourceIds.some(memoryId => removed.has(memoryId)) || removed.has(question.answerMemoryId));
    for (const question of affected) if (question.answerMemoryId) removed.add(question.answerMemoryId);
    state.questions = state.questions.filter(question => !affected.includes(question));
  } while (affected.length);
  state.memories = state.memories.filter(memory => !removed.has(memory.id));
  state.stories = state.stories.flatMap(story => {
    if (!story.memoryIds.some(memoryId => removed.has(memoryId))) return [story];
    const remaining = story.memoryIds.filter(memoryId => !removed.has(memoryId));
    return remaining.length ? [{ ...story, title: '待重新核对的故事', memoryIds: remaining, note: '', disagreement: '' }] : [];
  });
  return state;
}

export function updateParticipant(input, participantId, values) {
  const state = validateSession(input);
  const participant = find(state.participants, participantId, '参与者');
  patch(participant, values, ['name', 'consent']);
  if (participant.consent === false) {
    const questions = state.questions.filter(question => question.fromId === participantId || question.toId === participantId);
    invalidate(state, [...state.memories.filter(memory => memory.participantId === participantId).map(memory => memory.id), ...questions.map(question => question.answerMemoryId).filter(Boolean)]);
    state.questions = state.questions.filter(question => question.fromId !== participantId && question.toId !== participantId);
  }
  return validateSession(state);
}

export function addMemory(input, values) {
  const state = validateSession(input);
  state.memories.push({ id: id('memory'), participantId: values.participantId, text: values.text, eventHint: values.eventHint ?? '', visibility: values.visibility ?? 'public' });
  return validateSession(state);
}

export function updateMemory(input, memoryId, values) {
  const state = validateSession(input);
  const memory = find(state.memories, memoryId, '原话');
  const updated = { ...memory };
  patch(updated, values, ['text', 'eventHint', 'visibility']);
  if (['text', 'eventHint', 'visibility'].some(key => updated[key] !== memory[key])) {
    const position = state.memories.indexOf(memory);
    invalidate(state, [memoryId]);
    state.memories.splice(Math.min(position, state.memories.length), 0, updated);
    // 仍然公开的修订原话保留故事归属；标题和注记必须由人重新核对。
    if (updated.visibility === 'public') {
      state.stories = input.stories.flatMap(story => {
        if (!story.memoryIds.includes(memoryId)) return state.stories.filter(value => value.id === story.id);
        const remaining = story.memoryIds.filter(value => state.memories.some(entry => entry.id === value && entry.visibility === 'public'));
        return remaining.length ? [{ ...story, memoryIds: [...remaining], title: '待重新核对的故事', note: '', disagreement: '' }] : [];
      });
    }
  }
  return validateSession(state);
}

export function withdrawMemory(input, memoryId) {
  const state = validateSession(input);
  find(state.memories, memoryId, '原话');
  return validateSession(invalidate(state, [memoryId]));
}

export function addQuestion(input, values) {
  const state = validateSession(input);
  state.questions.push({ id: id('question'), fromId: values.fromId, toId: values.toId, sourceIds: values.sourceIds ?? [], text: values.text, status: 'open', answer: '', answerMemoryId: null });
  return validateSession(state);
}

export function answerQuestion(input, questionId, values) {
  const state = validateSession(input);
  const question = find(state.questions, questionId, '互问');
  if (question.status !== 'open') fail('这条互问已经回答或跳过，请另建问题');
  if (values.skip === true) {
    question.status = 'skipped';
  } else {
    const answer = { id: id('memory'), participantId: question.toId, text: values.text, eventHint: '互问补证', visibility: 'public' };
    state.memories.push(answer);
    question.status = 'answered';
    question.answer = answer.text;
    question.answerMemoryId = answer.id;
  }
  return validateSession(state);
}

export function removeQuestion(input, questionId) {
  const state = validateSession(input);
  const question = find(state.questions, questionId, '互问');
  state.questions = state.questions.filter(value => value.id !== questionId);
  if (question.answerMemoryId) invalidate(state, [question.answerMemoryId]);
  return validateSession(state);
}

export function addStory(input, values) {
  const state = validateSession(input);
  state.stories.push({ id: id('story'), title: values.title, memoryIds: values.memoryIds, note: values.note ?? '', disagreement: values.disagreement ?? '' });
  return validateSession(state);
}

export function updateStory(input, storyId, values) {
  const state = validateSession(input);
  const story = find(state.stories, storyId, '故事');
  patch(story, values, ['title', 'memoryIds', 'note', 'disagreement']);
  // 沿用旧文字不能视为重新核对，成员变化时清除这些派生内容。
  const original = find(input.stories, storyId, '故事');
  if (own(values, 'memoryIds') && Array.isArray(values.memoryIds) && (values.memoryIds.length !== original.memoryIds.length || values.memoryIds.some(memoryId => !original.memoryIds.includes(memoryId)))) {
    for (const key of ['title', 'note', 'disagreement']) if (!own(values, key) || values[key] === original[key]) story[key] = key === 'title' ? '待重新核对的故事' : '';
  }
  return validateSession(state);
}

export function removeStory(input, storyId) {
  const state = validateSession(input);
  find(state.stories, storyId, '故事');
  state.stories = state.stories.filter(story => story.id !== storyId);
  return state;
}

const markdown = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_{}\[\]()!#|]/g, '\\$&');
const singleLine = value => markdown(value).replace(/[\r\n]+/g, ' ');

export function exportMarkdown(input) {
  const state = validateSession(input);
  const participants = new Map(state.participants.map(participant => [participant.id, participant.name]));
  const memories = new Map(state.memories.filter(memory => memory.visibility === 'public').map(memory => [memory.id, memory]));
  const lines = [`# ${singleLine(state.title)}`, '', `日期：${singleLine(state.date || '未记录')}　地点：${singleLine(state.place || '未记录')}`, '', '每段原话保留署名和编号；不同记忆并列，不裁定历史真相。', ''];
  const appendMemory = memory => {
    lines.push(`**${singleLine(participants.get(memory.participantId))}** · 原话编号：${memory.id}`, ...markdown(memory.text).split(/\r?\n/).map(line => `> ${line}`));
    if (memory.eventHint) lines.push(`线索：${singleLine(memory.eventHint)}`);
    lines.push('');
  };
  const used = new Set();
  for (const story of state.stories) {
    lines.push(`## ${singleLine(story.title)}`, '', `故事编号：${story.id}`, '');
    for (const memoryId of story.memoryIds) { appendMemory(memories.get(memoryId)); used.add(memoryId); }
    if (story.note) lines.push(`整理注记：${markdown(story.note)}`, '');
    if (story.disagreement) lines.push(`不同说法（待共同核对）：${markdown(story.disagreement)}`, '');
  }
  const remaining = [...memories.values()].filter(memory => !used.has(memory.id));
  if (remaining.length) { lines.push('## 尚未归组的共同原话', ''); remaining.forEach(appendMemory); }
  if (state.questions.length) {
    lines.push('## 本次互问', '');
    for (const question of state.questions) {
      const status = { open: '待回应', answered: '已回应', skipped: '自愿跳过' }[question.status];
      lines.push(`### ${singleLine(participants.get(question.fromId))} 问 ${singleLine(participants.get(question.toId))}`, '', `问题编号：${question.id} · ${status}`, ...markdown(question.text).split(/\r?\n/).map(line => `> ${line}`), `出处原话：${question.sourceIds.join('、') || '现场新问题'}`);
      if (question.answerMemoryId) lines.push(`回答原话：${question.answerMemoryId}`);
      lines.push('');
    }
  }
  lines.push('## 留存与更正', '', '本页只含已自愿参与者允许共同留存的原话，私密片段不进入本页。', '撤回或更正后请重新导出。已下载或分享的旧文件不会被自动撤销，应由持有人自行删除或替换。', '');
  return lines.join('\n');
}

export function exportJSON(input) {
  return JSON.stringify(validateSession(input), null, 2);
}

export function importJSON(value) {
  if (typeof value !== 'string' || value.length > LIMITS.backup || new TextEncoder().encode(value).byteLength > LIMITS.backup) fail('备份文件应为不超过 3 MB 的 JSON 文字');
  let parsed;
  try { parsed = JSON.parse(value); } catch { fail('备份不是有效 JSON，当前活动未改变'); }
  return validateSession(parsed);
}
