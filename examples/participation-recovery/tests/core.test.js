import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../core.js';
import { project, prove, confirmed, readyProject } from './fixtures.js';

test('完整录入最终端演练与负责人/参加者最新双确认后，路径才就绪', () => {
  let state = project();
  assert.equal(core.evaluatePath(state, 'full').ready, false);
  assert.throws(() => core.confirmPath(state, 'full', '参加者'), /先补齐/);
  for (const kind of ['route', 'captions', 'materials']) state = prove(state, kind);
  assert.equal(core.evaluatePath(state, 'full').status, 'needs-confirmation');
  state = core.confirmPath(state, 'full', '负责人', 'owner');
  assert.equal(core.evaluatePath(state, 'full').ready, false);
  state = core.confirmPath(state, 'full', '参加者', 'participant');
  assert.equal(core.evaluatePath(state, 'full').ready, true);
  assert.equal(core.validateProject(state), true);
});

test('仅需路线的真实服务组合可以就绪；空路径及重复服务必须拒绝', () => {
  const state = confirmed(prove(project(), 'route'), 'route-only');
  assert.equal(core.evaluatePath(state, 'route-only').ready, true);
  assert.throws(() => core.addPath(state, { label: '空组合', sessionId: 'main', resourceIds: [] }), /至少选择/);
  assert.throws(() => core.addPath(state, { label: '重复', sessionId: 'main', resourceIds: ['route', 'route'] }), /不能重复/);
});

test('字幕必须实际可获取、已开启并可读，音频或供应方证据不能通过', () => {
  const state = project();
  assert.throws(() => prove(state, 'captions', { kind: 'audio-delivered' }), /最终端演练/);
  assert.throws(() => prove(state, 'captions', { checks: { available: true, enabled: true, readable: false } }), /音频不能替代/);
  assert.throws(() => prove(state, 'captions', { checks: undefined }), /分别记录/);
  const failed = prove(state, 'captions', { checks: { available: true, enabled: false, readable: false }, result: 'fail' });
  assert.equal(core.resourceStatus(failed, 'captions').status, 'failed');
});

test('缺检查人、观察、有效时间、资料交付时间以及未来检查均拒绝且原数据不改变', () => {
  const state = project(); const before = core.exportProject(state);
  for (const patch of [{ verifier: '' }, { notes: ' ' }, { checkedAt: '2026-02-30T09:00:00Z' }, { checkedAt: '2099-01-01T00:00:00Z' }, { result: 'unknown' }]) assert.throws(() => prove(state, 'route', patch));
  assert.throws(() => prove(state, 'materials', { deliveredAt: undefined }), /实际交付时间/);
  assert.throws(() => prove(state, 'materials', { deliveredAt: '2099-01-01T00:00:00Z' }), /不能晚于/);
  assert.equal(core.exportProject(state), before);
});

test('导入导出完整往返保留当前可用路径、证据、历史和双确认', () => {
  const state = readyProject(); const restored = core.importProject(core.exportProject(state));
  assert.deepEqual(restored, state);
  assert.equal(core.evaluatePath(restored, 'full').ready, true);
  restored.event.name = '另一个实例'; assert.notEqual(restored.event.name, state.event.name);
});

test('导入拒绝坏JSON、重复编号、悬空引用、伪造资源版本和确认', () => {
  const state = readyProject();
  assert.throws(() => core.importProject('{损坏'), /有效 JSON/);
  assert.throws(() => core.importProject({ ...state, schemaVersion: 2 }), /版本不支持/);
  const mutations = [
    value => value.resources.push(value.resources[0]),
    value => value.paths[0].resourceIds.push('missing'),
    value => value.resources[0].version = 99,
    value => value.resources[0].kind = 'audio',
    value => value.resources[0].versionHistory = [],
    value => value.evidence[0].version = 2,
    value => value.confirmations[0].signature = 'null',
    value => { const signature = JSON.parse(value.confirmations[0].signature); signature.resources[0][1] = 99; value.confirmations[0].signature = JSON.stringify(signature); },
    value => { const signature = JSON.parse(value.confirmations[0].signature); signature.resources[0][2] = 'invented'; value.confirmations[0].signature = JSON.stringify(signature); },
    value => value.confirmations[0].at = '2099-01-01T00:00:00Z'
  ];
  for (const mutate of mutations) { const invalid = JSON.parse(core.exportProject(state)); mutate(invalid); assert.throws(() => core.importProject(invalid)); }
  assert.equal(core.evaluatePath(state, 'full').ready, true);
});

test('中文完整交接、个人参加指引、负责人任务可以实际生成并转义用户HTML', () => {
  const state = readyProject(); state.event.name = '<img src=x onerror=alert(1)> & *活动*';
  const all = core.buildHandoff(state); const participant = core.buildParticipantHandoff(state, 'route-only'); const owner = core.buildOwnerHandoff(state, '构造负责人');
  assert.match(all, /负责人行动与最终端演练/); assert.match(all, /版本与变更记录/);
  assert.match(all, /&lt;img/); assert.doesNotMatch(all, /<img/); assert.match(all, /不代替实际服务履约/);
  assert.match(participant, /仅需路线/); assert.doesNotMatch(participant, /captions服务/);
  assert.match(owner, /任务交接/); assert.match(owner, /相关参加路径/);
  assert.throws(() => core.buildOwnerHandoff(state, '未分配人'), /尚未分配/);
});

test('导入拒绝早于所确认路径、场次或资源修订的确认时间', () => {
  for (const type of ['path', 'session', 'resource']) {
    let state = readyProject();
    if (type === 'path') state = core.editPath(state, 'full', { label: '已变更路径名称' }, '构造路径变更');
    else if (type === 'session') state = core.updateSession(state, 'main', { title: '已变更场次名称' }, '构造场次变更');
    else { state = core.updateResource(state, 'route', { owner: '接任负责人' }, '构造资源变更'); state = prove(state, 'route'); }
    state = confirmed(state);
    const invalid = JSON.parse(core.exportProject(state));
    const revision = type === 'path' ? invalid.paths.find(item => item.id === 'full').versionHistory.at(-1) : type === 'session' ? invalid.sessions[0].versionHistory.at(-1) : invalid.resources.find(item => item.id === 'route').versionHistory.at(-1);
    invalid.confirmations.at(-1).at = new Date(Date.parse(revision.changedAt) - 1).toISOString();
    assert.throws(() => core.importProject(invalid), type === 'path' ? /确认时间不能早于签名引用的参加路径变更/ : type === 'session' ? /确认时间不能早于签名引用的场次变更/ : /确认时间不能早于签名引用的资源变更/);
    assert.equal(core.evaluatePath(state, 'full').ready, true);
  }
});

test('导入拒绝路径和场次修订时间倒序，不能用自相矛盾历史恢复就绪', () => {
  for (const type of ['path', 'session']) {
    let state = readyProject();
    if (type === 'path') {
      state = core.editPath(state, 'full', { label: '第一次变更' }, '构造变更一');
      state = core.editPath(state, 'full', { label: '第二次变更' }, '构造变更二');
    } else {
      state = core.updateSession(state, 'main', { title: '第一次变更' }, '构造变更一');
      state = core.updateSession(state, 'main', { title: '第二次变更' }, '构造变更二');
    }
    const invalid = JSON.parse(core.exportProject(state));
    const history = type === 'path' ? invalid.paths.find(item => item.id === 'full').versionHistory : invalid.sessions[0].versionHistory;
    history[1].changedAt = '2000-01-02T00:00:00Z'; history[2].changedAt = '2000-01-01T00:00:00Z';
    assert.throws(() => core.importProject(invalid), /变更时间顺序无效/);
  }
});

test('演示只提供构造未核验活动，不把模拟观察误称完整就绪', () => {
  const state = core.demoProject();
  assert.match(state.event.name, /构造演练/); assert.equal(state.evidence.length, 0);
  assert.equal(core.evaluatePath(state, 'remote').ready, false);
  assert.match(core.buildHandoff(state), /存在缺口/);
});
