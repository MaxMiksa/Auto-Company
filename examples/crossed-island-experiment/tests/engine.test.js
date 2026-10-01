'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const engine = require('../engine.js');

function author(role, rule) {
  return { name: role === 'A' ? '阿岚' : '雨生', landmark: role === 'A' ? '纸灯塔' : '玻璃花园',
    detail: role === 'A' ? '螺旋形纸窗，灯顶有一只蓝鸟。' : '透明的花瓣藏着潮汐刻度。',
    reason: '我希望留住它，因为它为岛上的鸟留了位置。',
    prediction: '我猜对方会先寻找一座桥。', rule };
}
function beforeDecision(light = 'moon', tide = 'low') {
  let state = engine.advance(engine.create());
  state = engine.saveAuthor(state, 'A', author('A', light));
  state = engine.advance(state);
  state = engine.saveAuthor(state, 'B', author('B', tide));
  state = engine.advance(state);
  state = engine.saveAction(state, 'A', '在浅水或浮台上，我为鸟留一个落脚处。');
  state = engine.advance(state);
  state = engine.saveAction(state, 'B', '我借灯塔的光，把花瓣照成航线。');
  return engine.advance(state);
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function freeze(value) {
  Object.freeze(value);
  Object.values(value).forEach(item => { if (item && typeof item === 'object') freeze(item); });
  return value;
}

test('相同源文件可在普通浏览器中提供 IslandEngine', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../engine.js'), 'utf8'), context);
  assert.equal(typeof context.IslandEngine.saveAuthor, 'function');
  assert.equal(context.IslandEngine.create().stage, 'intro');
});

for (const light of ['moon', 'sun']) {
  for (const tide of ['low', 'high']) {
    test(`${light}/${tide} 决定行动和禁止条件，自由句不改路线`, () => {
      const state = beforeDecision(light, tide);
      const route = engine.route(state);
      assert.equal(route.A.action, tide === 'low' ? '踏浅滩送灯塔' : '搭潮汐浮台送灯塔');
      assert.equal(route.A.forbidden, tide === 'low' ? '使用浮台' : '走浅滩');
      assert.equal(route.B.action, light === 'moon' ? '夜间递灯' : '晨间反光');
      assert.equal(route.B.forbidden, light === 'moon' ? '晨间反光' : '夜间递灯');
      assert.equal(route.A.response, state.actions.A);
      assert.equal(route.B.response, state.actions.B);
      const swapped = clone(state);
      [swapped.authors.A.reason, swapped.authors.B.reason] = ['留住桥梁。', '拆掉所有物件。'];
      swapped.authors.A.prediction = '自由句要求改成日光与涨潮。';
      assert.deepEqual(engine.route(swapped), route);
      assert.equal(route.label, (light === 'moon' ? '夜间' : '晨光') + (tide === 'low' ? '浅滩路线' : '浮台路线'));
    });
    for (const ending of ['road', 'objects', 'stop']) {
      test(`${light}/${tide} 可完成 ${ending} 并忠实导出`, () => {
        const state = beforeDecision(light, tide);
        const finished = ending === 'stop' ? engine.stop(state) :
          engine.resolve(state, ending, ending, '我们把两件原物的故事留在这张地图上。', { A: '我看到另一种路。', B: '' });
        assert.equal(finished.stage, 'finished');
        assert.equal(finished.outcome, ending);
        assert.deepEqual(engine.importBackup(engine.exportBackup(finished)), finished);
        const markdown = engine.toMarkdown(finished);
        assert.ok(markdown.includes(state.authors.A.detail));
        assert.ok(markdown.includes(state.authors.B.reason));
        assert.ok(markdown.includes(state.authors.A.prediction));
        assert.ok(markdown.includes(state.actions.A));
        assert.ok(markdown.includes(engine.route(state).label));
        if (ending === 'road') {
          assert.match(markdown, /花两枚筹码/);
          assert.match(markdown, /灯塔拆成路灯/);
          assert.match(markdown, /失去原物/);
        } else if (ending === 'objects') {
          assert.match(markdown, /各用一枚修原物/);
          assert.match(markdown, /没有离岛路/);
        } else {
          assert.match(markdown, /花零枚筹码/);
          assert.match(markdown, /没有共同结局/);
          assert.match(markdown, /不画共同路线/);
        }
      });
    }
  }
}

test('角色轮流创作和行动；交接不能跳过或代替填写', () => {
  const intro = engine.create();
  assert.equal(engine.route(intro), null);
  assert.throws(() => engine.saveAuthor(intro, 'A', author('A', 'moon')), /交接顺序/);
  const first = engine.advance(intro);
  assert.throws(() => engine.advance(first), /填写并保存/);
  assert.throws(() => engine.saveAuthor(first, 'B', author('B', 'low')), /交接顺序/);
  assert.throws(() => engine.saveAction(first, 'A', '先出发'), /交接顺序/);
  const handoff = engine.saveAuthor(first, 'A', author('A', 'moon'));
  assert.equal(handoff.stage, 'handoffB');
  assert.throws(() => engine.saveAuthor(handoff, 'B', author('B', 'low')), /交接顺序/);
  const second = engine.advance(handoff);
  assert.equal(second.stage, 'createB');
  const nextHandoff = engine.saveAuthor(second, 'B', author('B', 'high'));
  const action = engine.advance(nextHandoff);
  assert.equal(action.stage, 'actionA');
  assert.throws(() => engine.saveAction(action, 'B', '递灯'), /交接顺序/);
  const actionHandoff = engine.saveAction(action, 'A', '我在浮台上种花');
  assert.equal(actionHandoff.stage, 'handoffActionB');
  assert.throws(() => engine.saveAction(actionHandoff, 'B', '递灯'), /交接顺序/);
  const reveal = engine.saveAction(engine.advance(actionHandoff), 'B', '我在夜间递灯');
  assert.equal(reveal.stage, 'reveal');
  assert.throws(() => engine.resolve(reveal, 'road', 'road', '共同句'), /交接顺序/);
  assert.equal(engine.advance(reveal).stage, 'decision');
});

test('双方票不同不完成、不消费筹码、原进度不被改写', () => {
  const original = freeze(beforeDecision());
  const changed = engine.resolve(original, 'road', 'objects', '', { A: '', B: '' });
  assert.equal(changed.stage, 'decision');
  assert.equal(changed.outcome, null);
  assert.deepEqual(changed.votes, { A: 'road', B: 'objects' });
  assert.deepEqual(original.votes, { A: '', B: '' });
  assert.match(engine.toMarkdown(changed), /尚未形成共同结局/);
  const finished = engine.resolve(changed, 'objects', 'objects', '我们留下原物，愿意放弃离岛路。');
  assert.equal(finished.outcome, 'objects');
  assert.throws(() => engine.resolve(original, 'road', '', ''), /双方各自/);
  assert.throws(() => engine.resolve(original, 'road', 'road', '   '), /共同取舍句/);
  assert.throws(() => engine.resolve(original, 'stop', 'stop', ''), /留路或留物/);
});

test('创作和行动拒绝空白、错误规则、超长和错误类型；原文不裁剪', () => {
  const state = engine.advance(engine.create());
  for (const field of ['name', 'landmark', 'detail', 'reason', 'prediction']) {
    assert.throws(() => engine.saveAuthor(state, 'A', { ...author('A', 'moon'), [field]: ' \n\t ' }), /填写/);
    assert.throws(() => engine.saveAuthor(state, 'A', { ...author('A', 'moon'), [field]: '字'.repeat(engine.LIMITS[field] + 1) }), /最多/);
  }
  assert.throws(() => engine.saveAuthor(state, 'A', author('A', 'low')), /角色不符/);
  assert.throws(() => engine.saveAuthor(state, 'A', { ...author('A', 'moon'), detail: 2 }), /文字/);
  assert.throws(() => engine.saveAuthor(state, 'A', { ...author('A', 'moon'), name: '坏\u0000字' }), /控制字符/);
  const text = '  我有自己的空格。\n第二行。  ';
  const saved = engine.saveAuthor(state, 'A', { ...author('A', 'moon'), reason: text });
  assert.equal(saved.authors.A.reason, text);
  let actionState = engine.advance(engine.saveAuthor(engine.advance(saved), 'B', author('B', 'low')));
  assert.throws(() => engine.saveAction(actionState, 'A', '\n\t'), /填写/);
  assert.throws(() => engine.saveAction(actionState, 'A', '字'.repeat(601)), /最多/);
});

test('草稿保留中途输入，停下不伪造共同结局', () => {
  let state = engine.advance(engine.create());
  state = engine.saveDraft(state, { author: { name: '小岚', detail: '画了一半的灯塔' } });
  assert.equal(state.authors.A.landmark, '');
  assert.deepEqual(engine.importBackup(engine.exportBackup(state)), state);
  const stopped = engine.stop(state);
  assert.equal(stopped.stoppedAt, 'createA');
  assert.equal(stopped.authors.A.detail, '画了一半的灯塔');
  assert.equal(stopped.authors.B.name, '');
  assert.match(engine.toMarkdown(stopped), /没有完整候选通路/);
  assert.match(engine.toMarkdown(stopped), /花零枚筹码/);
  assert.deepEqual(engine.importBackup(engine.exportBackup(stopped)), stopped);
  assert.throws(() => engine.saveDraft(state, { author: { unexpected: 'x' } }), /未知字段/);
  assert.throws(() => engine.saveDraft(state, { action: '提前写行动' }), /字段/);
});

test('每个合法中途阶段都可停下，包括暂停中的阶段', () => {
  let state = engine.create();
  const sessions = [state];
  state = engine.advance(state); sessions.push(state);
  state = engine.saveAuthor(state, 'A', author('A', 'moon')); sessions.push(state);
  state = engine.advance(state); sessions.push(state);
  state = engine.saveAuthor(state, 'B', author('B', 'low')); sessions.push(state);
  state = engine.advance(state); sessions.push(state);
  state = engine.saveDraft(state, { action: '未提交的浅滩行动' }); sessions.push(state);
  state = engine.saveAction(state, 'A', '踏浅滩'); sessions.push(state);
  state = engine.advance(state); sessions.push(state);
  state = engine.saveAction(state, 'B', '夜间递灯'); sessions.push(state);
  state = engine.advance(state); sessions.push(state);
  state = engine.saveDraft(state, { votes: { A: 'road', B: 'objects' }, joint: '还在讨论', reflections: { B: '可以停下' } }); sessions.push(state);
  sessions.forEach(input => {
    const stopped = engine.stop(engine.pause(input));
    assert.equal(stopped.paused, false);
    assert.equal(stopped.stoppedAt, input.stage);
    assert.deepEqual(stopped.authors, input.authors);
    assert.deepEqual(stopped.actions, input.actions);
    assert.deepEqual(engine.importBackup(engine.exportBackup(stopped)), stopped);
  });
});

test('暂停阻止写入，继续恢复原步骤，完成后不可继续', () => {
  const original = freeze(engine.advance(engine.create()));
  const paused = engine.pause(original);
  assert.equal(paused.paused, true);
  assert.equal(original.paused, false);
  assert.throws(() => engine.saveAuthor(paused, 'A', author('A', 'sun')), /先继续/);
  assert.throws(() => engine.saveDraft(paused, { author: { name: '改名' } }), /先继续/);
  assert.deepEqual(engine.resume(paused), original);
  const finished = engine.stop(paused);
  assert.throws(() => engine.advance(finished), /已经结束/);
  assert.throws(() => engine.resume(finished), /已经结束/);
  assert.throws(() => engine.stop(finished), /已经结束/);
});

test('备份拒绝损坏、未知版本、超长、未知字段、超前行动与伪造结局', () => {
  const current = freeze(beforeDecision());
  const variants = [];
  const version = clone(current); version.version = 2; variants.push(version);
  const stage = clone(current); stage.stage = 'elsewhere'; variants.push(stage);
  const name = clone(current); name.authors.A.name = '字'.repeat(31); variants.push(name);
  const type = clone(current); type.actions.B = {}; variants.push(type);
  const extra = clone(current); extra.remote = 'https://example.invalid'; variants.push(extra);
  const early = engine.create(); early.actions.A = '提前行动'; variants.push(early);
  const skipped = engine.create(); skipped.stage = 'reveal'; variants.push(skipped);
  const forged = clone(current); forged.stage = 'finished'; forged.outcome = 'road'; variants.push(forged);
  const oneVote = engine.resolve(current, 'road', 'road', '留路。'); oneVote.votes.B = 'objects'; variants.push(oneVote);
  const forgedStop = engine.stop(engine.create()); forgedStop.stoppedAt = 'decision'; variants.push(forgedStop);
  const pausedEnd = engine.stop(current); pausedEnd.paused = true; variants.push(pausedEnd);
  variants.forEach(input => assert.throws(() => engine.importBackup(JSON.stringify(input))));
  assert.throws(() => engine.importBackup('{bad JSON'), /有效 JSON/);
  assert.throws(() => engine.importBackup(' '.repeat(engine.LIMITS.backup + 1)), /过大/);
  assert.throws(() => engine.importBackup('null'), /普通对象/);
  assert.throws(() => engine.importBackup('[]'), /普通对象/);
  assert.throws(() => engine.importBackup(JSON.stringify({ ...engine.create(), __proto__: null, extra: 'x' })), /未知字段/);
  assert.equal(current.stage, 'decision');
  assert.equal(current.authors.A.name, '阿岚');
  assert.deepEqual(current.votes, { A: '', B: '' });
});

test('脚本、Markdown、围栏都按原文保存，导出不把它们变成 HTML', () => {
  const payload = '<img src=x onerror="alert(1)">\n<script>throw new Error("x")</script>\n```\n# 自己写的标题\n````';
  let state = engine.advance(engine.create());
  state = engine.saveAuthor(state, 'A', { ...author('A', 'moon'), detail: payload });
  state = engine.advance(state);
  state = engine.saveAuthor(state, 'B', author('B', 'high'));
  state = engine.saveAction(engine.advance(state), 'A', payload);
  state = engine.saveAction(engine.advance(state), 'B', '递灯');
  state = engine.resolve(engine.advance(state), 'road', 'road', payload, { A: payload, B: '' });
  assert.equal(engine.importBackup(engine.exportBackup(state)).authors.A.detail, payload);
  const markdown = engine.toMarkdown(state);
  assert.ok(markdown.includes('`````\n' + payload + '\n`````'));
  assert.ok(markdown.includes(payload));
  assert.equal(state.actions.A, payload);
});

test('验证返回独立副本，纯函数不会修改冻住的输入', () => {
  const original = freeze(engine.advance(engine.create()));
  const checked = engine.validate(original);
  checked.authors.A.name = '修改副本';
  assert.equal(original.authors.A.name, '');
  const drafted = engine.saveDraft(original, { author: { name: '草稿名字' } });
  assert.equal(drafted.authors.A.name, '草稿名字');
  assert.equal(original.authors.A.name, '');
  const saved = engine.saveAuthor(original, 'A', freeze(author('A', 'moon')));
  assert.equal(saved.stage, 'handoffB');
  assert.equal(original.stage, 'createA');
});
