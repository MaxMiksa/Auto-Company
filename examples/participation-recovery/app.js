import * as core from './core.js';

const STORAGE_KEY = 'participation-recovery:v1';
const BACKUP_KEY = 'participation-recovery:previous';
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const kindNames = {route:'参与入口', captions:'最终端字幕', materials:'提前资料'};
const statusNames = {ready:'演练通过', 'needs-evidence':'待补证据', 'needs-confirmation':'待确认', blocked:'尚未就绪', failed:'演练失败', late:'超过提前截止'};
const dateText = (value) => value ? new Date(value).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}) : '未指定';
const iso = (value) => value ? new Date(value).toISOString() : '';
const preciseLocalTime = (value = new Date().toISOString()) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, -1);
};
let state = core.createEmptyProject();
let dialogAction = null;
let saveFailed = false;

function notify(message, error = false) {
  const notice = $('#notice');
  notice.textContent = message;
  notice.className = `notice${error ? ' error' : ''}`;
  notice.hidden = false;
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, core.exportProject(state));
    saveFailed = false;
    $('#save-status').textContent = '已自动保存到本浏览器';
    $('#save-status').className = '';
  } catch {
    saveFailed = true;
    $('#save-status').textContent = '保存失败 · 请下载完整备份';
    $('#save-status').className = 'error';
    notify('浏览器未能保存本次记录。当前工作仍在此页面，请立即下载完整备份，避免关闭页面后丢失。', true);
  }
}

function commit(next, message = '已保存。') {
  core.validateProject(next);
  state = next;
  render();
  persist();
  if (!saveFailed) notify(message);
}

function backupBeforeReplace() {
  try {
    localStorage.setItem(BACKUP_KEY, core.exportProject(state));
    return true;
  } catch {
    download(core.exportProject(state), '参途-替换前备份.json', 'application/json');
    return false;
  }
}

function badge(status, label) {
  const tone = ['blocked','failed','late'].includes(status) ? 'warning' : status === 'ready' ? '' : 'neutral';
  return `<span class="badge ${tone}">${esc(label || statusNames[status] || status)}</span>`;
}

function issues(items) {
  return items?.length ? `<ul class="issues">${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : '';
}

function render() {
  $('#event-heading').textContent = state.event.name || '未命名活动';
  $('#event-name').value = state.event.name;
  $('#event-date').value = state.event.date || '';
  $('#session-count').textContent = state.sessions.length;
  $('#resource-count').textContent = state.resources.length;
  const evaluations = state.paths.map(path => ({path, evaluation: core.evaluatePath(state, path.id)}));
  const ready = evaluations.filter(({evaluation}) => evaluation.ready).length;
  $('#ready-count').textContent = `${ready} / ${state.paths.length}`;
  $('#overview-message').textContent = state.paths.length ? `${state.paths.length - ready} 条路径仍有待办。就绪需要服务证据、负责人确认与参加者确认，均对应当前版本。` : '先添加一个时段，再建立参加者要走的路径。';
  $('#session-list').innerHTML = state.sessions.length ? state.sessions.map(session => `<div class="session-tag" data-session-id="${esc(session.id)}"><strong>${esc(session.title)}</strong><time datetime="${esc(session.startsAt)}">${esc(dateText(session.startsAt))}</time><button type="button" class="text-button compact" data-action="change-session" data-id="${esc(session.id)}">变更时段</button></div>`).join('') : '<p class="empty">这里还没有活动时段。添加开始时间，才能判断资料是否提前交付。</p>';
  $('#resource-rows').innerHTML = state.resources.length ? state.resources.map(resource => {
    const status = core.resourceStatus(state, resource.id);
    const session = state.sessions.find(item => item.id === resource.sessionId);
    const latest = status.evidence;
    return `<tr data-resource-id="${esc(resource.id)}"><td><span class="resource-kind">${kindNames[resource.kind]}</span><br><strong>${esc(resource.title)}</strong><span class="cell-meta">当前版本 v${esc(resource.version)}</span></td><td>${esc(session?.title)}<span class="cell-meta">负责人：${esc(resource.owner)}</span><button type="button" class="text-button compact" data-action="owner-export" data-id="${esc(resource.id)}">下载负责人任务</button></td><td><span class="location">${esc(resource.location)}</span><span class="cell-meta">${resource.deadline ? `提前截止：${esc(dateText(resource.deadline))}` : '无需提前交付截止'}</span></td><td>${badge(status.status)}${latest ? `<span class="cell-meta">${esc(latest.verifier)} · ${esc(dateText(latest.checkedAt))}</span>` : ''}${issues(status.issues)}</td><td><div class="row-actions"><button type="button" data-action="evidence" data-id="${esc(resource.id)}">记录演练</button><button type="button" class="quiet" data-action="change" data-id="${esc(resource.id)}">变更入口</button><button type="button" class="quiet" data-action="history" data-id="${esc(resource.id)}">查看证据</button></div></td></tr>`;
  }).join('') : '<tr><td colspan="5" class="table-empty">暂无服务。先准备参与入口、最终端字幕和提前资料，再记录实际演练结果。</td></tr>';
  $('#path-list').innerHTML = evaluations.length ? evaluations.map(({path,evaluation}) => {
    const resources = path.resourceIds.map(id => state.resources.find(item => item.id === id)).filter(Boolean);
    const session = state.sessions.find(item => item.id === path.sessionId);
    const confirmation = evaluation.confirmations || {};
    return `<section class="path-panel" data-path-id="${esc(path.id)}" aria-label="${esc(path.label)}"><div class="path-intro"><span class="eyebrow">参与路径</span><h3>${esc(path.label)}</h3><small>${esc(session?.title)}</small>${badge(evaluation.status,evaluation.ready ? '完整就绪' : statusNames[evaluation.status])}<button type="button" class="text-button compact" data-action="participant-export" data-id="${esc(path.id)}">下载参加者指引</button></div><div class="path-body"><div class="path-track">${resources.map((resource,index) => `<span class="path-step"><b>${String(index + 1).padStart(2,'0')}</b>${esc(resource.title)} · v${resource.version}</span>`).join('') || '<span class="hint">尚未关联服务</span>'}</div>${issues(evaluation.issues)}<div class="confirmation-row"><small>当前版本：负责人${confirmation.owner ? '已确认' : '待确认'} / 参加者${confirmation.participant ? '已确认' : '待确认'}</small><button type="button" class="quiet" data-action="edit-path" data-id="${esc(path.id)}">调整路径</button><button type="button" class="quiet" data-action="confirm-owner" data-id="${esc(path.id)}">负责人确认</button><button type="button" class="quiet" data-action="confirm-participant" data-id="${esc(path.id)}">参加者确认</button></div></div></section>`;
  }).join('') : '<div class="empty">建立一条参加者路径，把同一时段的入口、字幕和资料串在一起。可以为不同参加方式分别建立路径。</div>';
}

function showDialog(title, fields, action, submitLabel = '保存', kicker = '参途工作台') {
  $('#dialog-title').textContent = title;
  $('#dialog-kicker').textContent = kicker;
  $('#dialog-fields').innerHTML = fields;
  $('#dialog-submit').textContent = submitLabel;
  $('#dialog-error').hidden = true;
  dialogAction = action;
  $('#editor-dialog').showModal();
  const focus = $('#dialog-fields').querySelector('input,select,textarea');
  if (focus) focus.focus();
}

function closeDialog() { $('#editor-dialog').close(); dialogAction = null; }
$('#close-dialog').addEventListener('click', closeDialog);
$('#cancel-dialog').addEventListener('click', closeDialog);
$('#editor-form').addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    const keepOpen = dialogAction?.(new FormData(event.currentTarget));
    if (!keepOpen) closeDialog();
  } catch (error) {
    $('#dialog-error').textContent = error.message || '无法保存，请检查输入。';
    $('#dialog-error').hidden = false;
  }
});

const sessionOptions = () => state.sessions.map(session => `<option value="${esc(session.id)}">${esc(session.title)}</option>`).join('');
function ensureSession() { if (!state.sessions.length) { notify('请先添加活动时段。', true); return false; } return true; }

$('#save-event').addEventListener('click', () => {
  try {
    const name = $('#event-name').value.trim();
    if (!name) throw new Error('请填写活动名称。');
    commit({...state, event:{...state.event,name,date:$('#event-date').value}}, '活动信息已保存。');
  } catch (error) { notify(error.message, true); }
});

$('#add-session').addEventListener('click', () => showDialog('添加活动时段', '<div class="field-grid"><label class="wide">时段标题<input name="title" required maxlength="120" placeholder="例如：主题分享与提问"></label><label class="wide">开始时间<input name="startsAt" type="datetime-local" required></label></div>', data => {
  commit(core.addSession(state,{title:data.get('title'),startsAt:iso(data.get('startsAt'))}), '活动时段已添加。');
}, '添加时段', '01 / 活动与时段'));

$('#add-resource').addEventListener('click', () => {
  if (!ensureSession()) return;
  showDialog('添加参与服务', `<div class="field-grid"><label>服务类型<select name="kind" id="resource-kind"><option value="route">参与入口</option><option value="captions">最终端字幕</option><option value="materials">提前资料</option></select></label><label>所属时段<select name="sessionId">${sessionOptions()}</select></label><label class="wide">服务名称<input name="title" required maxlength="120" placeholder="例如：在线直播入口"></label><label class="wide">负责人<input name="owner" required maxlength="120" placeholder="角色或负责人姓名"></label><label class="wide">入口或资料位置<input name="location" required maxlength="2000" placeholder="网址、会场位置或本地资料路径"><span class="hint">只记录位置，不会自动打开链接或发送消息。</span></label><label class="wide" id="deadline-field" hidden>提前交付截止<input name="deadline" id="resource-deadline" type="datetime-local"><span class="hint">提前资料必须设置，且不得晚于所属时段开始。</span></label></div>`, data => {
    commit(core.addResource(state,{kind:data.get('kind'),sessionId:data.get('sessionId'),title:data.get('title'),owner:data.get('owner'),location:data.get('location'),deadline:iso(data.get('deadline'))}), '服务已添加，下一步请记录最终端演练。');
  }, '添加服务', '02 / 服务与演练');
  $('#resource-kind').addEventListener('change', event => { const materials = event.target.value === 'materials'; $('#resource-deadline').required = materials; $('#deadline-field').hidden = !materials; });
});

$('#add-path').addEventListener('click', () => {
  if (!ensureSession()) return;
  showDialog('建立参加者路径', `<div class="field-grid"><label class="wide">路径名称<input name="label" required maxlength="120" placeholder="例如：远程参加 · 需要字幕与提前资料"></label><label class="wide">所属时段<select name="sessionId" id="path-session">${sessionOptions()}</select></label><fieldset class="wide"><legend>勾选服务</legend><div class="checkbox-list" id="path-resources"></div><span class="hint">至少选择一项同一时段的服务；请按参加者实际需要完整选择，软件不会替你判断遗漏的需要。</span></fieldset></div>`, data => {
    commit(core.addPath(state,{label:data.get('label'),sessionId:data.get('sessionId'),resourceIds:data.getAll('resourceIds')}), '路径已建立。请按缺口补齐证据，并完成双向确认。');
  }, '建立路径', '03 / 路径与确认');
  const populateResources = () => {
    const resources = state.resources.filter(resource => resource.sessionId === $('#path-session').value);
    $('#path-resources').innerHTML = resources.length ? resources.map(resource => `<label><input type="checkbox" name="resourceIds" value="${esc(resource.id)}"><span>${esc(resource.title)} <small>· ${kindNames[resource.kind]} / ${esc(resource.owner)}</small></span></label>`).join('') : '<p class="hint">该时段暂无服务，请先添加至少一项服务。</p>';
  };
  $('#path-session').addEventListener('change', populateResources);
  populateResources();
});

function evidenceDialog(id) {
  const resource = state.resources.find(item => item.id === id);
  const kind = {route:'route-traversed',captions:'captions-visible',materials:'materials-open'}[resource.kind];
  const instruction = {route:'从参加者实际收到的入口出发，走到实际会场或观看页面，核验是否能够加入。',captions:'在参加者最终观看端核验字幕是否可见、可读、与内容同步；不能用后台开启状态代替。',materials:'以参加者方式打开资料，核验阅读与调整是否可用，并填写资料实际送达时间。'}[resource.kind];
  showDialog(`记录演练 · ${resource.title}`, `<p class="dialog-copy">${esc(instruction)} 记录当前版本 v${resource.version} 的真实观察；软件不会替代人工核验。</p><div class="field-grid"><label>核验人<input name="verifier" required maxlength="120"></label><label>核验时间<input name="checkedAt" type="datetime-local" step="0.001" value="${preciseLocalTime()}" required></label><label class="wide">最终端结果<select name="result"><option value="pass">通过：最终端已实际核验</option><option value="fail">失败：仍有缺口</option></select></label>${resource.kind === 'captions' ? '<fieldset class="wide"><legend>字幕最终端核验</legend><div class="checkbox-list"><label><input type="checkbox" name="available">实际观看端能获取字幕</label><label><input type="checkbox" name="enabled">已从参加者端开启字幕</label><label><input type="checkbox" name="readable">文字可见且可读</label></div><span class="hint">通过须三项全部核实。纯音频或后台已开启不能替代。</span></fieldset>' : ''}<label class="wide">最终端观察<textarea name="notes" required maxlength="6000" placeholder="记录使用的设备或页面、实际观察、失败原因与恢复动作"></textarea></label>${resource.kind === 'materials' ? '<label class="wide">实际交付时间<input name="deliveredAt" type="datetime-local" step="0.001" required><span class="hint">填写资料实际送达参加者的时间，不是现在的核验时间。迟交不会因补写通过而变成按时交付。</span></label>' : ''}</div>`, data => {
    const checks = {available:data.has('available'),enabled:data.has('enabled'),readable:data.has('readable')};
    commit(core.recordEvidence(state,{resourceId:id,kind,checks,verifier:data.get('verifier'),checkedAt:iso(data.get('checkedAt')),result:data.get('result'),notes:data.get('notes'),deliveredAt:iso(data.get('deliveredAt'))}), '最终端演练已记录。请查看路径缺口与确认状态。');
  }, '保存演练记录', '02 / 最终端证据');
}

function changeDialog(id) {
  const resource = state.resources.find(item => item.id === id);
  showDialog(`变更服务 · ${resource.title}`, `<div class="warning-copy">此操作会生成新版本，并使关联路径的旧证据与旧确认失效。未关联的路径不受影响；请在变更后重新演练并确认。</div><div class="field-grid"><fieldset class="wide"><legend>内容/服务版本更新</legend><div class="checkbox-list"><label><input type="checkbox" name="contentUpdated">内容或服务已实际更新（地址可以不变）</label></div><span class="hint">同地址替换资料、更新字幕或服务安排时勾选，并在下方说明实际变化。仅误点或补写说明时请取消，不要勾选。</span></fieldset><label class="wide">变更后名称<input name="title" required value="${esc(resource.title)}" maxlength="120"></label><label class="wide">变更后负责人<input name="owner" required value="${esc(resource.owner)}" maxlength="120"></label><label class="wide">变更后入口<input name="location" required value="${esc(resource.location)}" maxlength="2000"></label><label class="wide" ${resource.kind === 'materials' ? '' : 'hidden'}>变更后提前截止<input name="deadline" type="datetime-local" step="0.001" value="${resource.deadline ? preciseLocalTime(resource.deadline) : ''}" ${resource.kind === 'materials' ? 'required' : ''}><span class="hint">历史迟交保留；修改截止不会改写已发生的交付事实。</span></label><label class="wide">变更原因<textarea name="reason" required maxlength="6000" placeholder="说明实际内容或安排的变化、需要谁接手恢复"></textarea></label></div>`, data => {
    commit(core.updateResource(state,id,{title:data.get('title'),owner:data.get('owner'),location:data.get('location'),deadline:iso(data.get('deadline'))},data.get('reason'),{contentUpdated:data.has('contentUpdated')}), '服务版本已更新。相关旧证据和旧确认已失效，请按路径缺口恢复。');
  }, '保存变更', '02 / 变更与恢复');
}

function confirmDialog(id, role) {
  const path = state.paths.find(item => item.id === id);
  const roleName = role === 'owner' ? '负责人' : '参加者';
  showDialog(`${roleName}确认 · ${path.label}`, `<p class="dialog-copy">请确认当前入口、字幕和提前资料的最终端演练记录，并确认自己能够按这条最新路径参与或履约。未解决的证据缺口会阻止就绪。</p><label>确认人<input name="by" required maxlength="120" placeholder="填写实际确认人；不要代填虚构用户"></label>`, data => {
    commit(core.confirmPath(state,id,data.get('by'),role), `${roleName}已确认当前版本。`);
  }, '确认最新版路径', '03 / 双向确认');
}

function editPathDialog(id) {
  const path = state.paths.find(item => item.id === id);
  const resources = state.resources.filter(item => item.sessionId === path.sessionId);
  showDialog(`调整路径 · ${path.label}`, `<div class="warning-copy">修改服务组合或名称会生成路径新版，并使这条路径的旧确认失效。原始记录保留；请由负责人和参加者重新确认。</div><div class="field-grid"><label class="wide">路径名称<input name="label" required value="${esc(path.label)}" maxlength="120"></label><fieldset class="wide"><legend>勾选服务</legend><div class="checkbox-list">${resources.map(resource => `<label><input type="checkbox" name="resourceIds" value="${esc(resource.id)}" ${path.resourceIds.includes(resource.id) ? 'checked' : ''}>${esc(resource.title)} <small>· ${kindNames[resource.kind]}</small></label>`).join('')}</div><span class="hint">请根据参加者已表达的实际需要完整选择服务，至少保留一项。</span></fieldset><label class="wide">调整原因<textarea name="reason" required maxlength="6000"></textarea></label></div>`, data => {
    commit(core.editPath(state,id,{label:data.get('label'),resourceIds:data.getAll('resourceIds')},data.get('reason')), '路径已更新，请核对新增服务的证据并重新双向确认。');
  }, '保存路径调整', '03 / 路径恢复');
}

function changeSessionDialog(id) {
  const session = state.sessions.find(item => item.id === id);
  showDialog(`变更时段 · ${session.title}`, `<div class="warning-copy">变更标题或开始时间会使该时段的路径确认失效，请向相关负责人和参加者说明变化并重新确认。软件不会替你发送消息。</div><div class="field-grid"><label class="wide">时段标题<input name="title" required maxlength="120" value="${esc(session.title)}"></label><label class="wide">开始时间<input name="startsAt" type="datetime-local" step="0.001" required value="${preciseLocalTime(session.startsAt)}"></label><label class="wide">变更原因<textarea name="reason" required maxlength="6000"></textarea></label></div>`, data => {
    commit(core.updateSession(state,id,{title:data.get('title'),startsAt:iso(data.get('startsAt'))},data.get('reason')), '时段已变更，请检查受影响路径并重新确认最新安排。');
  }, '保存时段变更', '01 / 安排与恢复');
}

function historyDialog(id) {
  const resource = state.resources.find(item => item.id === id);
  const proofs = state.evidence.filter(item => item.resourceId === id).slice().reverse();
  const entries = proofs.map(proof => `<article class="evidence-entry"><strong>v${proof.version} · ${proof.result === 'pass' ? '通过' : '失败'}${proof.version !== resource.version ? ' · 历史证据，不能确认当前版本' : ''}</strong><span class="hint">${esc(proof.verifier)} · ${esc(dateText(proof.checkedAt))}${proof.deliveredAt ? ` / 资料交付：${esc(dateText(proof.deliveredAt))}` : ''}</span><p>${esc(proof.notes)}</p>${proof.checks ? `<span class="hint">获取字幕：${proof.checks.available ? '是' : '否'} / 已开启：${proof.checks.enabled ? '是' : '否'} / 文字可读：${proof.checks.readable ? '是' : '否'}</span>` : ''}</article>`).join('');
  const versions = (resource.versionHistory || []).slice().reverse().map(version => `<li>v${version.version} · ${esc(version.location)} · 负责人 ${esc(version.owner)}${version.contentUpdated ? ' · 内容/服务已更新' : ''}${version.changedAt ? ` · ${esc(dateText(version.changedAt))}` : ' · 初始版本'}</li>`).join('');
  showDialog(`证据记录 · ${resource.title}`, `<div class="dialog-copy">${entries || '<p>尚无最终端演练记录。</p>'}<h3 class="history-title">服务版本历史</h3><ul class="history-list">${versions}</ul><p class="hint">历史保留用于交接。当前就绪依据最新版本的最新证据，不会自动沿用旧证据。</p></div>`, () => {}, '关闭记录', '02 / 可追溯记录');
}

$('#main').addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const {action,id} = button.dataset;
  if (action === 'evidence') evidenceDialog(id);
  if (action === 'change') changeDialog(id);
  if (action === 'history') historyDialog(id);
  if (action === 'edit-path') editPathDialog(id);
  if (action === 'change-session') changeSessionDialog(id);
  if (action === 'participant-export') { download(core.buildParticipantHandoff(state,id), '参途-参加者指引.md', 'text/markdown;charset=utf-8'); notify('已生成这条路径的参加者指引，不包含其他路径。'); }
  if (action === 'owner-export') { const resource = state.resources.find(item => item.id === id); download(core.buildOwnerHandoff(state,resource.owner), '参途-负责人任务.md', 'text/markdown;charset=utf-8'); notify('已生成该负责人名下的服务任务。'); }
  if (action.startsWith('confirm-')) confirmDialog(id,action.replace('confirm-',''));
});

function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('#export-json').addEventListener('click', () => {
  download(core.exportProject(state), '参途-完整活动备份.json', 'application/json');
  notify('完整备份已生成，请妥善保存下载文件。');
});
$('#export-markdown').addEventListener('click', () => {
  download(core.buildHandoff(state), '参途-中文交接包.md', 'text/markdown;charset=utf-8');
  notify('中文交接包已生成。未完成的证据和确认会保留在交接包中。');
});

$('#import-json').addEventListener('click', () => {
  showDialog('导入完整备份', '<div class="warning-copy">成功导入将替换当前活动。替换前会保留上一份本地快照；建议先下载完整备份。输入无效时不会更改现有活动。</div><label>选择备份文件<input id="import-file" type="file" accept=".json,application/json"></label><label style="margin-top:16px">备份内容<textarea id="import-content" name="json" required rows="9" placeholder="粘贴参途导出的完整 JSON，或选择备份文件"></textarea></label><button class="text-button" type="button" id="recover-previous">取回替换前本地快照</button>', data => {
    const imported = core.importProject(data.get('json'));
    backupBeforeReplace();
    commit(imported, '备份已导入。请核对活动、路径与历史证据。');
  }, '导入备份', '04 / 数据恢复');
  $('#import-file').addEventListener('change', async event => {
    try { const file = event.target.files[0]; if (file) $('#import-content').value = await file.text(); }
    catch { $('#dialog-error').textContent = '未能读取文件，请重选或粘贴备份内容。'; $('#dialog-error').hidden = false; }
  });
  $('#recover-previous').addEventListener('click', () => {
    try {
      const previous = localStorage.getItem(BACKUP_KEY);
      if (!previous) throw new Error('本浏览器暂无替换前快照。请使用下载的备份文件。');
      $('#import-content').value = previous;
      $('#dialog-error').hidden = true;
    } catch (error) { $('#dialog-error').textContent = error.message; $('#dialog-error').hidden = false; }
  });
});

function replaceDialog(demo) {
  showDialog(demo ? '加载合成演示' : '新建空白活动', `<div class="warning-copy">此操作将替换当前活动。请先下载完整备份；替换前会保留本地快照，可在“导入备份”中取回。</div><p class="dialog-copy">${demo ? '演示是构造的活动与服务配置，仅用于理解操作，不代表真实参加者、实际履约或交易。请自行练习记录观察与确认，不要将构造内容当作现实证据。' : '新活动从空白开始，不会沿用当前路径和证据。'}</p><label class="checkbox-list"><span><input name="replace" type="checkbox" required> 我已了解并确认替换当前活动</span></label>`, () => {
    backupBeforeReplace();
    commit(demo ? core.demoProject() : core.createEmptyProject(), demo ? '已加载合成演示；这些内容不是实际用户或现场验证。' : '已新建空白活动。');
  }, demo ? '确认加载合成演示' : '确认新建空白活动', '04 / 明确替换');
}
$('#load-demo').addEventListener('click', () => replaceDialog(true));
$('#new-event').addEventListener('click', () => replaceDialog(false));
$('#help-button').addEventListener('click', () => showDialog('一次完整的参与路径演练', '<div class="dialog-copy"><p>参途帮助活动负责人记录演练、追踪变更，并交接尚未解决的问题。它不会自动检测直播字幕、修复资料，也不会联系任何人。</p><ol><li>填写活动与时段，记录参加者入口、字幕、提前资料及各自负责人。</li><li>建立参加者路径，将所需服务串在一起。</li><li>人工从真实入口走到最终使用端，观察字幕、打开资料，填写通过或失败证据。提前资料同时记录实际交付时间。</li><li>检查路径缺口，负责人和参加者分别确认当前版本。</li><li>发生入口、负责人或截止变更时，填写原因。软件撤销受影响路径的旧版就绪；重新演练并确认。</li><li>导出中文交接包与完整备份。失败、历史迟交和缺失确认都会保留，不能用通过勾选抹去。</li></ol><p>本页数据保存在当前浏览器。浏览器存储受限或关闭页面前，请下载完整备份。不要存储不必要的个人敏感资料。</p><p>记录实际人工观察才是证据；合成演示、角色扮演和软件测试不证明现实服务履约。</p></div>', () => {}, '明白了', '操作说明 / 人工作业'));

try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) state = core.importProject(saved);
  render();
  $('#save-status').textContent = saved ? '已恢复本浏览器的活动记录' : '空白活动 · 尚未保存';
} catch (error) {
  render();
  $('#save-status').textContent = '本地记录未载入 · 原数据未覆盖';
  $('#save-status').className = 'error';
  notify(`本地记录无法读取：${error.message || '浏览器存储不可用'}。原记录没有自动覆盖。请导入有效备份；修改后保存会创建新的本地记录。`, true);
}
