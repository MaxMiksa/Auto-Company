import {parseCSV, audit, demoConfig, toCSV} from './engine.js';

const $ = (selector) => document.querySelector(selector);
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusText = {pass:'所给材料通过', fail:'发现异常', unknown:'不可判定'};
const typeText = {text:'文本 · 去首尾空白',email:'邮箱 · 忽略大小写',money:'金额 · 精确十进制',date:'日期 · 统一年月日'};
const issueText = {'empty-key':'空身份','duplicate-key':'重复身份','missing-record':'遗漏记录','extra-record':'新增记录','field-mismatch':'字段差异','invalid-field':'非法字段','currency-mismatch':'币种差异','orphan-relationship':'孤儿关联','duplicate-relationship':'重复关联','missing-relationship':'遗漏关联','extra-relationship':'新增或错挂关联'};
const state = {objects:[], relationships:[], report:null, revision:0, pending:0, counter:0};
const nextID = () => `card-${++state.counter}`;
const blank = (name) => ({id:nextID(),name,source:null,target:null,key:{source:'',target:''},fields:[],currency:{source:'',target:''},files:{},drafts:{},dirty:{},pasteOpen:{}});
const blankRelation = () => ({id:nextID(),name:'联系人与交易关联',source:null,target:null,from:{object:'',source:'',target:''},to:{object:'',source:'',target:''},role:{source:'',target:''},files:{},drafts:{},dirty:{},pasteOpen:{}});
const error = (message='') => {$('#error').textContent = message; $('#error').hidden = !message;};
const emptyReport = '<div class="empty-report"><span>03 / 验收与交接</span><h2>这里将呈现你的验收依据</h2><p>请导入数据并生成证据。所有变更都需要重新核验。</p></div>';
function invalidate(){state.revision++; state.report=null; $('#report').innerHTML=emptyReport; $('#working-state').textContent='材料或口径已更新，请重新生成证据'; error();}
function options(headers=[], selected='', placeholder='请选择字段') {
  return `<option value="">${escape(placeholder)}</option>` + headers.map(h=>`<option value="${escape(h)}" ${h===selected?'selected':''}>${escape(h)}</option>`).join('');
}
function fileBox(card,side){
  const label=side==='source'?'源数据':'目标数据', info=card.files[side];
  const materialInfo=card.dirty[side]?'粘贴内容尚未应用，请点击应用粘贴内容':info?`${escape(info.name)} · ${card[side]?.rows.length??0} 行 · ${card[side]?.headers.length??0} 列`:'尚未提供材料';
  return `<div class="file-box"><label class="file-label">${label} CSV<span class="file-choose">选择 CSV 文件</span><input type="file" accept=".csv,text/csv" data-side="${side}" aria-label="${escape(card.name)}${label} CSV"></label><div class="file-info">${materialInfo}</div><details data-paste-panel="${side}" ${card.pasteOpen[side]?'open':''}><summary>或粘贴 CSV 文本</summary><textarea data-paste="${side}" aria-label="${escape(card.name)}${label} CSV 文本" placeholder="id,name&#10;001,张三">${escape(card.drafts[side]??'')}</textarea><button class="quiet" data-action="parse-paste" data-side="${side}">应用粘贴内容</button></details></div>`;
}
function fieldRow(card,field,index){
  return `<div class="mapping-row" data-field="${index}"><label class="mapping-label">源字段<select data-field-prop="source">${options(card.source?.headers,field.source)}</select></label><label class="mapping-label">目标字段<select data-field-prop="target">${options(card.target?.headers,field.target)}</select></label><label class="mapping-label">比较方式<select data-field-prop="type">${Object.entries(typeText).map(([k,v])=>`<option value="${k}" ${field.type===k?'selected':''}>${v}</option>`).join('')}</select></label><label class="mapping-label">目标值 → 源值 JSON<input data-field-prop="mapText" value="${escape(field.mapText??(field.map?JSON.stringify(field.map):''))}" placeholder='例如 {"active":"A"}'></label><button data-action="remove-field" aria-label="删除字段映射">×</button>${field.type==='money'?`<label class="mapping-label">金额允许小数位<input type="number" data-field-prop="precision" min="0" max="8" value="${field.precision??2}"></label>`:''}</div>`;
}
function restoreDrafts(root){
  // 直接恢复值，避免 HTML 解析丢失草稿开头的换行。
  for(const e of root.querySelectorAll('[data-paste]'))e.value=cardOf(e).drafts[e.dataset.paste]??'';
}
function renderObjects(){
  $('#objects').innerHTML=state.objects.map((c,i)=>`<article class="object-card" data-id="${c.id}"><div class="card-top"><span class="card-index">对象 ${String(i+1).padStart(2,'0')}</span><input data-name value="${escape(c.name)}" maxlength="80" aria-label="对象名称"><button class="quiet danger remove-card" data-action="remove-object">移除</button></div><div class="card-body"><div class="files-grid">${fileBox(c,'source')}${fileBox(c,'target')}</div><div class="key-row"><label>源唯一对齐键<select data-key="source">${options(c.source?.headers,c.key.source)}</select></label><label>目标对应旧 ID / 唯一对齐键<select data-key="target">${options(c.target?.headers,c.key.target)}</select></label></div><p class="help">只按选中的身份值逐字对齐，不把 001 转成 1。不验证未配置的目标原生 ID 唯一性。</p><div class="mapping-head"><h3>需要验收的字段</h3><button class="quiet" data-action="add-field">＋ 添加字段映射</button></div><div class="field-list">${c.fields.map((f,j)=>fieldRow(c,f,j)).join('')}</div><p class="help">只验收已选择的字段；映射为空时不证明字段正确。值映射应用于目标值，源值保持原口径。</p><div class="currency-row"><label>源币种（有金额时请选择）<select data-currency="source">${options(c.source?.headers,c.currency?.source,'未配置币种')}</select></label><label>目标币种<select data-currency="target">${options(c.target?.headers,c.currency?.target,'未配置币种')}</select></label></div></div></article>`).join('');
  restoreDrafts($('#objects'));
}
function endpoint(card,side){const ep=card[side]; return `<div class="endpoint"><h3>${side==='from'?'起点对象':'终点对象'}</h3><label>对象<select data-endpoint="${side}" data-prop="object"><option value="">请选择对象</option>${state.objects.map(o=>`<option value="${escape(o.name)}" ${ep.object===o.name?'selected':''}>${escape(o.name)}</option>`).join('')}</select></label><label>源端点字段<select data-endpoint="${side}" data-prop="source">${options(card.source?.headers,ep.source)}</select></label><label>目标端点字段<select data-endpoint="${side}" data-prop="target">${options(card.target?.headers,ep.target)}</select></label></div>`;}
function renderRelationships(){
  $('#relationships').innerHTML=state.relationships.map(c=>`<article class="relationship-card" data-id="${c.id}"><div class="card-top"><span class="card-index">关系</span><input data-name value="${escape(c.name)}" maxlength="80" aria-label="关联名称"><button class="quiet danger remove-card" data-action="remove-relationship">移除</button></div><div class="card-body"><div class="files-grid">${fileBox(c,'source')}${fileBox(c,'target')}</div><div class="endpoint-grid">${endpoint(c,'from')}${endpoint(c,'to')}</div><div class="currency-row"><label>源关系角色（可选）<select data-role="source">${options(c.source?.headers,c.role?.source,'仅比较端点')}</select></label><label>目标关系角色（可选）<select data-role="target">${options(c.target?.headers,c.role?.target,'仅比较端点')}</select></label></div><label>目标角色 → 源角色 JSON<input data-role-map value="${escape(c.roleMapText??(c.role?.map?JSON.stringify(c.role.map):''))}" placeholder='例如 {"P":"primary"}'></label><p class="help">角色列用于区分相同端点的不同关系；未配置时不证明角色正确。目标角色按已授权映射转为源口径。</p></div></article>`).join('');
  restoreDrafts($('#relationships'));
}
function render(){renderObjects();renderRelationships();}
function cardOf(element){const root=element.closest('[data-id]'); return root && [...state.objects,...state.relationships].find(c=>c.id===root.dataset.id);}
async function hash(text){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function applyText(card,side,textInput,name,inputKind='file'){
  if(inputKind==='paste'){card.drafts[side]=textInput;card.dirty[side]=true;}
  const token=nextID(); card[`${side}Token`]=token; card[side]=null; delete card.files[side]; invalidate(); state.pending++; $('#run-audit').disabled=true;
  const isCurrent=()=>card[`${side}Token`]===token && [...state.objects,...state.relationships].includes(card);
  try {
    const text=await textInput;
    if(new TextEncoder().encode(text).length>5*1024*1024)throw new Error('文件超过 5 MB，请按完整对象范围分批准备。');
    const parsed=parseCSV(text), digest=await hash(text);
    if(!isCurrent())return;
    card[side]=parsed; delete card.dirty[side]; if(inputKind==='file')card.drafts[side]=''; card.files[side]={name,sha256:digest,bytes:new TextEncoder().encode(text).length};
    if(card.key){
      if(!parsed.headers.includes(card.key[side]))card.key[side]='';
      for(const f of card.fields)if(!parsed.headers.includes(f[side]))f[side]='';
      if(!parsed.headers.includes(card.currency?.[side]))card.currency[side]='';
    } else {
      for(const endpoint of ['from','to'])if(!parsed.headers.includes(card[endpoint][side]))card[endpoint][side]='';
      if(!parsed.headers.includes(card.role?.[side]))card.role[side]='';
    }
    render(); $('#working-state').textContent=`已读取 ${name}，请复核映射`;
  } catch(e){if(isCurrent()){card[side]=null;delete card.files[side];render();error(`${card.name} · ${side==='source'?'源':'目标'}材料：${e.message} 请纠正后重新上传或粘贴。`);}}
  finally{state.pending--;$('#run-audit').disabled=state.pending>0;}
}
document.addEventListener('change', async (event)=>{
  const e=event.target, card=cardOf(e);
  if(e.matches('input[type=file]')){
    const file=e.files[0];if(!file)return;
    // Reading starts before any awaited step, so the old report is invalid immediately.
    invalidate();
    if(file.size>5*1024*1024){card[`${e.dataset.side}Token`]=nextID();card[e.dataset.side]=null;delete card.files[e.dataset.side];render();error('文件超过 5 MB。请纠正文件后重新上传。');return;}
    const read=file.arrayBuffer().then(buffer=>{try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer);}catch{throw new Error('编码不是 UTF-8，请另存为 UTF-8 CSV 后重试。');}});
    await applyText(card,e.dataset.side,read,file.name);return;
  }
  if(card && e.dataset.fieldProp){const field=card.fields[Number(e.closest('[data-field]').dataset.field)];field[e.dataset.fieldProp]=e.dataset.fieldProp==='precision'?Number(e.value):e.value;if(e.dataset.fieldProp==='type')renderObjects();}
  if(card && e.dataset.key)card.key[e.dataset.key]=e.value;
  if(card && e.dataset.currency)card.currency[e.dataset.currency]=e.value;
  if(card && e.dataset.endpoint)card[e.dataset.endpoint][e.dataset.prop]=e.value;
  if(card && e.dataset.role)card.role[e.dataset.role]=e.value;
  if(e.closest('#input-section,#scope-section') && !e.matches('[data-paste]'))invalidate();
});
document.addEventListener('toggle',(event)=>{
  const e=event.target,card=cardOf(e);
  if(card && e.isConnected && e.matches('[data-paste-panel]'))card.pasteOpen[e.dataset.pastePanel]=e.open;
},true);
document.addEventListener('input',(event)=>{
  const e=event.target,card=cardOf(e);
  if(e.matches('[data-name]')){
    const old=card.name;card.name=e.value;
    if(card.key){for(const r of state.relationships)for(const end of ['from','to'])if(r[end].object===old)r[end].object=e.value;renderRelationships();}
  }
  if(card && e.matches('[data-role-map]'))card.roleMapText=e.value;
  if(card && e.matches('[data-paste]')){const side=e.dataset.paste;card.drafts[side]=e.value;card.dirty[side]=true;card[`${side}Token`]=nextID();card[side]=null;delete card.files[side];e.closest('.file-box').querySelector('.file-info').textContent='粘贴内容尚未应用，请点击应用粘贴内容';}
  if(card&&e.dataset.fieldProp){card.fields[Number(e.closest('[data-field]').dataset.field)][e.dataset.fieldProp]=e.dataset.fieldProp==='precision'?Number(e.value):e.value;}
  if(e.closest('#input-section,#scope-section') && !e.matches('input[type=file],select'))invalidate();
});
document.addEventListener('click',async(event)=>{
  const e=event.target.closest('[data-action]');if(!e)return;const card=cardOf(e);invalidate();
  switch(e.dataset.action){
    case 'parse-paste':await applyText(card,e.dataset.side,e.closest('.file-box').querySelector('textarea').value,'粘贴 CSV','paste');break;
    case 'add-field':card.fields.push({source:'',target:'',type:'text',mapText:''});renderObjects();break;
    case 'remove-field':card.fields.splice(Number(e.closest('[data-field]').dataset.field),1);renderObjects();break;
    case 'remove-object':state.objects=state.objects.filter(o=>o!==card);render();break;
    case 'remove-relationship':state.relationships=state.relationships.filter(o=>o!==card);renderRelationships();break;
  }
});
$('#add-object').onclick=()=>{if(state.objects.length>=12){error('最多支持 12 个对象，请按明确范围分项目核验。');return;}invalidate();state.objects.push(blank(`对象 ${state.objects.length+1}`));render();};
$('#add-relationship').onclick=()=>{if(state.relationships.length>=12){error('最多支持 12 个关联表。');return;}invalidate();state.relationships.push(blankRelation());renderRelationships();};
function reset(){invalidate();state.objects=[blank('联系人'),blank('交易')];state.relationships=[];$('#project-name').value='未命名验收项目';$('#scope-note').value='';document.querySelectorAll('.scope-grid input').forEach(e=>e.checked=e.name==='relationships');render();$('#working-state').textContent='工作区已清空，请重新导入材料';}
$('#clear-all').onclick=reset;
function inputConfig(){
  if([...state.objects,...state.relationships].some(c=>Object.values(c.dirty??{}).some(Boolean)))throw new Error('有粘贴内容尚未应用，请先点击对应的“应用粘贴内容”。');
  const names=new Set();
  const objects=state.objects.map(o=>{
    if(!o.name.trim()||names.has(o.name))throw new Error('对象名称不能为空或重复，请修改名称。');names.add(o.name);
    const fields=o.fields.map(f=>{let map;const text=f.mapText??(f.map?JSON.stringify(f.map):'');if(text.trim()){try{map=JSON.parse(text);}catch{throw new Error(`${o.name}字段“${f.target||'未选择'}”的值映射不是有效 JSON，请输入 {"目标值":"源值"}。`);}if(!map||Array.isArray(map)||typeof map!=='object'||Object.values(map).some(v=>typeof v!=='string'))throw new Error('值映射须为 JSON 对象，所有值均为字符串。');}return {source:f.source,target:f.target,type:f.type,...(map?{map}:{}),...(f.type==='money'?{precision:f.precision??2}:{})};});
    return {name:o.name,source:o.source,target:o.target,key:o.key,fields,...(o.currency.source||o.currency.target?{currency:o.currency}:{})};
  });
  return {project:$('#project-name').value.trim()||'未命名验收项目',scope:{...Object.fromEntries([...document.querySelectorAll('.scope-grid input')].map(e=>[e.name,e.checked])),note:$('#scope-note').value},objects,relationships:state.relationships.map(r=>{let role={source:r.role.source,target:r.role.target};const text=r.roleMapText??(r.role.map?JSON.stringify(r.role.map):'');if(text.trim()){let map;try{map=JSON.parse(text);}catch{throw new Error(`${r.name}的角色映射不是有效 JSON。`);}if(!map||typeof map!=='object'||Array.isArray(map)||Object.values(map).some(v=>typeof v!=='string'))throw new Error('角色值映射须为 JSON 对象，值须为字符串。');role.map=map;}return {name:r.name,source:r.source,target:r.target,from:r.from,to:r.to,...(role.source||role.target?{role}:{})};})};
}
async function loadDemo(mode){
  invalidate();const revision=state.revision;state.pending++;$('#run-audit').disabled=true;
  try {const config=demoConfig(mode);
  const objects=config.objects.map(o=>({...blank(o.name),...o,id:nextID(),currency:o.currency??{source:'',target:''},fields:o.fields.map(f=>({...f,mapText:f.map?JSON.stringify(f.map):''}))}));
  const relationships=(config.relationships??[]).map(r=>({...blankRelation(),...r,id:nextID(),role:r.role??{source:'',target:''}}));
  for(const c of [...objects,...relationships])for(const side of ['source','target'])if(c[side])c.files[side]={name:`合成样例/${c.name}/${side}.csv`,sha256:await hash(JSON.stringify(c[side])),hashBasis:'解析后的合成数据 JSON，非原始 CSV'};
  if(revision!==state.revision)return;
  state.objects=objects;state.relationships=relationships;
  $('#project-name').value=`合成样例 · ${mode==='valid'?'合法迁移':mode==='broken'?'含异常':'缺证据'}`;
  $('#scope-note').value=config.scope.note||'仅为构造数据演示，不是真实客户验收或采用证据。';
  document.querySelectorAll('.scope-grid input').forEach(e=>e.checked=Boolean(config.scope[e.name]??(e.name==='relationships')));
  render();$('#working-state').textContent='已载入合成样例，可编辑配置并生成证据';
  } finally {state.pending--;$('#run-audit').disabled=state.pending>0;}
}
for(const mode of ['valid','broken','unknown'])$(`#demo-${mode}`).onclick=()=>loadDemo(mode).catch(e=>error(e.message));
const table=(headers,rows)=>`<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td><pre>${escape(cell)}</pre></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
function resultHTML(r){
  return `<div class="report-top"><div class="report-title"><p class="eyebrow">03 / 可复核的验收证据</p><h2>${escape(r.project)}</h2><p>${escape(r.generatedAt)} · 输入版本 ${r.inputRevision}</p></div><span id="result-status" class="status-badge status-${r.status}">${statusText[r.status]}</span></div><div class="metrics">${[['源记录',r.summary.sourceRows],['目标记录',r.summary.targetRows],['异常条目',r.issues.length],['未证明项',r.unknowns.length]].map(([name,value])=>`<div class="metric"><span>${name}</span><strong>${escape(value)}</strong></div>`).join('')}</div><p class="report-note">结论仅限所给对象、字段和规则。勾选声明未经自动验证；未选择字段、目标原生 ID、活动、附件及真实 CRM 完整性不在保证范围。</p>${r.unknowns.length?`<div class="unknown-box"><h3>交接前仍需补充的依据</h3><ul>${r.unknowns.map(u=>`<li>${escape(u)}</li>`).join('')}</ul></div>`:''}<h3>逐项检查</h3>${table(['检查项','结论','依据'],r.checks.map(c=>[c.name,statusText[c.status]??c.status,c.detail]))}<h3>异常定位${r.issues.length>300?'（页面展示前 300 项，导出包含全部）':''}</h3>${r.issues.length?table(['对象 / 关系','问题','对齐键','字段','源值','目标值','说明'],r.issues.slice(0,300).map(i=>[i.object,issueText[i.kind]??i.kind,i.key,i.field,i.source,i.target,i.message])):'<p class="report-note">所给材料中未发现确定异常。请同时复核未证明项。</p>'}<details><summary>输入文件与 SHA-256 · 用于识别本次材料</summary><div class="file-hashes"><p>完整配置及解析数据 SHA-256：${escape(r.configSha256)}</p>${r.inputs.map(i=>`<p>${escape(i.object)} / ${i.side==='source'?'源':'目标'} / ${escape(i.name)}<br>${escape(i.sha256)} ${escape(i.hashBasis??'原始 UTF-8 CSV 内容')}</p>`).join('')}</div></details><details><summary>本次映射、范围与规则快照</summary><pre class="file-hashes">${escape(JSON.stringify({scope:r.config.scope,objects:r.config.objects.map(({source,target,...o})=>({...o,sourceHeaders:source?.headers,targetHeaders:target?.headers})),relationships:r.config.relationships.map(({source,target,...o})=>o)},null,2))}</pre></details>`;
}
$('#run-audit').onclick=async()=>{
  error();const revision=state.revision;$('#run-audit').disabled=true;$('#working-state').textContent='正在核验材料并整理证据…';
  try {
    if(state.pending)throw new Error('材料正在读取，请稍后重新生成。');
    const config=structuredClone(inputConfig()), report=audit(config);
    report.project=config.project;report.config=config;report.inputRevision=revision;report.configSha256=await hash(JSON.stringify(config));
    report.inputs=[...state.objects,...state.relationships].flatMap(c=>Object.entries(c.files).map(([side,f])=>({object:c.name,side,...f})));
    if(revision!==state.revision)throw new Error('核验期间输入发生变化，请重新生成证据。');
    state.report=report;$('#report').innerHTML=resultHTML(report)+'<div class="exports"><button id="export-json" class="outline">下载完整证据 JSON</button><button id="export-csv" class="outline">下载异常 CSV</button><button id="export-html" class="outline">下载可打印报告</button></div><p class="report-note">JSON 含输入记录，请按客户数据规范保管。可打印报告含完整异常、映射、未证明项与哈希；打开后使用浏览器打印。</p>';
    $('#export-json').onclick=()=>download('迁移验收-证据.json',JSON.stringify(state.report,null,2),'application/json');
    $('#export-csv').onclick=()=>download('迁移验收-异常.csv',toCSV(state.report),'text/csv;charset=utf-8');
    $('#export-html').onclick=()=>download('迁移验收-报告.html',printHTML(state.report),'text/html;charset=utf-8');
    $('#working-state').textContent=`核验完成：${statusText[report.status]}。修改任何材料后需重新核验。`;$('#report').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  } catch(e){state.report=null;$('#report').innerHTML=emptyReport;error(e.message);$('#working-state').textContent='本次未生成有效报告，请按错误提示修正后重试';}
  finally{$('#run-audit').disabled=state.pending>0;}
};
function download(name,text,type){if(!state.report)return;const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function printHTML(r){
  const complete={...r,issues:r.issues};
  const allIssues=table(['对象 / 关系','问题','对齐键','字段','源值','目标值','说明'],complete.issues.map(i=>[i.object,issueText[i.kind]??i.kind,i.key,i.field,i.source,i.target,i.message]));
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'"><title>${escape(r.project)} · 迁移验收报告</title><style>body{font:14px/1.7 sans-serif;color:#1b302c;max-width:1100px;margin:30px auto;padding:20px}table{width:100%;border-collapse:collapse;font-size:12px}td,th{border:1px solid #aaa;padding:7px;text-align:left;vertical-align:top;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}.metrics{display:flex;gap:25px}.metric span{display:block}.metric strong{font-size:24px}.status-badge{font-size:20px;font-weight:bold}.file-hashes{font-size:11px}details{margin:20px 0}.table-wrap{overflow:auto}@media print{body{margin:0;max-width:none}.table-wrap{overflow:visible}tr{break-inside:avoid}}</style></head><body><p>迁移验收工作台 · 本地生成 · 请人工复核</p>${resultHTML(complete)}<h3>全部异常（共 ${r.issues.length} 项）</h3>${allIssues}<h3>完整比较配置与输入快照</h3><pre>${escape(JSON.stringify(r.config,null,2))}</pre><p>文件哈希用于识别材料，不能证明原始导出完整或经过第三方签署。本报告不能替代客户验收批准。</p></body></html>`;
}
reset();
