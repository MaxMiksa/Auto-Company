import {validateTrip, planTrip, serializeTrip, parseTrip} from './core.js';

const $ = (selector) => document.querySelector(selector);
const STORAGE = 'rest-rhythm-draft-v1';
const form = $('#trip-form');
let result = null;
let plannedTrip = null;
let completed = new Set();
let restoring = false;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function field(label, name, value = '', type = 'text', options = {}) {
  const wrap = node('label', label);
  const input = node(type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input');
  input.name = name;
  if (input.tagName === 'INPUT') input.type = type;
  if (type === 'select') options.values.forEach(([v, t]) => { const option = node('option', t); option.value = v; input.append(option); });
  else if (type === 'number') {input.min = options.min ?? 0; input.max = options.max ?? 240;}
  else if (type !== 'time' && type !== 'date') input.maxLength = type === 'textarea' ? 1000 : 300;
  input.value = value;
  wrap.append(input);
  return wrap;
}
function checkbox(label, name, checked) {
  const wrap = node('label', undefined, 'check');
  const input = node('input'); input.type = 'checkbox'; input.name = name; input.checked = !!checked;
  wrap.append(input, document.createTextNode(label)); return wrap;
}
function pair(...children) {const grid = node('div', undefined, 'fields'); grid.append(...children); return grid;}
function details(title, ...children) {const d = node('details'); d.append(node('summary',title), ...children); return d;}
function card(parent, title, removable = true) {
  const element = node('div', undefined, 'input-card');
  const head = node('div', undefined, 'card-header'); head.append(node('h3', title));
  if (removable) {const b = node('button','移除','remove'); b.type='button'; b.setAttribute('aria-label', `移除${title}`); b.addEventListener('click',()=>{if(parent.id==='activities'&&completed.has(element.dataset.id))return showErrors(['这项活动已经完成，不能直接移除。请先在随身页明确取消它的完成标记，再移除或添加替代活动。']);element.remove(); invalidate();}); head.append(b);}
  element.append(head); parent.append(element); return element;
}
function addPerson(person = {}) {
  if ($('#people').children.length >= 4) return showErrors(['最多支持4位同行人。']);
  const c = card($('#people'), `同行人 ${$('#people').children.length + 1}`);
  c.append(field('称呼','name',person.name ?? '我'), pair(field('连续活动上限 / 分钟','maxActive',person.maxActive ?? 45,'number',{min:5,max:240}),field('每次恢复至少 / 分钟','restMinutes',person.restMinutes ?? 20,'number',{min:5,max:120})), checkbox('必须能坐下','needsSeat',person.needsSeat ?? true),checkbox('必须独处','needsAlone',person.needsAlone),checkbox('避开昏暗环境','avoidDim',person.avoidDim),checkbox('必须安静','needsQuiet',person.needsQuiet));
}
function addActivity(activity = {}) {
  if ($('#activities').children.length >= 20) return showErrors(['最多支持20项活动。请拆成多天手账。']);
  const c = card($('#activities'), `活动 ${$('#activities').children.length + 1}`);
  c.dataset.id = activity.id || crypto.randomUUID();
  c.append(field('活动名称','name',activity.name),pair(field('活动时长 / 分钟','duration',activity.duration ?? 30,'number',{min:1,max:600}),field('抵达此站的转场 / 分钟','travelMinutes',activity.travelMinutes ?? 10,'number')),pair(checkbox('想保留的必选活动','required',activity.required ?? true),checkbox('室内活动','indoor',activity.indoor ?? true)),details('开放时段与资料',pair(field('最早开始','opens',activity.opens ?? '09:00','time'),field('最晚离开','closes',activity.closes ?? '18:00','time')),field('活动来源网址','source',activity.source),field('活动备注','notes',activity.notes,'textarea')));
}
const recoveryDefaults = {name:'',travelMinutes:5,seat:'unknown',alone:'unknown',light:'unknown',noise:'unknown',source:'',verifiedAt:'',notes:''};
function renderRecovery(container, recovery = {}, title) {
  const r = {...recoveryDefaults,...recovery}; container.replaceChildren();
  const c = card(container,title,false);
  const yesNo = [['unknown','未知，待核验'],['yes','符合（个人准备假设）'],['no','不符合']];
  c.append(field('恢复地点名称','name',r.name),field('活动到此处的保守单程 / 分钟','travelMinutes',r.travelMinutes,'number'),pair(field('坐下条件','seat',r.seat,'select',{values:yesNo}),field('独处条件','alone',r.alone,'select',{values:yesNo})),pair(field('光照条件','light',r.light,'select',{values:[['unknown','未知，待核验'],['normal','正常光照'],['dim','昏暗']]}),field('噪声条件','noise',r.noise,'select',{values:[['unknown','未知，待核验'],['quiet','安静（准备假设）'],['busy','嘈杂']]})),details('恢复来源与核验记录',field('恢复来源网址','source',r.source),field('核验日期','verifiedAt',r.verifiedAt,'date'),field('核验备注','notes',r.notes,'textarea')));
}
function value(c,name) {return c.querySelector(`[name="${name}"]`).value;}
function readCard(c, schema) {const out={};for(const [key,type] of Object.entries(schema)){const i=c.querySelector(`[name="${key}"]`);out[key]=type==='number'?Number(i.value):type==='boolean'?i.checked:i.value.trim();}return out;}
const personSchema={name:'string',maxActive:'number',restMinutes:'number',needsSeat:'boolean',needsAlone:'boolean',avoidDim:'boolean',needsQuiet:'boolean'};
const activitySchema={name:'string',duration:'number',travelMinutes:'number',required:'boolean',indoor:'boolean',opens:'string',closes:'string',source:'string',notes:'string'};
const recoverySchema={name:'string',travelMinutes:'number',seat:'string',alone:'string',light:'string',noise:'string',source:'string',verifiedAt:'string',notes:'string'};
function readTrip() {
  return {title:value(form,'title').trim(),city:value(form,'city').trim(),date:value(form,'date'),origin:value(form,'origin').trim(),start:value(form,'start'),end:value(form,'end'),people:[...$('#people').children].map(c=>readCard(c,personSchema)),activities:[...$('#activities').children].map(c=>({...readCard(c,activitySchema),id:c.dataset.id})),recovery:readCard($('#recovery'),recoverySchema),backupRecovery:$('#use-backup').checked?readCard($('#backup-recovery'),recoverySchema):null,exit:{name:value(form,'exitName').trim(),travelMinutes:Number(value(form,'exitTravel')),notes:value(form,'exitNotes').trim()}};
}
function fillTrip(trip) {
  restoring=true;
  for (const key of ['title','city','date','origin','start','end']) form.elements[key].value=trip[key]??'';
  form.elements.exitName.value=trip.exit.name; form.elements.exitTravel.value=trip.exit.travelMinutes;form.elements.exitNotes.value=trip.exit.notes??'';
  $('#people').replaceChildren();trip.people.forEach(addPerson);
  $('#activities').replaceChildren();trip.activities.forEach(addActivity);
  renderRecovery($('#recovery'),trip.recovery,'主要恢复地点');
  $('#use-backup').checked=!!trip.backupRecovery;$('#backup-recovery').hidden=!trip.backupRecovery;
  renderRecovery($('#backup-recovery'),trip.backupRecovery??{},'备用恢复地点');
  completed.clear();resetDisruptions();$('#disruptions').hidden=true;
  restoring=false;hideErrors();invalidate();
}
function showErrors(errors) {const box=$('#errors');box.replaceChildren(node('strong','请先调整这些输入'));const ul=node('ul');errors.forEach(e=>ul.append(node('li',e)));box.append(ul);box.hidden=false;box.scrollIntoView({block:'nearest',behavior:'smooth'});}
function hideErrors() {$('#errors').hidden=true;}
function message(text) {$('#save-status').textContent=text;}
function invalidate() {
  if(restoring)return;
  const showChanges=!$('#disruptions').hidden||hasSession();
  result=null;plannedTrip=null;
  const out=$('#plan-output');out.replaceChildren();out.hidden=!showChanges;$('#empty-state').hidden=showChanges;$('#disruptions').hidden=!showChanges;$('#plan-title').textContent='输入已调整，请重新编排。';
  if(showChanges){const notice=node('div',undefined,'notice');notice.append(node('strong','旧时间轴已失效'),node('p','已完成记录与现场调整仍保留。修改已有活动名称视为同一活动的资料更正；更换目标请添加新活动。请重新编排余下安排。'));out.append(notice);renderCompleted(out,readTrip());}
  message('输入尚未保存；已完成记录与现场调整保留。编排或点击保存草稿后保存在本机。');
}
function disruption() {return {now:$('#now').value,delayMinutes:Number($('#delay').value),rain:$('#rain').checked,unavailableRecovery:$('#unavailable').checked,earlyEnd:$('#early-end').value,completedIds:[...completed]};}
function hasSession() {const s=disruption();return !!(s.completedIds.length||s.now||s.delayMinutes||s.rain||s.unavailableRecovery||s.earlyEnd);}
function confirmReplacement() {return !hasSession()||window.confirm('载入另一份手账会替换当前输入、已完成记录和全部现场调整。是否继续？建议先导出JSON备份。');}
function resetDisruptions() {$('#now').value='';$('#delay').value='0';$('#rain').checked=false;$('#unavailable').checked=false;$('#early-end').value='';}
function saveDraft(trip = readTrip(), withSession=true) {
  const errors=validateTrip(trip); if(errors.length){showErrors(errors);return false;}
  try {const packed=JSON.parse(serializeTrip(trip));packed.session=withSession?disruption():{};packed.origin=trip.origin??'';localStorage.setItem(STORAGE,JSON.stringify(packed));message('草稿已保存在当前浏览器。建议导出JSON保留独立备份。');return true;} catch {message('浏览器无法保存草稿。请导出JSON备份，当前输入仍可使用。');return false;}
}
function restorePayload(text, shouldPlan=true, confirm=false) {
  const trip=parseTrip(text);const raw=JSON.parse(text);trip.origin=typeof raw.origin==='string'?raw.origin.slice(0,100):trip.origin??'';
  const s=raw.session??{};
  if(typeof s!=='object'||Array.isArray(s)||s===null)throw new Error('现场调整格式不正确。');
  const ids=s.completedIds??[];
  if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'||!trip.activities.some(a=>a.id===id)))throw new Error('已完成活动记录不正确。');
  if(s.delayMinutes!==undefined&&(!Number.isInteger(s.delayMinutes)||s.delayMinutes<0||s.delayMinutes>240))throw new Error('延误分钟必须为0到240的整数。');
  for(const k of ['rain','unavailableRecovery'])if(s[k]!==undefined&&typeof s[k]!=='boolean')throw new Error('现场调整选项必须为是或否。');
  for(const k of ['now','earlyEnd'])if(s[k]&&!(typeof s[k]==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(s[k])))throw new Error('现场调整时间格式不正确。');
  // Validate a complete plan before replacing the current editable draft.
  planTrip(trip,{...s,completedIds:ids});
  if(confirm&&!confirmReplacement())return false;
  fillTrip(trip);completed=new Set(ids);$('#now').value=s.now??'';$('#delay').value=s.delayMinutes??0;$('#rain').checked=!!s.rain;$('#unavailable').checked=!!s.unavailableRecovery;$('#early-end').value=s.earlyEnd??'';
  invalidate();
  if(shouldPlan)generate(false);
  return true;
}
function generate(save=true) {
  const trip=readTrip();const errors=validateTrip(trip);if(errors.length){showErrors(errors);return;}
  const changes=disruption();
  if(!Number.isInteger(changes.delayMinutes)||changes.delayMinutes<0||changes.delayMinutes>240)return showErrors(['额外延误必须为0到240的整数分钟。']);
  if(completed.size&&!changes.now)return showErrors(['已标记完成活动，请填写当前时间后重排，避免从原出发时间重新计算。']);
  try {result=planTrip(trip,changes);plannedTrip=trip;hideErrors();renderPlan();if(save)saveDraft(trip);}catch(e){showErrors([e.message || '无法编排，请检查输入。']);}
}
function sourceLink(url,label) {try{const u=new URL(url);if(!['http:','https:'].includes(u.protocol))return node('span',`${label}：未提供有效公开网址`);const a=node('a',label,'source-link');a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';return a;}catch{return node('span',`${label}：未提供公开网址`);}}
function renderPlan() {
  const trip=plannedTrip;const out=$('#plan-output');out.replaceChildren();out.hidden=false;$('#empty-state').hidden=true;$('#disruptions').hidden=false;
  $('#plan-title').textContent=`${trip.city} · ${trip.title}`;
  const statuses={ready:'节奏可编排 · 现场仍需确认',partial:'部分目标未完成',blocked:'存在未满足条件'};
  const strip=node('div',undefined,'summary-strip');strip.append(node('span',`${trip.date} / ${trip.start}—${trip.end}`,'pill'),node('span',statuses[result.summary.status]??'需要检查','pill'+(result.summary.status==='ready'?'':' alert')),node('span',`连续活动 ≤ ${result.summary.activeLimit} 分钟 · 恢复 ≥ ${result.summary.restMinutes} 分钟`,'pill'));out.append(strip);
  const note=node('div',undefined,'notice');note.append(node('strong','出发前与现场确认'),node('p','转场为输入估计；地点、空座、独处与噪声仍需现场核实。'));const ul=node('ul');result.warnings.slice(2).forEach(w=>ul.append(node('li',w)));if(ul.childElementCount)note.append(ul);const scope=node('details',undefined,'planning-note');scope.append(node('summary','编排依据与转场口径'));const scopeList=node('ul');result.warnings.slice(0,2).forEach(w=>scopeList.append(node('li',w)));scope.append(scopeList);note.append(scope);out.append(note);
  if(result.unmet.length){const box=node('div',undefined,'unmet');box.append(node('strong','未满足 / 未完成目标'));const list=node('ul');result.unmet.forEach(x=>list.append(node('li',x)));box.append(list,node('p','可调整：核验或替换恢复点、缩短活动/转场、延长可用时段，或减少可选活动后重新编排。必选目标仍保留在输入中。'));out.append(box);}
  renderCompleted(out,trip);
  const list=node('ol',undefined,'timeline');result.timeline.forEach((step,index)=>{const li=node('li',undefined,`step ${step.type}${step.type==='recovery'?' rest':''}`);const time=node('time',step.start);const content=node('div',undefined,'step-body');content.append(node('h3',step.name),node('p',`${step.start}—${step.end} · ${step.duration} 分钟`));if(step.notes)content.append(node('p',Array.isArray(step.notes)?step.notes.join('；'):step.notes));const activity=trip.activities.find(a=>a.id===step.activityId);if(activity&&step.type==='activity'){if(!result.timeline.slice(index+1).some(s=>s.type==='activity'&&s.activityId===step.activityId))content.append(completionControl(activity));if(activity.source)content.append(sourceLink(activity.source,'查看活动来源'));}li.append(time,content);list.append(li);});out.append(list);
  const sources=node('div',undefined,'sources-note');sources.append(node('p',`出发：${trip.origin||'未填写出发地点'}；返回：${trip.exit.name}。转场估计由你填写。`));for(const r of [trip.recovery,trip.backupRecovery].filter(Boolean)){sources.append(node('p',`${r.name} · 核验日期：${r.verifiedAt||'未记录'} · ${r.notes||'未填写核验备注'}`),sourceLink(r.source,'查看恢复来源'));}out.append(sources);
}
function renderCompleted(out,trip) {if(!completed.size)return;const box=node('div',undefined,'sources-note');box.append(node('strong','已经完成（不会重复安排）'));trip.activities.filter(a=>completed.has(a.id)).forEach(a=>{box.append(node('p',a.name),completionControl(a));});out.append(box);}
function completionControl(activity) {const wrap=checkbox(`完成：${activity.name}`,'completed',completed.has(activity.id));wrap.querySelector('input').addEventListener('change',e=>{if(e.target.checked)completed.add(activity.id);else completed.delete(activity.id);$('#export-status').textContent='已更新完成记录；填写当前时间后重排余下安排。';if(!result)invalidate();saveDraft(readTrip());});return wrap;}
function download(name,text,type) {const url=URL.createObjectURL(new Blob([text],{type}));const a=node('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('#export-status').textContent=`已导出 ${name}`;}
function exportJSON() {const trip=readTrip();const errors=validateTrip(trip);if(errors.length)return showErrors(errors);const packed=JSON.parse(serializeTrip(trip));packed.session=disruption();packed.origin=trip.origin;download('缓步-旅行备份.json',JSON.stringify(packed,null,2),'application/json');}
function handoutText() {const t=plannedTrip;return [`# ${t.city} · ${t.title}`,`${t.date} | ${t.start}—${t.end}`,`出发：${t.origin||'未填写'} | 返回：${t.exit.name}`,`同行：${t.people.map(p=>`${p.name}（活动${p.maxActive}分钟/恢复${p.restMinutes}分钟）`).join('、')}`,'','## 当前时间轴',...result.timeline.map(s=>`${s.start}—${s.end} ${s.name}（${s.duration}分钟）\n${Array.isArray(s.notes)?s.notes.join('；'):s.notes??''}`),'','## 已经完成',...t.activities.filter(a=>completed.has(a.id)).map(a=>a.name),'','## 未满足 / 未完成',...(result.unmet.length?result.unmet:['没有已识别的编排冲突；现实环境仍待确认。']),'','## 出发前与现场确认','转场为输入估计。设施存在不保证空座、独处或现场噪声。',...result.warnings,'','## 恢复依据',...[t.recovery,t.backupRecovery].filter(Boolean).map(r=>`${r.name} | ${r.source||'无来源'} | 核验：${r.verifiedAt||'未记录'}\n${r.notes||''}`),'','## 回程',`${t.exit.name} | 预留 ${t.exit.travelMinutes} 分钟\n${t.exit.notes||''}`].join('\n');}
const sample={title:'慢一点，探索博物馆',city:'示例城市（构造资料）',date:new Date().toISOString().slice(0,10),origin:'示例住宿处',start:'10:00',end:'15:30',people:[{name:'我',maxActive:45,restMinutes:20,needsSeat:true,needsAlone:false,avoidDim:false,needsQuiet:false},{name:'同行人',maxActive:60,restMinutes:15,needsSeat:true,needsAlone:false,avoidDim:false,needsQuiet:false}],activities:[{id:'sample-minerals',name:'看矿物展（构造活动）',duration:30,travelMinutes:5,required:true,indoor:true,opens:'10:00',closes:'17:00',source:'',notes:'资料为构造样例，不对应真实开放信息。'},{id:'sample-garden',name:'河边花园（构造活动）',duration:25,travelMinutes:10,required:false,indoor:false,opens:'09:00',closes:'17:00',source:'',notes:''},{id:'sample-flight',name:'看航空展（构造活动）',duration:30,travelMinutes:10,required:true,indoor:true,opens:'10:00',closes:'17:00',source:'',notes:''}],recovery:{...recoveryDefaults,name:'示例休息处（非真实核验）',travelMinutes:3,seat:'yes',alone:'no',light:'normal',noise:'unknown',notes:'仅演示恢复编排；现实空座未观察。'},backupRecovery:{...recoveryDefaults,name:'示例备用休息处（非真实核验）',travelMinutes:5,seat:'yes',light:'normal',notes:'备用点同为构造资料。'},exit:{name:'示例住宿处',travelMinutes:15,notes:'现场不适时停止探索，按自己核实的交通路线返回。'}};

$('#add-person').addEventListener('click',()=>{addPerson();invalidate();});$('#add-activity').addEventListener('click',()=>{addActivity();invalidate();});
$('#use-backup').addEventListener('change',e=>{$('#backup-recovery').hidden=!e.target.checked;});
form.addEventListener('input',()=>invalidate());form.addEventListener('change',()=>invalidate());form.addEventListener('submit',e=>{e.preventDefault();generate();});
$('#sample').addEventListener('click',()=>{if(!confirmReplacement())return;fillTrip(structuredClone(sample));message('已载入构造示例，替换原输入与现场调整。这不是实际旅行或核验记录。点击编排查看结果。');});
$('#save').addEventListener('click',()=>saveDraft());
$('#restore').addEventListener('click',()=>{try{const text=localStorage.getItem(STORAGE);if(!text)return message('没有已保存草稿。');if(restorePayload(text,true,true))message('已用保存的草稿及其现场调整替换当前手账。');}catch(e){showErrors([`无法恢复草稿：${e.message}。当前输入仍保留，可用JSON备份导入。`]);}});
$('#clear').addEventListener('click',()=>{try{localStorage.removeItem(STORAGE);message('已清空本地保存；当前编辑内容仍保留。');}catch{message('浏览器阻止清空。可通过浏览器设置清除站点数据。');}});
$('#replan').addEventListener('click',()=>generate());$('#reset-changes').addEventListener('click',()=>{resetDisruptions();completed.clear();invalidate();generate();});
$('#export-json').addEventListener('click',exportJSON);$('#export-text').addEventListener('click',()=>{if(!result)return showErrors(['请先编排，才能导出当前手账。']);download('缓步-随身手账.md',handoutText(),'text/markdown;charset=utf-8');});$('#print').addEventListener('click',()=>{if(!result)return showErrors(['请先编排，才能打印当前手账。']);window.print();});
$('#import').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{if(f.size>500000)throw new Error('文件超过500KB，请选择正常的手账JSON。');if(restorePayload(await f.text(),true,true)){saveDraft(readTrip());$('#export-status').textContent='已导入并编排手账，使用备份内的完成记录与现场调整。';}}catch(err){showErrors([`导入失败：${err.message}。当前输入未被替换。`]);}finally{e.target.value='';}});
$('#help-toggle').addEventListener('click',e=>{const hidden=!$('#help').hidden;$('#help').hidden=hidden;e.currentTarget.setAttribute('aria-expanded',String(!hidden));});
form.elements.date.value=new Date().toISOString().slice(0,10);addPerson();addActivity();renderRecovery($('#recovery'),{},'主要恢复地点');renderRecovery($('#backup-recovery'),{},'备用恢复地点');
try{const saved=localStorage.getItem(STORAGE);if(saved){restorePayload(saved);message('已自动恢复本机草稿与现场调整。');}}catch(e){message(`已有草稿损坏或存储不可用：${e.message}。可继续填写，或导入独立JSON备份。`);}
