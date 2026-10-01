const KINDS = ['route', 'captions', 'materials'];
const PROOF = { route: 'route-traversed', captions: 'captions-visible', materials: 'materials-open' };
const LABELS = { route: '参加路径', captions: '观看端字幕', materials: '提前资料' };
const clone = value => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
const id = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const text = (value, label, optional = false) => {
  assert(typeof value === 'string' && value.length <= 10000 && (optional || value.trim().length > 0), `${label}须填写有效文字`);
};
const instant = (value, label) => {
  assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) && validDay(value.slice(0, 10)) && Number.isFinite(Date.parse(value)), `${label}须填写有效日期时间`);
};
const validDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const find = (list, key, label) => { const item = list.find(entry => entry.id === key); assert(item, `${label}不存在`); return item; };
const snapshot = resource => ({ version: resource.version, title: resource.title, owner: resource.owner, location: resource.location, deadline: resource.deadline, changedAt: resource.changedAt });
const sameInstant = (left, right) => left === right || Number.isFinite(Date.parse(left)) && Date.parse(left) === Date.parse(right);
const materialContentStart = (resource, version) => {
  let start = resource.versionHistory[0];
  for (let index = 1; index < version; index++) {
    if (resource.versionHistory[index].contentUpdated === true || resource.versionHistory[index].location !== resource.versionHistory[index - 1].location) start = resource.versionHistory[index];
  }
  return start;
};
const hasTimelyMaterialProof = (state, resource, version, deadline, checkedBefore) => {
  const start = materialContentStart(resource, version);
  return state.evidence.some(proof => proof.resourceId === resource.id && proof.version >= start.version && proof.version <= version && proof.result === 'pass' && Date.parse(proof.deliveredAt) <= Date.parse(deadline) && Date.parse(proof.checkedAt) <= Date.parse(checkedBefore));
};
const materialMissedDeadline = (state, resource) => resource.kind === 'materials' && (resource.missedDeadline || resource.versionHistory.some((revision, index) => {
  if (index === 0) return false;
  const previous = resource.versionHistory[index - 1];
  if (Date.parse(revision.changedAt) <= Date.parse(previous.deadline)) return false;
  return revision.contentUpdated === true || revision.location !== previous.location || !sameInstant(revision.deadline, previous.deadline) && !hasTimelyMaterialProof(state, resource, previous.version, previous.deadline, revision.changedAt);
}) || state.evidence.some(proof => proof.resourceId === resource.id && Date.parse(proof.deliveredAt) > Date.parse(resource.versionHistory[proof.version - 1].deadline)));
const audit = (state, action, details) => state.audit.push({ id: id('audit'), at: now(), action, details });
const unique = (items, label) => {
  assert(new Set(items.map(item => item.id)).size === items.length, `${label}编号重复`);
  items.forEach(item => text(item.id, `${label}编号`));
};

export function createEmptyProject() {
  return { schemaVersion: 1, event: { name: '', date: '' }, sessions: [], resources: [], paths: [], evidence: [], confirmations: [], audit: [] };
}

export function validateProject(state) {
  assert(state && typeof state === 'object' && !Array.isArray(state) && state.schemaVersion === 1, '文件版本不支持，请导入版本 1 项目');
  assert(state.event && typeof state.event === 'object', '活动信息缺失');
  text(state.event.name, '活动名称', true);
  text(state.event.date, '活动日期', true);
  assert(state.event.date === '' || validDay(state.event.date), '活动日期无效');
  for (const key of ['sessions', 'resources', 'paths', 'evidence', 'confirmations', 'audit']) {
    assert(Array.isArray(state[key]) && state[key].length <= 10000, `${key} 数据格式无效或超过 10000 条`);
    assert(state[key].every(item => item && typeof item === 'object' && !Array.isArray(item)), `${key} 数据条目无效`);
  }
  for (const key of ['sessions', 'resources', 'paths', 'evidence']) unique(state[key], key);
  for (const session of state.sessions) {
    text(session.title, '场次名称'); instant(session.startsAt, '场次开始时间');
    assert(Number.isInteger(session.version) && session.version >= 1 && Array.isArray(session.versionHistory) && session.versionHistory.length === session.version, '场次版本历史无效');
    for (let index = 0; index < session.versionHistory.length; index++) {
      const revision = session.versionHistory[index];
      assert(revision && revision.version === index + 1, '场次版本历史必须连续'); text(revision.title, '历史场次名称'); instant(revision.startsAt, '历史场次开始时间');
      if (index > 0) {
        instant(revision.changedAt, '场次变更时间'); assert(Date.parse(revision.changedAt) <= Date.now(), '场次变更时间不能在未来');
        if (index > 1) assert(Date.parse(revision.changedAt) >= Date.parse(session.versionHistory[index - 1].changedAt), '场次变更时间顺序无效');
      }
      else assert(revision.changedAt === null, '初始场次时间无效');
    }
    assert(session.versionHistory.at(-1).title === session.title && session.versionHistory.at(-1).startsAt === session.startsAt, '当前场次与版本历史不一致');
  }
  for (const resource of state.resources) {
    const session = find(state.sessions, resource.sessionId, '资源关联场次');
    assert(KINDS.includes(resource.kind), '资源类型无效');
    for (const key of ['title', 'owner', 'location']) text(resource[key], `资源${key}`);
    assert(Number.isInteger(resource.version) && resource.version >= 1, '资源版本无效');
    if (resource.kind === 'materials') {
      instant(resource.deadline, '提前资料期限');
      assert(Date.parse(resource.deadline) <= Date.parse(session.startsAt), '提前资料期限不能晚于场次开始');
    } else assert(resource.deadline === '', '只有提前资料资源可以设置交付期限');
    assert(typeof resource.missedDeadline === 'boolean', '迟交记录缺失');
    assert(Array.isArray(resource.versionHistory) && resource.versionHistory.length === resource.version, '资源版本历史不完整，不能伪造当前版本');
    for (let index = 0; index < resource.versionHistory.length; index++) {
      const revision = resource.versionHistory[index];
      assert(revision && revision.version === index + 1, '资源版本历史必须连续');
      assert(revision.contentUpdated === undefined || typeof revision.contentUpdated === 'boolean', '内容更新标记须为布尔值');
      if (index === 0) assert(revision.contentUpdated !== true, '初始版本不能标为内容更新');
      for (const key of ['title', 'owner', 'location']) text(revision[key], `历史资源${key}`);
      if (resource.kind === 'materials') { instant(revision.deadline, '历史提前资料期限'); assert(session.versionHistory.some(item => Date.parse(revision.deadline) <= Date.parse(item.startsAt)), '历史提前资料期限不能晚于所有场次安排'); }
      else assert(revision.deadline === '', '历史期限格式无效');
      if (index > 0) {
        instant(revision.changedAt, '资源变更时间'); assert(Date.parse(revision.changedAt) <= Date.now(), '资源变更时间不能在未来');
        if (index > 1) assert(Date.parse(revision.changedAt) >= Date.parse(resource.versionHistory[index - 1].changedAt), '资源变更时间顺序无效');
      }
      else assert(revision.changedAt === null, '初始资源时间记录无效');
    }
    assert(Object.entries(snapshot(resource)).every(([key, value]) => resource.versionHistory.at(-1)[key] === value), '当前资源与版本历史不一致');
  }
  for (const path of state.paths) {
    find(state.sessions, path.sessionId, '参加路径关联场次'); text(path.label, '参加路径名称');
    assert(Array.isArray(path.resourceIds) && path.resourceIds.length > 0 && new Set(path.resourceIds).size === path.resourceIds.length, '参加路径至少选择一项资源，且不能重复');
    for (const resourceId of path.resourceIds) assert(find(state.resources, resourceId, '参加路径资源').sessionId === path.sessionId, '参加路径不能引用其他场次资源');
    assert(Number.isInteger(path.version) && path.version >= 1 && Array.isArray(path.versionHistory) && path.versionHistory.length === path.version, '参加路径版本历史无效');
    for (let index = 0; index < path.versionHistory.length; index++) {
      const revision = path.versionHistory[index];
      assert(revision && revision.version === index + 1, '参加路径版本历史必须连续'); text(revision.label, '历史参加路径名称');
      assert(Array.isArray(revision.resourceIds) && revision.resourceIds.length > 0 && new Set(revision.resourceIds).size === revision.resourceIds.length, '历史参加路径资源无效');
      for (const key of revision.resourceIds) assert(find(state.resources, key, '历史参加路径资源').sessionId === path.sessionId, '历史参加路径不能引用其他场次资源');
      if (index > 0) {
        instant(revision.changedAt, '参加路径变更时间'); assert(Date.parse(revision.changedAt) <= Date.now(), '参加路径变更时间不能在未来');
        if (index > 1) assert(Date.parse(revision.changedAt) >= Date.parse(path.versionHistory[index - 1].changedAt), '参加路径变更时间顺序无效');
      }
      else assert(revision.changedAt === null, '初始参加路径时间无效');
    }
    const latest = path.versionHistory.at(-1);
    assert(latest.label === path.label && JSON.stringify(latest.resourceIds) === JSON.stringify(path.resourceIds), '当前参加路径与版本历史不一致');
  }
  for (const proof of state.evidence) validateEvidence(state, proof);
  for (const confirmation of state.confirmations) {
    const path = find(state.paths, confirmation.pathId, '确认的参加路径');
    text(confirmation.by, '确认人'); instant(confirmation.at, '确认时间');
    assert(Date.parse(confirmation.at) <= Date.now(), '确认时间不能在未来');
    assert(['owner', 'participant'].includes(confirmation.role), '确认角色无效');
    assert(typeof confirmation.signature === 'string', '确认签名无效');
    let parsed;
    try { parsed = JSON.parse(confirmation.signature); } catch { throw new Error('确认签名无效'); }
    const session = find(state.sessions, path.sessionId, '场次');
    assert(parsed && typeof parsed === 'object' && parsed.pathId === path.id && parsed.sessionId === path.sessionId && session.versionHistory.some(item => item.version === parsed.sessionVersion && item.startsAt === parsed.startsAt) && Array.isArray(parsed.resources), '确认签名的参加路径无效');
    const sessionRevision = session.versionHistory.find(item => item.version === parsed.sessionVersion);
    const pathRevision = path.versionHistory.find(item => item.version === parsed.pathVersion);
    assert(pathRevision && parsed.resources.length === pathRevision.resourceIds.length && parsed.resources.every(item => Array.isArray(item) && item.length === 3), '确认签名资源范围无效');
    if (sessionRevision.changedAt) assert(Date.parse(confirmation.at) >= Date.parse(sessionRevision.changedAt), '确认时间不能早于签名引用的场次变更');
    if (pathRevision.changedAt) assert(Date.parse(confirmation.at) >= Date.parse(pathRevision.changedAt), '确认时间不能早于签名引用的参加路径变更');
    for (const [resourceId, version, evidenceId] of parsed.resources) {
      assert(pathRevision.resourceIds.includes(resourceId), '确认签名含无效资源');
      const resourceRevision = find(state.resources, resourceId, '签名资源').versionHistory.find(item => item.version === version);
      assert(resourceRevision, '确认签名含未知版本');
      if (resourceRevision.changedAt) assert(Date.parse(confirmation.at) >= Date.parse(resourceRevision.changedAt), '确认时间不能早于签名引用的资源变更');
      const proof = state.evidence.find(item => item.id === evidenceId);
      assert(proof && proof.resourceId === resourceId && proof.version === version && proof.result === 'pass', '确认签名必须绑定该资源版本的通过证据');
      assert(Date.parse(confirmation.at) >= Date.parse(proof.checkedAt), '确认时间不能早于最终端演练');
    }
    assert(new Set(parsed.resources.map(item => item[0])).size === pathRevision.resourceIds.length, '确认签名含重复资源');
  }
  for (const entry of state.audit) { text(entry.id, '变更记录编号'); instant(entry.at, '变更记录时间'); text(entry.action, '变更动作'); text(entry.details, '变更说明'); }
  return true;
}

function validateEvidence(state, proof) {
  const resource = find(state.resources, proof.resourceId, '演练资源');
  const revision = resource.versionHistory.find(item => item.version === proof.version);
  assert(revision, '演练证据引用了未知资源版本');
  assert(proof.kind === PROOF[resource.kind], `${LABELS[resource.kind]}必须提供对应的最终端演练，音频或口头承诺不能代替观看端字幕`);
  assert(['pass', 'fail'].includes(proof.result), '演练结果无效');
  if (resource.kind === 'captions') {
    assert(proof.checks && ['available', 'enabled', 'readable'].every(key => typeof proof.checks[key] === 'boolean'), '字幕演练须分别记录获取、开启和可读检查');
    if (proof.result === 'pass') assert(['available', 'enabled', 'readable'].every(key => proof.checks[key]), '字幕通过须确认观看端可获取、已开启且文字可读；音频不能替代字幕');
  }
  text(proof.verifier, '检查人'); text(proof.notes, '最终端观察记录'); instant(proof.checkedAt, '检查时间');
  assert(Date.parse(proof.checkedAt) <= Date.now(), '检查时间不能在未来');
  if (revision.changedAt) assert(Date.parse(proof.checkedAt) >= Date.parse(revision.changedAt), '检查时间早于该资源版本的变更时间');
  if (resource.kind === 'materials') {
    instant(proof.deliveredAt, '资料实际交付时间');
    assert(Date.parse(proof.deliveredAt) <= Date.parse(proof.checkedAt), '资料交付时间不能晚于检查时间');
    const contentStart = materialContentStart(resource, proof.version);
    if (contentStart.changedAt) assert(Date.parse(proof.deliveredAt) >= Date.parse(contentStart.changedAt), '新版资料不能使用内容变更前的交付时间');
  } else assert(proof.deliveredAt === '', '仅资料演练应记录资料交付时间');
}

export function importProject(json) {
  let state;
  try { state = typeof json === 'string' ? JSON.parse(json) : clone(json); } catch { throw new Error('项目文件不是有效 JSON，现有工作不会被覆盖'); }
  validateProject(state);
  return clone(state);
}

export function exportProject(state) { validateProject(state); return JSON.stringify(state, null, 2); }

export function addSession(state, input) {
  const next = clone(state);
  const session = { id: input.id || id('session'), title: input.title?.trim(), startsAt: input.startsAt, version: 1, versionHistory: [] };
  session.versionHistory.push({ version: 1, title: session.title, startsAt: session.startsAt, changedAt: null });
  next.sessions.push(session);
  audit(next, '新增场次', input.title || ''); validateProject(next); return next;
}

export function updateSession(state, sessionId, patch, reason) {
  text(reason, '场次变更原因'); assert(patch && typeof patch === 'object' && Object.keys(patch).every(key => ['title', 'startsAt'].includes(key)), '仅能修改场次名称和开始时间');
  const next = clone(state); const session = find(next.sessions, sessionId, '场次');
  assert(Object.keys(patch).some(key => key === 'startsAt' ? !sameInstant(session[key], patch[key]) : session[key] !== patch[key]), '场次没有实际变化');
  Object.assign(session, patch); session.version++;
  session.versionHistory.push({ version: session.version, title: session.title, startsAt: session.startsAt, changedAt: now() });
  audit(next, '场次变更', `${session.title} → 版本 ${session.version}；原因：${reason}`);
  validateProject(next); return next;
}

export function addResource(state, input) {
  const next = clone(state);
  const resource = { id: input.id || id('resource'), sessionId: input.sessionId, kind: input.kind, title: input.title?.trim(), owner: input.owner?.trim(), location: input.location?.trim(), version: 1, deadline: input.kind === 'materials' ? input.deadline : '', changedAt: null, missedDeadline: false, versionHistory: [] };
  resource.versionHistory.push(snapshot(resource)); next.resources.push(resource);
  audit(next, '新增服务资源', resource.title || ''); validateProject(next); return next;
}

export function addPath(state, input) {
  const next = clone(state);
  const path = { id: input.id || id('path'), label: input.label?.trim(), sessionId: input.sessionId, resourceIds: [...(input.resourceIds || [])], version: 1, versionHistory: [] };
  path.versionHistory.push({ version: 1, label: path.label, resourceIds: [...path.resourceIds], changedAt: null });
  next.paths.push(path);
  audit(next, '新增参加路径', input.label || ''); validateProject(next); return next;
}

export function editPath(state, pathId, patch, reason) {
  text(reason, '路径变更原因'); assert(patch && typeof patch === 'object' && Object.keys(patch).every(key => ['label', 'resourceIds'].includes(key)), '仅能修改参加路径名称和服务组合');
  const next = clone(state); const path = find(next.paths, pathId, '参加路径');
  assert(Object.keys(patch).some(key => JSON.stringify(path[key]) !== JSON.stringify(patch[key])), '参加路径没有实际变化');
  Object.assign(path, clone(patch)); path.version++;
  path.versionHistory.push({ version: path.version, label: path.label, resourceIds: [...path.resourceIds], changedAt: now() });
  audit(next, '参加路径变更', `${path.label} → 版本 ${path.version}；原因：${reason}`);
  validateProject(next); return next;
}

export function updateResource(state, resourceId, patch, reason, options = {}) {
  text(reason, '变更原因'); assert(patch && typeof patch === 'object', '变更内容无效');
  assert(Object.keys(patch).every(key => ['title', 'owner', 'location', 'deadline'].includes(key)), '仅能修改名称、负责人、位置和资料期限；版本由系统生成');
  assert(options && typeof options === 'object' && !Array.isArray(options) && Object.keys(options).every(key => key === 'contentUpdated') && (options.contentUpdated === undefined || typeof options.contentUpdated === 'boolean'), '内容更新选项须为布尔值');
  const next = clone(state); const resource = find(next.resources, resourceId, '资源');
  const changed = options.contentUpdated === true || Object.keys(patch).some(key => key === 'deadline' ? !sameInstant(resource[key], patch[key]) : resource[key] !== patch[key]);
  assert(changed, '资源没有实际变化，请保留当前版本');
  const changedAt = now();
  Object.assign(resource, patch, { version: resource.version + 1, changedAt });
  resource.versionHistory.push({ ...snapshot(resource), ...(options.contentUpdated === true ? { contentUpdated: true } : {}) });
  if (materialMissedDeadline(next, resource)) resource.missedDeadline = true;
  audit(next, options.contentUpdated === true ? '内容/服务版本更新' : '资源变更', `${resource.title} → 版本 ${resource.version}；原因：${reason}`);
  validateProject(next); return next;
}

export function recordEvidence(state, input) {
  const next = clone(state); const resource = find(next.resources, input.resourceId, '资源');
  const proof = { id: input.id || id('evidence'), resourceId: resource.id, version: input.version ?? resource.version, checkedAt: input.checkedAt, kind: input.kind, verifier: input.verifier?.trim(), result: input.result, notes: input.notes?.trim(), deliveredAt: resource.kind === 'materials' ? input.deliveredAt : '' };
  if (resource.kind === 'captions') proof.checks = clone(input.checks || {});
  assert(proof.version === resource.version, '新演练只能记录当前资源版本，请在旧文件中保留历史证据');
  validateEvidence(next, proof); next.evidence.push(proof);
  if (materialMissedDeadline(next, resource)) resource.missedDeadline = true;
  audit(next, '最终端演练', `${resource.title} 版本 ${resource.version}；${proof.result === 'pass' ? '通过' : '失败'}；检查人：${proof.verifier}`);
  validateProject(next); return next;
}

export function resourceStatus(state, resourceId) {
  const resource = find(state.resources, resourceId, '资源');
  const proofs = state.evidence.filter(item => item.resourceId === resourceId && item.version === resource.version);
  const latest = proofs.map((item, index) => ({ item, index })).sort((a, b) => Date.parse(a.item.checkedAt) - Date.parse(b.item.checkedAt) || a.index - b.index).at(-1)?.item;
  const issues = [];
  const late = materialMissedDeadline(state, resource);
  if (late) issues.push(`${resource.title}：已错过提前资料期限；补交只能缓解，不能恢复提前准备机会`);
  if (!latest) issues.push(`${resource.title}：版本 ${resource.version} 尚无最终端演练证据`);
  else if (latest.result === 'fail') issues.push(`${resource.title}：最新演练失败，须修复后重新检查`);
  return { id: resourceId, title: resource.title, version: resource.version, status: late ? 'late' : !latest ? 'needs-evidence' : latest.result === 'fail' ? 'failed' : 'ready', ready: !issues.length, issues, evidence: latest || null };
}

function signatureFor(state, path) {
  const session = find(state.sessions, path.sessionId, '场次');
  return JSON.stringify({ pathId: path.id, pathVersion: path.version, sessionId: path.sessionId, sessionVersion: session.version, startsAt: session.startsAt, resources: path.resourceIds.slice().sort().map(key => [key, find(state.resources, key, '资源').version, resourceStatus(state, key).evidence?.id || null]) });
}

export function evaluatePath(state, pathId) {
  const path = find(state.paths, pathId, '参加路径'); const signature = signatureFor(state, path);
  const resources = path.resourceIds.map(key => resourceStatus(state, key));
  const issues = resources.flatMap(item => item.issues);
  const confirmations = Object.fromEntries(['owner', 'participant'].map(role => [role, state.confirmations.some(item => item.pathId === pathId && item.signature === signature && item.role === role)]));
  if (!confirmations.owner) issues.push('负责人尚未确认当前资源版本');
  if (!confirmations.participant) issues.push('参加者尚未确认当前资源版本');
  const blocked = resources.some(item => ['late', 'failed'].includes(item.status));
  const needsEvidence = resources.some(item => !item.ready);
  return { pathId, label: path.label, status: !issues.length ? 'ready' : blocked ? 'blocked' : needsEvidence ? 'needs-evidence' : 'needs-confirmation', ready: !issues.length, issues, signature, resources, confirmations };
}

export function confirmPath(state, pathId, by, role = 'participant') {
  text(by, '确认人'); assert(['owner', 'participant'].includes(role), '确认角色无效');
  const result = evaluatePath(state, pathId);
  assert(result.resources.length > 0 && result.resources.every(item => item.ready), '须先补齐当前版本的全部最终端演练；存在迟交或失败缺口时不能确认就绪');
  const next = clone(state);
  next.confirmations.push({ pathId, signature: result.signature, at: now(), by: by.trim(), role });
  audit(next, '确认最新版', `${result.label}；${role === 'owner' ? '负责人' : '参加者'}：${by.trim()}`);
  validateProject(next); return next;
}

const safe = value => String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_{}\[\]()#+.!|]/g, '\\$&');
export function buildHandoff(state) {
  validateProject(state);
  const lines = [`# ${safe(state.event.name || '未命名活动')} — 参与路径交接`, '', `活动日期：${safe(state.event.date || '待填写')}`, '', '本文件记录人工观察与版本核验，不代替实际服务履约或参加者真实体验。示例数据仅为构造演练。', '', '## 参加者最新版指引', ''];
  if (!state.paths.length) lines.push('尚未建立参加路径，请先补齐场次、资源和参加路径。', '');
  for (const path of state.paths) {
    const result = evaluatePath(state, path.id); const session = find(state.sessions, path.sessionId, '场次');
    lines.push(`### ${safe(path.label)}`, '', `场次：${safe(session.title)}；开始：${safe(session.startsAt)}`, '', `状态：${result.ready ? '证据及双确认齐备' : '存在缺口，请勿宣称完整就绪'}`, '', '| 服务 | 最新版本 | 位置／操作指引 | 提前资料期限 |', '| --- | --- | --- | --- |');
    for (const resourceId of path.resourceIds) { const resource = find(state.resources, resourceId, '资源'); lines.push(`| ${safe(resource.title)} | ${resource.version} | ${safe(resource.location)} | ${safe(resource.deadline || '不适用')} |`); }
    lines.push('', ...result.issues.map(issue => `- ${safe(issue)}`), '', `最新版确认：负责人${result.confirmations.owner ? '已确认' : '未确认'}；参加者${result.confirmations.participant ? '已确认' : '未确认'}`, '');
    for (const role of ['owner', 'participant']) { const confirmation = state.confirmations.filter(item => item.pathId === path.id && item.signature === result.signature && item.role === role).at(-1); if (confirmation) lines.push(`- ${role === 'owner' ? '负责人' : '参加者'}确认人：${safe(confirmation.by)}；${safe(confirmation.at)}`); }
    lines.push('');
  }
  lines.push('## 负责人行动与最终端演练', '', '| 资源 | 负责人 | 当前版本 | 最新检查 | 最终端观察／恢复缺口 |', '| --- | --- | --- | --- | --- |');
  for (const resource of state.resources) {
    const result = resourceStatus(state, resource.id); const proof = result.evidence;
    lines.push(`| ${safe(resource.title)} | ${safe(resource.owner)} | ${resource.version} | ${proof ? `${safe(proof.verifier)} · ${safe(proof.checkedAt)} · ${proof.result === 'pass' ? '通过' : '失败'}` : '待演练'} | ${safe([proof?.notes, ...result.issues].filter(Boolean).join('；'))} |`);
  }
  lines.push('', '本工具只核对每条路径已选择的服务；组织者须先完整确定参加者已接受的实际需要。变更后先使用最新位置与资料做最终端演练，再请负责人和参加者分别确认。只有受影响路径失效；提前资料迟交无法靠补交或重新确认恢复。', '', '## 保留的版本与变更记录', '');
  for (const resource of state.resources) {
    lines.push(`### ${safe(resource.title)}`, '');
    for (const revision of resource.versionHistory) lines.push(`- 版本 ${revision.version}：${safe(revision.location)}；负责人：${safe(revision.owner)}；期限：${safe(revision.deadline || '不适用')}；${revision.contentUpdated ? '内容/服务已更新；' : ''}${safe(revision.changedAt || '初始版本')}`);
    lines.push('');
  }
  for (const entry of state.audit) lines.push(`- ${safe(entry.at)} · ${safe(entry.action)} · ${safe(entry.details)}`);
  return lines.join('\n') + '\n';
}

export function buildParticipantHandoff(state, pathId) {
  validateProject(state);
  const path = find(state.paths, pathId, '参加路径');
  const subset = clone(state);
  subset.paths = [clone(path)];
  subset.sessions = subset.sessions.filter(item => item.id === path.sessionId);
  const historicalResourceIds = new Set(path.versionHistory.flatMap(item => item.resourceIds));
  subset.resources = subset.resources.filter(item => historicalResourceIds.has(item.id));
  subset.evidence = subset.evidence.filter(item => historicalResourceIds.has(item.resourceId));
  subset.confirmations = subset.confirmations.filter(item => item.pathId === pathId);
  return buildHandoff(subset).split('## 负责人行动与最终端演练')[0] + '变更后请使用最新版参加指引并重新确认。存在缺口时联系已列明的活动负责人；本文件不保证实际服务履约。\n';
}

export function buildOwnerHandoff(state, owner) {
  validateProject(state); text(owner, '负责人');
  const resources = state.resources.filter(item => item.owner === owner);
  assert(resources.length > 0, '该负责人尚未分配资源');
  const lines = [`# ${safe(state.event.name || '未命名活动')} — ${safe(owner)}任务交接`, '', '人工观察与版本证据工作单；不代表实际服务已履约。', '', '| 资源 | 版本 | 实际位置／指引 | 期限 | 行动／缺口 |', '| --- | --- | --- | --- | --- |'];
  for (const resource of resources) {
    const result = resourceStatus(state, resource.id);
    lines.push(`| ${safe(resource.title)} | ${resource.version} | ${safe(resource.location)} | ${safe(resource.deadline || '不适用')} | ${safe(result.issues.join('；') || '最终端演练通过，请完成相关路径最新版双确认')} |`);
  }
  lines.push('', '## 最终端观察', '');
  for (const resource of resources) {
    const proof = resourceStatus(state, resource.id).evidence;
    if (proof) lines.push(`- ${safe(resource.title)}：检查人${safe(proof.verifier)}；时间${safe(proof.checkedAt)}；观察${safe(proof.notes)}`);
    else lines.push(`- ${safe(resource.title)}：尚无当前版本演练观察`);
  }
  lines.push('', '## 相关参加路径', '');
  for (const path of state.paths.filter(item => item.resourceIds.some(key => resources.some(resource => resource.id === key)))) {
    const result = evaluatePath(state, path.id);
    lines.push(`- ${safe(path.label)}：${result.ready ? '证据及双确认齐备' : safe(result.issues.join('；'))}`);
  }
  lines.push('', '修改服务必须登记变更原因；使用实际参加端重做演练，再由负责人和参加者分别确认最新版。字幕应实际获取、开启并读到文字；资料应在原提前期限前交付且可打开调整。迟交只能缓解，不能恢复提前准备机会。', '');
  return lines.join('\n');
}

export function demoProject() {
  let state = createEmptyProject();
  state.event = { name: '构造演练 · 混合活动无障碍参与', date: '2030-06-18' };
  state = addSession(state, { id: 'morning', title: '上午分享与线上讨论', startsAt: '2030-06-18T09:00:00+08:00' });
  for (const input of [
    { id: 'route', kind: 'route', title: '线上参加入口', owner: '活动主持', location: '构造地址：https://example.invalid/room' },
    { id: 'captions', kind: 'captions', title: '观看端中文字幕', owner: '字幕负责人', location: '播放器右下角打开中文字幕' },
    { id: 'materials', kind: 'materials', title: '提前可调整阅读资料', owner: '资料负责人', location: '构造资料：会前说明与可调整文字稿', deadline: '2030-06-17T09:00:00+08:00' }
  ]) state = addResource(state, { ...input, sessionId: 'morning' });
  state = addPath(state, { id: 'remote', label: '线上观看与提前阅读', sessionId: 'morning', resourceIds: ['route', 'captions', 'materials'] });
  return state;
}
