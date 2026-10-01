import { DEFAULT_PROFILE, validateProfile, buildPlan, validateRecord, summarizeTrial, validateBackup, exportMarkdown } from './core.js';

const KEY = 'qigai-room-v1';
const $ = selector => document.querySelector(selector);
const costs = {materials:'材料与税费（元）',delivery:'配送与税运（元）',installation:'工具与安装（元）',energy:'使用能耗（元）',rework:'返工与恢复（元）',moving:'搬迁适配（元）'};
const labels = {eligible:'可试用 · 仍需现场核实',conditional:'待核实',excluded:'本档案不适用'};
const money = value => Number(value || 0).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const esc = value => String(value ?? '').replace(/[&<>"']/g,char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const empty = () => ({version:1,profile:null,selectedId:null,records:[],costOverrides:{},checklist:{},notes:'',relocation:null});
let state = empty();
let plan = null;

function notify(text,error = false) {
  $('#message').textContent = text;$('#message').classList.toggle('errors',error);$('#message').hidden = false;
}
function save() {
  try {localStorage.setItem(KEY,JSON.stringify(state));$('#save-status').textContent = `已保存到本机 · ${new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}`;}
  catch {$('#save-status').textContent = '本机保存不可用 · 请导出备份';notify('浏览器存储不可用或已满。当前仍可操作，请立即导出备份，刷新可能丢失。',true);}
}
function showTab(tab) {
  document.querySelectorAll('.panel').forEach(element => {element.hidden = element.id !== tab;});
  document.querySelectorAll('.tab').forEach(element => {const yes = element.dataset.tab === tab;element.classList.toggle('active',yes);if(yes) element.setAttribute('aria-current','step');else element.removeAttribute('aria-current');});
  if(tab === 'plan') renderPlan();if(tab === 'trial') renderRecords();if(tab === 'handoff') renderHandoff();
  window.scrollTo({top:0,behavior:'instant'});
}
function fillProfile(profile) {
  for(const element of $('#profile-form').elements) {if(!element.name) continue;if(element.type === 'checkbox') element.checked = profile[element.name] === true;else element.value = profile[element.name] ?? '';}
}
function readForm(form,base = {}) {
  const result = {...base};
  for(const element of form.elements) {if(!element.name) continue;result[element.name] = element.type === 'checkbox' ? element.checked : element.type === 'number' ? (element.value === '' ? null : Number(element.value)) : element.value.trim();}
  return result;
}
function showErrors(selector,result) {const node=$(selector);node.hidden=result.ok;node.textContent=result.errors?.join('；')||'';return !result.ok;}
function recompute() {
  if(!state.profile){plan=null;return;}plan=buildPlan(state.profile,state.costOverrides);
  if(plan.candidates.find(item=>item.id===state.selectedId)?.status!=='eligible') state.selectedId=null;
}
const selected = () => plan?.candidates.find(item=>item.id===state.selectedId);
const list = items => (items||[]).map(item=>`<li>${esc(item)}</li>`).join('');

function renderPlan() {
  if(!plan){$('#plan-content').innerHTML='<p class="empty">先完成房间档案，再查看适配结果。</p>';return;}
  const chosen=selected();
  $('#plan-content').innerHTML=`<div class="plan-meta"><div><small>当前房间</small><strong>${esc(state.profile.name)}</strong></div><div><small>窗宽 × 窗高（厘米）</small><strong>${state.profile.width} × ${state.profile.height}</strong></div><div><small>完整预算上限</small><strong>¥ ${money(state.profile.budget)}</strong></div></div>
  ${plan.warnings.length>2?`<div class="notice"><strong>行动前待核实</strong><ul>${list(plan.warnings.slice(2))}</ul></div>`:''}
  <details class="estimate-note"><summary>规划估算 · 费用口径与适配边界</summary><ul>${list(plan.warnings.slice(0,2))}</ul><p>所有费用均为可修改的人民币规划估算，尚未取得当地含税运报价。预算内仅表示当前假设可负担，不表示已适配、已采购或有温降保证。支架仍需核对窗深、承重和开启轨迹。</p></details>
  <div class="candidates">${plan.candidates.map(item=>`<article class="candidate ${item.status} ${state.selectedId===item.id?'selected':''}" data-id="${esc(item.id)}"><span class="badge ${item.status}">${labels[item.status]}</span><h3>${esc(item.title)}</h3><p>${esc(item.reason)}</p><span class="cost">¥ ${money(item.cost.total)}<small>含时间成本 / 规划估算</small></span><p>${esc(item.reuse)}</p>${item.status==='eligible'?`<button class="button ${state.selectedId===item.id?'primary':'secondary'}" data-select="${esc(item.id)}">采用此方案</button>`:'<span class="field-hint">先解决上述条件；不能采用待核实方案。</span>'}<button class="text-button" data-cost="${esc(item.id)}">查看 / 修改费用</button></article>`).join('')}</div>
  <div class="comparison"><h2>同一口径，比较完整成本</h2><div class="table-wrap"><table><thead><tr><th>方案</th><th>材料 / 税费</th><th>配送</th><th>工具 / 安装</th><th>能耗</th><th>返工 / 恢复</th><th>搬迁</th><th>总计</th></tr></thead><tbody>${plan.candidates.map(item=>`<tr><td>${esc(item.title)}</td>${Object.keys(costs).map(key=>`<td>¥${money(item.cost[key])}</td>`).join('')}<td>¥${money(item.cost.total)}</td></tr>`).join('')}</tbody></table></div></div><div id="cost-editor"></div>
  ${chosen?`<div class="detail"><span class="eyebrow">已采用 · ${esc(chosen.title)}</span><h2>先核对，再小步试用</h2><div class="detail-grid"><div class="detail-box"><h3>实施顺序</h3><ol>${list(chosen.steps)}</ol></div><div class="detail-box"><h3>停止与回退</h3><ol>${list(chosen.rollback)}</ol></div></div><p class="field-hint">${esc(chosen.evidence)}</p><h3>安装与验证检查表</h3>${[...plan.checklist,'试用后能正常开窗、通行，无松动、结露或新异常','体感未改善或变差时停止，按回退顺序恢复原状'].map((item,index)=>`<label class="task"><input type="checkbox" data-check="${esc(chosen.id)}:${index}" ${state.checklist[`${chosen.id}:${index}`]?'checked':''}>${esc(item)}</label>`).join('')}</div>`:'<p class="empty">选择一项可试用方案后，查看实施、回退和检查清单。</p>'}`;
  $('#plan-content').querySelectorAll('[data-select]').forEach(button=>button.addEventListener('click',()=>{state.selectedId=button.dataset.select;save();renderPlan();notify('已采用方案。先完成现场核实，再小步试用。');}));
  $('#plan-content').querySelectorAll('[data-cost]').forEach(button=>button.addEventListener('click',()=>renderCost(button.dataset.cost)));
  $('#plan-content').querySelectorAll('[data-check]').forEach(input=>input.addEventListener('change',()=>{state.checklist[input.dataset.check]=input.checked;save();}));
  if(chosen) renderCost(chosen.id,false);
}
function renderCost(id,focus=true) {
  const item=plan.candidates.find(candidate=>candidate.id===id);if(!item)return;
  $('#cost-editor').innerHTML=`<form id="cost-form" class="cost-editor"><fieldset><legend>修改成本 · ${esc(item.title)}</legend><p class="field-hint">全部项必须有数值，确认为零才填0。人工为机会成本，不是已支付费用。返工含拆除恢复、裁剪不可退和支持预留；搬迁含重新测量、配件与损耗。缺少报价时保留估算标记。</p><div class="form-grid">${Object.entries(costs).map(([key,label])=>`<label>${label}<input type="number" name="${key}" min="0" max="1000000" step="0.01" value="${Number(item.cost[key]).toFixed(2)}" required></label>`).join('')}</div><p class="cost-total">当前估算总计<strong>¥ ${money(item.cost.total)}</strong></p><div id="cost-errors" class="errors" role="alert" hidden></div><button class="button primary" type="submit">更新成本</button><button class="text-button" type="button" id="reset-cost">恢复规划估算</button></fieldset></form>`;
  $('#cost-form').addEventListener('submit',event=>{event.preventDefault();const updated=readForm(event.currentTarget);if(Object.values(updated).some(value=>typeof value!=='number'||!Number.isFinite(value)||value<0||value>1000000)){showErrors('#cost-errors',{ok:false,errors:['全部费用必须为0至1000000之间的金额。']});return;}state.costOverrides[id]=updated;recompute();save();renderPlan();renderCost(id,false);notify('费用已更新，预算适配已重算。超预算方案不会保持已采用状态。');});
  $('#reset-cost').addEventListener('click',()=>{delete state.costOverrides[id];recompute();save();renderPlan();renderCost(id,false);});
  if(focus) $('#cost-editor').scrollIntoView({block:'start',behavior:'smooth'});
}
function summaryText(summary) {
  const lines=[summary.message];
  if(summary.before&&summary.after) {
    for(const [label,data] of [['改善前',summary.before],['改善后',summary.after]]) {
      const n=data.count??data.n??0;const t=data.temperature??data.meanTemperature;const feel=data.sensation??data.meanSensation;
      lines.push(`${label}：${n}条记录${t!=null?`，平均空气温度${Number(t).toFixed(1)}℃`:''}${feel!=null?`，平均体感${Number(feel).toFixed(1)}`:''}`);
    }
  }
  if(summary.deltaTemperature!=null) lines.push(`后减前空气温度差：${Number(summary.deltaTemperature).toFixed(1)}℃（仅描述）`);
  if(summary.deltaSensation!=null) lines.push(`后减前体感差：${Number(summary.deltaSensation).toFixed(1)}（仅描述）`);
  if(summary.warnings) lines.push(...summary.warnings);
  if(state.profile?.goal==='glare') lines.push('当前目标为眩光：热体感评分仅供旁观，请在备注记录同一任务、光照和遮挡条件下的眩光变化，不能用热体感判断遮光成效。');
  lines.push('前后观察不能证明因果。若体感变差、出现湿损或松动，停止试用并恢复原状。');
  return lines.filter(Boolean).join('\n');
}
function renderRecords() {
  $('#trial-summary').innerHTML=`<div class="trial-summary"><h3>当前观察</h3><pre>${esc(summaryText(summarizeTrial(state.records,0)))}</pre></div>`;
  $('#records-body').innerHTML=state.records.length?state.records.map(item=>`<tr><td>${esc(item.date.replace('T',' '))}<br>${item.phase==='before'?'改善前':'改善后'}</td><td>${item.temperature}℃ / ${item.humidity}%</td><td>${item.sensation}</td><td>${item.outdoor??'未测'} / ${item.radiation??'未测'}</td><td>${esc(item.note)}</td><td><button class="text-button" data-delete="${esc(item.id)}">删除记录</button></td></tr>`).join(''):'<tr><td colspan="6">尚无记录。请输入现场观察；示例档案不会生成实测日记。</td></tr>';
  $('#records-body').querySelectorAll('[data-delete]').forEach(button=>button.addEventListener('click',()=>{state.records=state.records.filter(item=>item.id!==button.dataset.delete);save();renderRecords();}));
}
function renderHandoff() {
  $('#handoff-notes').value=state.notes;
  if(!state.profile){$('#move-content').innerHTML='<p class="empty">先建立房间档案，再生成搬迁与交接结果。</p>';return;}
  const item=selected(),next=state.relocation,nextPlan=next?buildPlan(next):null;
  $('#move-content').innerHTML=`<div class="move-result"><h3>当前方案 · ${esc(item?.title||'尚未采用方案')}</h3><p>${esc(item?.move||'采用可试用方案后查看搬迁要点。')}</p><p>${esc(item?.reuse||'可拆卸不等于必然可复用。')}</p><p>旧房档案、成本与观察会保留。新房许可、通风、逃生与玻璃兼容需重新核实。</p></div>
  <form id="move-form" class="move-form"><fieldset><legend>下一处房间再适配</legend><div class="form-grid"><label>下一处窗宽（厘米）<input name="width" type="number" min="20" max="400" step="0.1" value="${next?.width??state.profile.nextWidth??''}" required></label><label>下一处窗高（厘米）<input name="height" type="number" min="20" max="400" step="0.1" value="${next?.height??state.profile.nextHeight??''}" required></label><label>下一处安装权限<select name="permission"><option value="none">未确认 / 不钻孔、不胶粘</option><option value="adhesive">已确认允许胶粘</option><option value="drill">已确认允许钻孔</option></select></label><label>下一处表面状态<select name="surface"><option value="unknown">尚未确认</option><option value="sound">稳固完好</option><option value="fragile">脆弱或易脱漆</option></select></label><label>下一处窗型<select name="windowType"><option value="sliding">推拉窗</option><option value="casement">平开窗</option><option value="fixed">固定窗</option></select></label><label>下一处特殊风险<select name="risk"><option value="none">未发现下列异常</option><option value="damp">潮湿、渗水或霉斑</option><option value="hot">持续过热或热不适</option><option value="electrical">电气异常</option></select></label></div><div class="check-row"><label><input name="escape" type="checkbox" checked>逃生用途是 / 尚未确认</label><label><input name="ventilation" type="checkbox" checked>主要通风是 / 尚未确认</label><label><input name="safetyConfirmed" type="checkbox">新房通风、逃生与燃烧设备条件已核实</label></div><p class="field-hint">预算与使用时长沿用当前规划作比较，报价不沿用；玻璃兼容默认未知。宽高不能独自证明完整适配。</p><div id="move-errors" class="errors" role="alert" hidden></div><button class="button primary" type="submit">重新核对搬迁适配</button></fieldset></form>
  ${nextPlan?`<div class="move-result"><h3>新房再适配结果 · ${next.width} × ${next.height}厘米</h3><ul>${list(nextPlan.warnings)}</ul><div class="table-wrap"><table><thead><tr><th>方案</th><th>新房状态</th><th>适配 / 复用原因</th><th>估算总计</th></tr></thead><tbody>${nextPlan.candidates.map(candidate=>`<tr><td>${esc(candidate.title)}</td><td>${labels[candidate.status]}</td><td>${esc(candidate.reason)} ${esc(candidate.reuse)}</td><td>¥${money(candidate.cost.total)}</td></tr>`).join('')}</tbody></table></div><p>暂未发生真实搬迁或移装；此处是输入条件下的重评，不是复用保证。</p></div>`:''}`;
  const form=$('#move-form');
  if(next){['permission','surface','windowType','risk'].forEach(key=>{form.elements[key].value=next[key];});['escape','ventilation','safetyConfirmed'].forEach(key=>{form.elements[key].checked=next[key]===true;});}
  form.addEventListener('submit',event=>{event.preventDefault();const profile=readForm(form,{...state.profile,name:`${state.profile.name.slice(0,65)} · 下一处`,surface:'unknown',permission:'none',glass:'unknown',safetyConfirmed:false,filmCompatible:false,temperature:null,humidity:null,nextWidth:null,nextHeight:null});if(showErrors('#move-errors',validateProfile(profile)))return;state.relocation=profile;save();renderHandoff();notify('已重评新房，旧房记录完整保留。新房未确认条件仍待核实。');});
}
function download(filename,text,type) {const url=URL.createObjectURL(new Blob([text],{type}));const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
function ready() {if(!state.profile){notify('请先完成房间档案并生成方案。',true);return false;}return true;}
document.querySelectorAll('.tab').forEach(button=>button.addEventListener('click',()=>showTab(button.dataset.tab)));
$('#sample').addEventListener('click',()=>{fillProfile({...DEFAULT_PROFILE,name:'朝西小卧室 · 构造示例'});notify('已填入构造示例，尚未写入档案或日记。请修改为现场信息后生成方案。');});
$('#profile-form').addEventListener('submit',event=>{event.preventDefault();const profile=readForm(event.currentTarget);if(showErrors('#profile-errors',validateProfile(profile)))return;if(state.profile&&JSON.stringify(state.profile)!==JSON.stringify(profile)) state.checklist={};state.profile=profile;recompute();save();showTab('plan');notify('房间档案已更新。请比较不采购路径、待核实条件和完整成本。');});
$('#record-form').addEventListener('submit',event=>{event.preventDefault();if(!ready())return;if(state.records.length>=500){notify('最多保留500条记录。请先导出再整理。',true);return;}const record=readForm(event.currentTarget,{id:crypto.randomUUID()});record.sensation=Number(record.sensation);if(showErrors('#record-errors',validateRecord(record)))return;state.records.push(record);save();renderRecords();event.currentTarget.elements.note.value='';notify('观察已保存。前后变化仅是描述，不能证明方案的实际效果。');});
$('#handoff-notes').addEventListener('input',event=>{state.notes=event.target.value;save();});
$('#export-json').addEventListener('click',()=>{if(ready())download('栖改-完整备份.json',JSON.stringify(state,null,2),'application/json;charset=utf-8');});
$('#export-markdown').addEventListener('click',()=>{if(ready())download('栖改-房间改善交接单.md',exportMarkdown(state),'text/markdown;charset=utf-8');});
$('#print').addEventListener('click',()=>{if(!ready())return;$('#print-sheet').innerHTML=`<pre class="print-text">${esc(exportMarkdown(state))}</pre>`;window.print();});
$('#import-json').addEventListener('change',async event=>{const file=event.target.files[0];if(!file)return;try{if(file.size>1024*1024)throw new Error('备份超过1MB上限。');const result=validateBackup(JSON.parse(await file.text()));if(!result.ok)throw new Error(`备份无效：${result.errors.join('；')}`);state=result.value;state.relocation??=null;recompute();fillProfile(state.profile);save();showTab('handoff');notify(`备份已恢复，保留${state.records.length}条观察记录。`);}catch(error){notify(`恢复失败，现有档案未被覆盖。${error.message}`,true);}finally{event.target.value='';}});
$('#clear-data').addEventListener('click',()=>{if(!confirm('清空此浏览器内的全部房间档案、成本与观察？请先导出备份。此操作无法撤销。'))return;try{localStorage.removeItem(KEY);}catch{notify('浏览器存储无法清除。请在浏览器设置中清理本站数据。',true);return;}state=empty();plan=null;fillProfile({...DEFAULT_PROFILE,name:''});showTab('profile');$('#save-status').textContent='本机档案已清空';notify('本机数据已清空。有效备份可在搬迁与交接页恢复。');});

fillProfile({...DEFAULT_PROFILE,name:''});
const date=new Date();date.setMinutes(date.getMinutes()-date.getTimezoneOffset());$('#record-form').elements.date.value=date.toISOString().slice(0,16);
try{const text=localStorage.getItem(KEY);if(text){const data=JSON.parse(text),result=validateBackup(data);if(result.ok){state=result.value;state.relocation??=null;recompute();fillProfile(state.profile);$('#save-status').textContent='已恢复本机档案';}else if(data.profile!==null)notify('本机档案无效，保留原数据且未自动覆盖。请使用完整备份恢复。',true);}}
catch{notify('本机存储不可读或档案损坏。当前可新建档案；请导出备份防止丢失。',true);}
renderRecords();
