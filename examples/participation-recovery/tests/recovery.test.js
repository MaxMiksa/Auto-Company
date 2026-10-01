import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../core.js';
import { project, prove, confirmed, readyProject } from './fixtures.js';

test('等价日期表示和未变字段不能误升资源或时段版本，也不能撤销已就绪路径', () => {
  const state = readyProject();
  const before = core.exportProject(state);
  const materials = state.resources.find(item => item.id === 'materials');
  assert.throws(() => core.updateResource(state, 'materials', {
    title: materials.title, owner: materials.owner, location: materials.location,
    deadline: new Date(materials.deadline).toISOString(),
  }, '构造误点击，实际字段均不变'), /没有实际变化/);
  const session = state.sessions.find(item => item.id === 'main');
  assert.throws(() => core.updateSession(state, 'main', {
    title: session.title, startsAt: new Date(session.startsAt).toISOString(),
  }, '构造误点击，时刻没有变化'), /没有实际变化/);
  assert.equal(core.exportProject(state), before);
  assert.equal(core.evaluatePath(state, 'full').ready, true);
  assert.equal(core.evaluatePath(state, 'route-only').ready, true);
});

for (const resourceId of ['materials', 'captions']) {
  test(`${resourceId}同地址实际内容更新精确撤销旧就绪，历史保留且重演练后仍须双确认`, () => {
    const original = readyProject();
    const oldResource = original.resources.find(item => item.id === resourceId);
    const oldPath = core.evaluatePath(original, 'full');
    const originalBackup = core.exportProject(original);
    const reason = '构造同地址内容已实际替换，须以新版重做最终端演练';
    let state = core.updateResource(original, resourceId, {
      title: oldResource.title, owner: oldResource.owner, location: oldResource.location,
      deadline: oldResource.deadline ? new Date(oldResource.deadline).toISOString() : '',
    }, reason, { contentUpdated: true });
    const updated = state.resources.find(item => item.id === resourceId);
    assert.equal(updated.version, 2);
    for (const key of ['title', 'owner', 'location']) assert.equal(updated[key], oldResource[key]);
    assert.equal(updated.versionHistory[1].contentUpdated, true);
    assert.deepEqual(updated.versionHistory[0], oldResource.versionHistory[0]);
    assert.deepEqual(state.evidence, original.evidence);
    assert.deepEqual(state.confirmations, original.confirmations);
    assert.equal(core.exportProject(original), originalBackup);
    assert.equal(core.evaluatePath(state, 'full').status, 'needs-evidence');
    assert.deepEqual(core.evaluatePath(state, 'full').confirmations, { owner: false, participant: false });
    assert.notEqual(core.evaluatePath(state, 'full').signature, oldPath.signature);
    assert.equal(core.evaluatePath(state, 'route-only').ready, true);
    assert.throws(() => core.confirmPath(state, 'full', '构造负责人', 'owner'), /先补齐/);
    assert.throws(() => prove(state, resourceId, { version: 1 }), /当前资源版本/);
    if (resourceId === 'materials') {
      assert.throws(() => prove(state, resourceId, {
        deliveredAt: new Date(Date.parse(updated.changedAt) - 1000).toISOString(),
      }), /内容变更前/);
    }
    state = core.importProject(core.exportProject(state));
    assert.equal(core.evaluatePath(state, 'full').ready, false);
    assert.equal(core.evaluatePath(state, 'route-only').ready, true);
    assert.deepEqual(state.evidence, original.evidence);
    assert.deepEqual(state.confirmations, original.confirmations);
    const blockedHandoff = core.buildHandoff(state);
    assert.match(blockedHandoff, /存在缺口，请勿宣称完整就绪/);
    assert.match(blockedHandoff, /内容\/服务已更新/);
    assert.match(blockedHandoff, /版本 1/);
    assert.match(blockedHandoff, /版本 2/);
    assert.ok(blockedHandoff.includes(reason));
    state = prove(state, resourceId);
    assert.equal(core.evaluatePath(state, 'full').status, 'needs-confirmation');
    state = core.confirmPath(state, 'full', '构造新版负责人', 'owner');
    assert.deepEqual(core.evaluatePath(state, 'full').confirmations, { owner: true, participant: false });
    assert.equal(core.evaluatePath(state, 'full').ready, false);
    state = core.confirmPath(state, 'full', '构造新版参加者', 'participant');
    assert.equal(core.evaluatePath(state, 'full').ready, true);
    assert.equal(core.evaluatePath(state, 'route-only').ready, true);
    const restored = core.importProject(core.exportProject(state));
    assert.deepEqual(restored, state);
    assert.equal(core.evaluatePath(restored, 'full').ready, true);
    assert.equal(restored.evidence.length, original.evidence.length + 1);
    assert.equal(restored.confirmations.length, original.confirmations.length + 2);
    assert.equal(restored.resources.find(item => item.id === resourceId).versionHistory.length, 2);
    assert.match(core.buildHandoff(restored), /内容\/服务已更新/);
    assert.match(core.buildParticipantHandoff(restored, 'full'), /负责人已确认；参加者已确认/);
  });
}

test('内容更新必须有原因及有效显式选项；未更新、非法参数与非法备份不改变原档案', () => {
  const state = readyProject();
  const before = core.exportProject(state);
  assert.equal(core.evaluatePath(core.importProject(before), 'full').ready, true);
  assert.throws(() => core.updateResource(state, 'materials', {}, '', { contentUpdated: true }), /变更原因/);
  assert.throws(() => core.updateResource(state, 'materials', {}, '只有说明，实际没变化'), /没有实际变化/);
  assert.throws(() => core.updateResource(state, 'materials', {}, '明确没有内容更新', { contentUpdated: false }), /没有实际变化/);
  for (const options of [null, [], 'true', { contentUpdated: 'true' }, { contentUpdated: 1 }, { unrelated: true }]) {
    assert.throws(() => core.updateResource(state, 'materials', {}, '构造非法选项', options), /内容更新选项/);
  }
  const updated = core.updateResource(state, 'materials', {}, '构造内容实际更新', { contentUpdated: true });
  const malformed = JSON.parse(core.exportProject(updated));
  malformed.resources.find(item => item.id === 'materials').versionHistory[1].contentUpdated = 'true';
  assert.throws(() => core.importProject(malformed), /内容更新标记/);
  assert.equal(core.exportProject(state), before);
  assert.equal(core.evaluatePath(state, 'full').ready, true);
});

test('提前截止后同地址替换资料也不可借用旧交付或清除迟交标记恢复准备机会', () => {
  let state = core.createEmptyProject();
  state = core.addSession(state, { id: 'main', title: '构造历史提前期限', startsAt: '2099-06-18T09:00:00Z' });
  state = core.addResource(state, { id: 'materials', sessionId: 'main', kind: 'materials', title: '同地址提前资料', owner: '构造负责人', location: 'https://example.invalid/unchanged-materials', deadline: '2000-01-01T09:00:00Z' });
  state = core.addPath(state, { id: 'full', label: '同地址提前阅读路径', sessionId: 'main', resourceIds: ['materials'] });
  state = confirmed(prove(state, 'materials', { checkedAt: '1999-12-31T10:00:00Z', deliveredAt: '1999-12-31T09:00:00Z' }));
  assert.equal(core.evaluatePath(state, 'full').ready, true);
  state = core.updateResource(state, 'materials', {}, '构造截止后在相同地址替换全文', { contentUpdated: true });
  assert.equal(state.resources[0].location, 'https://example.invalid/unchanged-materials');
  assert.equal(core.resourceStatus(state, 'materials').status, 'late');
  assert.throws(() => prove(state, 'materials', { deliveredAt: '1999-12-31T09:00:00Z' }), /内容变更前/);
  state = prove(state, 'materials');
  assert.equal(core.resourceStatus(state, 'materials').status, 'late');
  assert.throws(() => core.confirmPath(state, 'full', '构造参加者'), /迟交/);
  const tampered = JSON.parse(core.exportProject(state));
  tampered.resources[0].missedDeadline = false;
  assert.equal(core.resourceStatus(core.importProject(tampered), 'materials').status, 'late');
  assert.equal(state.evidence.length, 2);
  assert.equal(state.confirmations.length, 2);
  assert.match(core.buildHandoff(state), /补交只能缓解/);
});

test('字幕服务变化仅撤销关联路径，证据与双确认恢复齐备后重新就绪', () => {
  const original = readyProject();
  let state = core.updateResource(original, 'captions', { location: '新版字幕开启位置' }, '播放器调整');
  assert.equal(original.resources.find(item => item.id === 'captions').version, 1);
  assert.equal(state.resources.find(item => item.id === 'captions').version, 2);
  assert.equal(core.evaluatePath(state, 'full').ready, false);
  assert.equal(core.evaluatePath(state, 'route-only').ready, true);
  assert.throws(() => core.confirmPath(state, 'full', '参加者'), /先补齐/);
  state = prove(state, 'captions');
  assert.equal(core.evaluatePath(state, 'full').status, 'needs-confirmation');
  state = confirmed(state); assert.equal(core.evaluatePath(state, 'full').ready, true);
  assert.equal(state.resources.find(item => item.id === 'captions').versionHistory.length, 2);
  assert.equal(core.importProject(core.exportProject(state)).resources[1].version, 2);
});

test('同版本新失败及新通过观察均失效旧确认，不能让旧双确认自动复活', () => {
  let state = readyProject();
  state = prove(state, 'route', { result: 'fail', notes: '构造观察：入口无法到达' });
  assert.equal(core.evaluatePath(state, 'full').status, 'blocked');
  state = prove(state, 'route', { notes: '构造复核：修复后可到达，需重新确认' });
  assert.equal(core.evaluatePath(state, 'full').status, 'needs-confirmation');
  assert.equal(core.evaluatePath(state, 'route-only').ready, false);
  state = confirmed(state); assert.equal(core.evaluatePath(state, 'full').ready, true);
  assert.equal(core.evaluatePath(state, 'route-only').ready, false);
});

test('首次资料迟交不可通过改期限、补交、清除标记或重新确认误恢复', () => {
  let state = project();
  state = core.updateResource(state, 'materials', { deadline: '2000-01-01T09:00:00Z' }, '构造原提前期限');
  state = prove(state, 'materials', { deliveredAt: new Date().toISOString() });
  assert.equal(core.resourceStatus(state, 'materials').status, 'late');
  state = core.updateResource(state, 'materials', { deadline: '2099-06-17T09:00:00+08:00' }, '事后调整不能恢复');
  state = prove(state, 'materials');
  assert.equal(core.resourceStatus(state, 'materials').status, 'late');
  assert.throws(() => core.confirmPath(state, 'full', '参加者'), /迟交/);
  const tampered = JSON.parse(core.exportProject(state)); tampered.resources.find(item => item.id === 'materials').missedDeadline = false;
  assert.equal(core.resourceStatus(core.importProject(tampered), 'materials').status, 'late');
  assert.match(core.buildHandoff(state), /补交只能缓解/);
});

test('期限后更换已提前交付资料仍保留准备机会损失，新版不能借用旧交付时间', () => {
  let state = core.createEmptyProject();
  state = core.addSession(state, { id: 'main', title: '构造历史提前期限', startsAt: '2099-06-18T09:00:00Z' });
  state = core.addResource(state, { id: 'materials', sessionId: 'main', kind: 'materials', title: '提前资料', owner: '构造负责人', location: '原版资料', deadline: '2000-01-01T09:00:00Z' });
  state = core.addPath(state, { id: 'full', label: '提前阅读路径', sessionId: 'main', resourceIds: ['materials'] });
  state = prove(state, 'materials', { checkedAt: '1999-12-31T10:00:00Z', deliveredAt: '1999-12-31T09:00:00Z' });
  state = confirmed(state);
  assert.equal(core.evaluatePath(state, 'full').ready, true);
  state = core.updateResource(state, 'materials', { location: '新版资料' }, '期限后资料变更');
  assert.equal(core.resourceStatus(state, 'materials').status, 'late');
  // 新版本产生于当前时刻，不能使用旧历史交付来冒充新版曾提前送达。
  assert.throws(() => prove(state, 'materials', { deliveredAt: '1999-12-31T09:00:00Z' }), /变更前/);
  const imported = JSON.parse(core.exportProject(state)); imported.resources.find(item => item.id === 'materials').missedDeadline = false;
  assert.equal(core.resourceStatus(core.importProject(imported), 'materials').status, 'late');
});

test('及时交付资料仅改负责人或名称不会误报迟交，但必须重演练和重新双确认', () => {
  let state = core.createEmptyProject();
  state = core.addSession(state, { id: 'main', title: '构造历史活动', startsAt: '2099-06-18T09:00:00Z' });
  state = core.addResource(state, { id: 'materials', sessionId: 'main', kind: 'materials', title: '原资料名称', owner: '原负责人', location: '原版资料', deadline: '2000-01-01T09:00:00Z' });
  state = core.addPath(state, { id: 'full', label: '提前阅读', sessionId: 'main', resourceIds: ['materials'] });
  state = prove(state, 'materials', { checkedAt: '1999-12-31T10:00:00Z', deliveredAt: '1999-12-31T09:00:00Z' });
  state = confirmed(state);
  for (const patch of [{ owner: '接任负责人' }, { title: '更正资料名称' }]) {
    state = core.updateResource(state, 'materials', patch, '资料内容和实际入口不变');
    assert.equal(core.resourceStatus(state, 'materials').status, 'needs-evidence');
    assert.equal(state.resources[0].missedDeadline, false);
    assert.equal(core.evaluatePath(state, 'full').ready, false);
    state = prove(state, 'materials', { deliveredAt: '1999-12-31T09:00:00Z' });
    assert.equal(core.resourceStatus(state, 'materials').status, 'ready');
    assert.equal(core.evaluatePath(state, 'full').status, 'needs-confirmation');
    state = confirmed(state);
    assert.equal(core.evaluatePath(state, 'full').ready, true);
    assert.equal(core.evaluatePath(core.importProject(core.exportProject(state)), 'full').ready, true);
  }
  assert.equal(state.resources[0].versionHistory.length, 3);
  assert.equal(state.evidence.length, 3);
  state = core.updateResource(state, 'materials', { location: '期限后实质换版' }, '更换实际资料入口');
  assert.equal(core.resourceStatus(state, 'materials').status, 'late');
  assert.throws(() => prove(state, 'materials', { deliveredAt: '1999-12-31T09:00:00Z' }), /内容变更前/);
});

test('期限后调整deadline按原内容的准时证明判定；无准时证明的缺口不能消除', () => {
  for (const timely of [true, false]) {
    let state = core.createEmptyProject();
    state = core.addSession(state, { id: 'main', title: '构造期限变更', startsAt: '2099-06-18T09:00:00Z' });
    state = core.addResource(state, { id: 'materials', sessionId: 'main', kind: 'materials', title: '资料', owner: '负责人', location: '原版资料', deadline: '2000-01-01T09:00:00Z' });
    state = core.addPath(state, { id: 'full', label: '提前阅读', sessionId: 'main', resourceIds: ['materials'] });
    if (timely) state = prove(state, 'materials', { checkedAt: '1999-12-31T10:00:00Z', deliveredAt: '1999-12-31T09:00:00Z' });
    state = core.updateResource(state, 'materials', { deadline: '2099-06-17T09:00:00Z' }, '修订期限但不改资料内容');
    assert.equal(core.resourceStatus(state, 'materials').status, timely ? 'needs-evidence' : 'late');
    state = prove(state, 'materials', { deliveredAt: timely ? '1999-12-31T09:00:00Z' : new Date().toISOString() });
    assert.equal(core.resourceStatus(state, 'materials').status, timely ? 'ready' : 'late');
    if (timely) { state = confirmed(state); assert.equal(core.evaluatePath(state, 'full').ready, true); }
    const imported = JSON.parse(core.exportProject(state)); imported.resources[0].missedDeadline = false;
    assert.equal(core.resourceStatus(core.importProject(imported), 'materials').status, timely ? 'ready' : 'late');
  }
});

test('路径增补实际需要保留旧历史确认，只使该路径失效，补双确认后可恢复', () => {
  let state = readyProject();
  state = core.editPath(state, 'route-only', { label: '新增字幕需要', resourceIds: ['route', 'captions'] }, '参加需要变更');
  assert.equal(core.evaluatePath(state, 'route-only').status, 'needs-confirmation');
  assert.equal(core.evaluatePath(state, 'full').ready, true);
  assert.equal(state.paths.find(item => item.id === 'route-only').versionHistory.length, 2);
  assert.equal(core.validateProject(core.importProject(core.exportProject(state))), true);
  state = confirmed(state, 'route-only'); assert.equal(core.evaluatePath(state, 'route-only').ready, true);
});

test('场次安排变更保留历史并要求相关最新版确认；无关场次不失效', () => {
  let state = readyProject();
  state = core.addSession(state, { id: 'other', title: '独立晚场', startsAt: '2099-06-18T20:00:00+08:00' });
  state = core.addResource(state, { id: 'other-route', sessionId: 'other', kind: 'route', title: '晚场入口', owner: '晚场负责人', location: '构造晚场入口' });
  state = core.addPath(state, { id: 'other-path', label: '晚场路径', sessionId: 'other', resourceIds: ['other-route'] });
  state = confirmed(prove(state, 'other-route'), 'other-path');
  state = core.updateSession(state, 'main', { startsAt: '2099-06-18T10:00:00+08:00' }, '主场推迟一小时');
  assert.equal(core.evaluatePath(state, 'full').ready, false);
  assert.equal(core.evaluatePath(state, 'other-path').ready, true);
  assert.equal(core.validateProject(core.importProject(core.exportProject(state))), true);
  state = confirmed(state); assert.equal(core.evaluatePath(state, 'full').ready, true);
  assert.match(core.buildParticipantHandoff(state, 'full'), /10:00:00/);
});

test('新证不能引用旧版本，非法版本/无原因/无实际变更均不能改变原档案', () => {
  const state = core.updateResource(readyProject(), 'route', { location: '新入口' }, '入口迁移');
  assert.throws(() => prove(state, 'route', { version: 1 }), /当前资源版本/);
  assert.throws(() => core.updateResource(state, 'route', { version: 3 }, '伪造'), /版本由系统生成/);
  assert.throws(() => core.updateResource(state, 'route', { location: '再新' }, ''), /变更原因/);
  assert.throws(() => core.updateResource(state, 'route', { location: '新入口' }, '不变'), /没有实际变化/);
  assert.equal(state.resources.find(item => item.id === 'route').version, 2);
});
