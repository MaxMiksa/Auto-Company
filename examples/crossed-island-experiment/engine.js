(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IslandEngine = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STAGES = ['intro', 'createA', 'handoffB', 'createB', 'handoffA', 'actionA',
    'handoffActionB', 'actionB', 'reveal', 'decision', 'finished'];
  const AUTHOR_FIELDS = ['name', 'landmark', 'detail', 'reason', 'prediction', 'rule'];
  const LIMITS = Object.freeze({ name: 30, landmark: 60, detail: 600, reason: 600,
    prediction: 600, action: 600, reflection: 600, joint: 1000, backup: 65536 });
  const TOP_KEYS = ['version', 'stage', 'authors', 'actions', 'votes', 'joint',
    'reflections', 'paused', 'outcome', 'stoppedAt'];
  const RULES = { A: ['moon', 'sun'], B: ['low', 'high'] };
  const FIELD_LABELS = { name: '旅人名字', landmark: '地标名字', detail: '地标细节',
    reason: '虚构缘由', prediction: '行动预测', rule: '环境规则' };
  const RULE_LABELS = { moon: '月光照路', sun: '日光照路', low: '退潮开放', high: '涨潮开放' };
  const STAGE_LABELS = { intro: '开场', createA: '阿岚创作', handoffB: '交给雨生',
    createB: '雨生创作', handoffA: '交给阿岚', actionA: '阿岚进入对方世界',
    handoffActionB: '交给雨生回应', actionB: '雨生进入对方世界', reveal: '共同揭晓',
    decision: '共同取舍', finished: '完成' };

  function fail(message) { throw new Error(message); }
  function object(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
      fail(label + '必须是普通对象。');
    }
  }
  function keys(value, allowed, label, partial) {
    object(value, label);
    if (Object.keys(value).some(key => !allowed.includes(key)) ||
        (!partial && allowed.some(key => !Object.prototype.hasOwnProperty.call(value, key)))) {
      fail(label + '字段不完整或包含未知字段。');
    }
  }
  function string(value, max, label, required) {
    if (typeof value !== 'string') fail(label + '必须是文字。');
    if (value.length > max) fail(label + '最多 ' + max + ' 字。');
    if (required && !value.trim()) fail('请填写' + label + '。');
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail(label + '包含无效控制字符。');
    return value;
  }
  function roleCheck(role) { if (role !== 'A' && role !== 'B') fail('请选择有效角色。'); }
  function vote(value) {
    if (!['', 'road', 'objects'].includes(value)) fail('取舍只能是留路或留物。');
    return value;
  }
  function author(value, role, complete) {
    keys(value, AUTHOR_FIELDS, '角色创作');
    const result = {};
    AUTHOR_FIELDS.forEach(field => {
      result[field] = string(value[field], field === 'rule' ? 4 : LIMITS[field], FIELD_LABELS[field], complete);
    });
    if (result.rule && !RULES[role].includes(result.rule)) fail('环境规则与角色不符。');
    return result;
  }
  function emptyAuthor() {
    return { name: '', landmark: '', detail: '', reason: '', prediction: '', rule: '' };
  }
  function create() {
    return { version: 1, stage: 'intro', authors: { A: emptyAuthor(), B: emptyAuthor() },
      actions: { A: '', B: '' }, votes: { A: '', B: '' }, joint: '',
      reflections: { A: '', B: '' }, paused: false, outcome: null, stoppedAt: null };
  }
  function isEmptyAuthor(value) { return AUTHOR_FIELDS.every(field => value[field] === ''); }

  // Stage checks also apply to stopped sessions, using their last active stage.
  function progressCheck(state, stage) {
    const index = STAGES.indexOf(stage);
    if (index < 0 || stage === 'finished') fail('备份的原阶段无效。');
    if (index >= 2) author(state.authors.A, 'A', true);
    if (index < 1 && !isEmptyAuthor(state.authors.A)) fail('开场不能包含已创作内容。');
    if (index >= 4) author(state.authors.B, 'B', true);
    if (index < 3 && !isEmptyAuthor(state.authors.B)) fail('雨生创作早于交接。');
    if (index >= 6) string(state.actions.A, LIMITS.action, '阿岚的行动', true);
    if (index < 5 && state.actions.A !== '') fail('阿岚行动早于创作完成。');
    if (index >= 8) string(state.actions.B, LIMITS.action, '雨生的行动', true);
    if (index < 7 && state.actions.B !== '') fail('雨生行动早于交接。');
    if (index < 9 && (state.votes.A !== '' || state.votes.B !== '' || state.joint !== '' ||
        state.reflections.A !== '' || state.reflections.B !== '')) fail('共同取舍早于揭晓。');
  }
  function validate(input) {
    keys(input, TOP_KEYS, '备份');
    if (input.version !== 1) fail('不支持这个备份版本。');
    if (!STAGES.includes(input.stage)) fail('备份阶段无效。');
    if (typeof input.paused !== 'boolean') fail('暂停标记无效。');
    keys(input.authors, ['A', 'B'], '双方创作');
    keys(input.actions, ['A', 'B'], '双方行动');
    keys(input.votes, ['A', 'B'], '双方取舍');
    keys(input.reflections, ['A', 'B'], '双方反思');
    const state = { version: 1, stage: input.stage,
      authors: { A: author(input.authors.A, 'A', false), B: author(input.authors.B, 'B', false) },
      actions: { A: string(input.actions.A, LIMITS.action, '阿岚的行动'),
        B: string(input.actions.B, LIMITS.action, '雨生的行动') },
      votes: { A: vote(input.votes.A), B: vote(input.votes.B) },
      joint: string(input.joint, LIMITS.joint, '共同取舍句'),
      reflections: { A: string(input.reflections.A, LIMITS.reflection, '阿岚的反思'),
        B: string(input.reflections.B, LIMITS.reflection, '雨生的反思') },
      paused: input.paused, outcome: input.outcome, stoppedAt: input.stoppedAt };
    if (state.stage === 'finished') {
      if (state.paused) fail('已结束的体验不能处于暂停状态。');
      if (state.outcome === 'stop') {
        progressCheck(state, state.stoppedAt);
      } else if (state.outcome === 'road' || state.outcome === 'objects') {
        if (state.stoppedAt !== null) fail('共同结局不能带有停下阶段。');
        progressCheck(state, 'decision');
        if (state.votes.A !== state.outcome || state.votes.B !== state.outcome) fail('共同结局缺少双方同意。');
        string(state.joint, LIMITS.joint, '共同取舍句', true);
      } else fail('结束记录缺少有效结局。');
    } else {
      if (state.outcome !== null || state.stoppedAt !== null) fail('进行中的体验不能有结局。');
      progressCheck(state, state.stage);
    }
    return state;
  }
  function active(input, expected) {
    const state = validate(input);
    if (state.stage === 'finished') fail('这次体验已经结束。');
    if (state.paused) fail('请先继续体验。');
    if (expected && state.stage !== expected) fail('请按交接顺序完成当前步骤。');
    return state;
  }
  function advance(input) {
    const state = active(input);
    const next = { intro: 'createA', handoffB: 'createB', handoffA: 'actionA',
      handoffActionB: 'actionB', reveal: 'decision' }[state.stage];
    if (!next) fail('当前步骤需要填写并保存，不能跳过。');
    state.stage = next;
    return validate(state);
  }
  function saveAuthor(input, role, data) {
    roleCheck(role);
    const state = active(input, 'create' + role);
    state.authors[role] = author(data, role, true);
    state.stage = role === 'A' ? 'handoffB' : 'handoffA';
    return validate(state);
  }
  function saveAction(input, role, text) {
    roleCheck(role);
    const state = active(input, 'action' + role);
    state.actions[role] = string(text, LIMITS.action, '在对方世界里的打算', true);
    state.stage = role === 'A' ? 'handoffActionB' : 'reveal';
    return validate(state);
  }
  function saveDraft(input, patch) {
    const state = active(input);
    if (state.stage === 'createA' || state.stage === 'createB') {
      keys(patch, ['author'], '草稿');
      keys(patch.author, AUTHOR_FIELDS, '创作草稿', true);
      const role = state.stage.slice(-1);
      state.authors[role] = author(Object.assign({}, state.authors[role], patch.author), role, false);
    } else if (state.stage === 'actionA' || state.stage === 'actionB') {
      keys(patch, ['action'], '行动草稿');
      state.actions[state.stage.slice(-1)] = string(patch.action, LIMITS.action, '行动草稿');
    } else if (state.stage === 'decision') {
      keys(patch, ['votes', 'joint', 'reflections'], '取舍草稿', true);
      if (Object.prototype.hasOwnProperty.call(patch, 'votes')) {
        keys(patch.votes, ['A', 'B'], '取舍草稿', true);
        Object.keys(patch.votes).forEach(role => { state.votes[role] = vote(patch.votes[role]); });
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'joint')) state.joint = string(patch.joint, LIMITS.joint, '共同取舍句');
      if (Object.prototype.hasOwnProperty.call(patch, 'reflections')) {
        keys(patch.reflections, ['A', 'B'], '反思草稿', true);
        Object.keys(patch.reflections).forEach(role => {
          state.reflections[role] = string(patch.reflections[role], LIMITS.reflection, '反思');
        });
      }
    } else fail('当前步骤没有可编辑草稿。');
    return validate(state);
  }
  function resolve(input, voteA, voteB, joint, reflections) {
    const state = active(input, 'decision');
    state.votes = { A: vote(voteA), B: vote(voteB) };
    if (!voteA || !voteB) fail('请让双方各自选择留路或留物。');
    state.joint = string(joint === undefined ? '' : joint, LIMITS.joint, '共同取舍句');
    if (reflections !== undefined) {
      keys(reflections, ['A', 'B'], '反思');
      state.reflections = { A: string(reflections.A, LIMITS.reflection, '阿岚的反思'),
        B: string(reflections.B, LIMITS.reflection, '雨生的反思') };
    }
    if (voteA === voteB) {
      string(state.joint, LIMITS.joint, '共同取舍句', true);
      state.stage = 'finished';
      state.outcome = voteA;
    }
    return validate(state);
  }
  function stop(input) {
    const state = validate(input);
    if (state.stage === 'finished') fail('这次体验已经结束。');
    state.stoppedAt = state.stage;
    state.stage = 'finished';
    state.outcome = 'stop';
    state.paused = false;
    return validate(state);
  }
  function pause(input) {
    const state = active(input);
    state.paused = true;
    return state;
  }
  function resume(input) {
    const state = validate(input);
    if (state.stage === 'finished') fail('这次体验已经结束。');
    state.paused = false;
    return state;
  }
  function route(input) {
    const state = validate(input);
    const light = state.authors.A.rule;
    const tide = state.authors.B.rule;
    if (!light || !tide) return null;
    const a = tide === 'low' ? { action: '踏浅滩送灯塔', forbidden: '使用浮台' } :
      { action: '搭潮汐浮台送灯塔', forbidden: '走浅滩' };
    const b = light === 'moon' ? { action: '夜间递灯', forbidden: '晨间反光' } :
      { action: '晨间反光', forbidden: '夜间递灯' };
    return { A: Object.assign(a, { condition: RULE_LABELS[tide], response: state.actions.A }),
      B: Object.assign(b, { condition: RULE_LABELS[light], response: state.actions.B }),
      label: (light === 'moon' ? '夜间' : '晨光') + (tide === 'low' ? '浅滩路线' : '浮台路线') };
  }
  function importBackup(json) {
    if (typeof json !== 'string') fail('请选择 JSON 文字备份。');
    if (json.length > LIMITS.backup) fail('备份过大，最多 65536 字符。');
    let value;
    try { value = JSON.parse(json); } catch (error) { fail('备份不是有效 JSON，原进度未改变。'); }
    return validate(value);
  }
  function exportBackup(input) { return JSON.stringify(validate(input), null, 2); }
  // Dynamic code fences preserve literal prose, including HTML and Markdown punctuation.
  function literal(value) {
    if (!value) return '（未填写）';
    const runs = value.match(/`+/g) || [];
    const length = Math.max(3, ...runs.map(run => run.length + 1));
    const fence = '`'.repeat(length);
    return fence + '\n' + value + '\n' + fence;
  }
  function toMarkdown(input) {
    const state = validate(input);
    const lines = ['# 交错岛 · 双人创作记录', '',
      '这是一份虚构创作记录。自由句保留原文，不自动解读，也不评价关系。', '',
      '交接页只是遮盖，本机存档与备份均包含双方文字，不提供私密隔离。', '',
      '状态：' + (state.stage === 'finished' ? (state.outcome === 'stop' ? '停在这里 · 没有共同结局' : '共同结局已完成') :
        (state.paused ? '已暂停 · ' : '进行中 · ') + STAGE_LABELS[state.stage]), ''];
    ['A', 'B'].forEach(role => {
      const item = state.authors[role];
      lines.push('## ' + (role === 'A' ? '阿岚' : '雨生') + '的地图', '');
      [['旅人名字', item.name], ['地标名字', item.landmark], ['地标图的文字细节', item.detail],
        ['我希望留住它，因为', item.reason], ['我猜对方会', item.prediction]].forEach(pair => {
        lines.push('### ' + pair[0], '', literal(pair[1]), '');
      });
      lines.push('环境规则：' + (RULE_LABELS[item.rule] || '未选择'), '',
        '### 在你的世界里，我打算', '', literal(state.actions[role]), '');
    });
    const path = route(state);
    lines.push('## 环境与候选通路', '');
    if (path) {
      lines.push('候选路线：' + path.label + '。', '',
        '阿岚面对' + path.A.condition + '：' + path.A.action + '；不能' + path.A.forbidden + '。', '',
        '雨生面对' + path.B.condition + '：' + path.B.action + '；不能' + path.B.forbidden + '。', '');
    } else lines.push('环境规则尚未齐备，没有完整候选通路。', '');
    const choiceName = { '': '未选择', road: '留路', objects: '留物' };
    lines.push('## 共同取舍', '', '阿岚：' + choiceName[state.votes.A] + '；雨生：' + choiceName[state.votes.B] + '。', '');
    if (state.outcome === 'road') lines.push('**留路 · 花两枚筹码。** 灯塔拆成路灯，花园拆成路面或浮台材料。划掉两件原物外形，保留名字与缘由，画出共同航图；得到离岛路，失去原物。', '');
    else if (state.outcome === 'objects') lines.push('**留物 · 花两枚筹码。** 各用一枚修原物，圈起两幅地标图，划去候选通路；两件原物完整留下，没有离岛路。', '');
    else if (state.outcome === 'stop') lines.push('**停在这里 · 花零枚筹码。** 保留两张独立地图和已写原句，不画共同路线，没有共同结局。停下阶段：' + STAGE_LABELS[state.stoppedAt] + '。', '');
    else lines.push('尚未形成共同结局，不把候选路线或单方选择视为共同同意。', '');
    lines.push('### 共同取舍句' + (state.outcome === 'stop' ? '（若已写，仅为未完成草稿）' : ''), '', literal(state.joint), '',
      '## 预测与反思', '', '双方可以自行比较原先预测与实际行动。没有对错计分，反思可留空。', '',
      '### 阿岚 · 我原以为……但你让我看到……', '', literal(state.reflections.A), '',
      '### 雨生 · 我原以为……但你让我看到……', '', literal(state.reflections.B), '',
      '地标图请保留在各自纸上；本记录保存图的文字细节，不假定已经完成绘图。', '');
    return lines.join('\n');
  }

  return Object.freeze({ create, advance, saveAuthor, saveAction, saveDraft, resolve, stop,
    pause, resume, route, validate, importBackup, exportBackup, toMarkdown, LIMITS, STAGES: Object.freeze(STAGES) });
}));
