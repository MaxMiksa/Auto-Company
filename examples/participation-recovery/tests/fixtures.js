import * as core from '../core.js';

export function project() {
  let state = core.createEmptyProject();
  state.event = { name: '业务测试用构造活动', date: '2099-06-18' };
  state = core.addSession(state, { id: 'main', title: '主题分享', startsAt: '2099-06-18T09:00:00+08:00' });
  for (const kind of ['route', 'captions', 'materials']) state = core.addResource(state, { id: kind, sessionId: 'main', kind, title: `${kind}服务`, owner: '构造负责人', location: '构造指引', deadline: '2099-06-17T09:00:00+08:00' });
  state = core.addPath(state, { id: 'full', label: '远程字幕与提前阅读', sessionId: 'main', resourceIds: ['route', 'captions', 'materials'] });
  state = core.addPath(state, { id: 'route-only', label: '仅需路线', sessionId: 'main', resourceIds: ['route'] });
  return state;
}

export function prove(state, resourceId, patch = {}) {
  const resource = state.resources.find(item => item.id === resourceId);
  const timestamp = new Date().toISOString();
  return core.recordEvidence(state, { resourceId, kind: { route: 'route-traversed', captions: 'captions-visible', materials: 'materials-open' }[resource.kind], checkedAt: timestamp, verifier: '构造演练检查人', result: 'pass', notes: '构造人工观察：从参加端走完路径、开启可读字幕或打开可调整资料；不代表真实活动', deliveredAt: timestamp, checks: { available: true, enabled: true, readable: true }, ...patch });
}

export function confirmed(state, pathId = 'full') {
  state = core.confirmPath(state, pathId, '构造负责人', 'owner');
  return core.confirmPath(state, pathId, '构造参加者', 'participant');
}

export function readyProject() {
  let state = project();
  for (const kind of ['route', 'captions', 'materials']) state = prove(state, kind);
  state = confirmed(state);
  return confirmed(state, 'route-only');
}
