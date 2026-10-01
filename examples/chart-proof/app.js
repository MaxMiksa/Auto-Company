(function () {
  'use strict';
  const CP = window.ChartProof;
  const $ = id => document.getElementById(id);
  const STORAGE = 'chart-proof-project-v1';
  const metaFields = [['title','title'],['source','source'],['x-label','xLabel'],['y-label','yLabel'],['x-scale','xScale'],['y-scale','yScale'],['description','description']];
  const labels = {observed:'观测', approximate:'近似', interpolated:'插值', missing:'缺测', unconfirmed:'未确认'};
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let project = null;
  let editing = null;
  let selectedSeries = '';
  let metadataDraft = null;
  let draftStored = true;

  function readMetadata() {
    return Object.fromEntries(metaFields.map(([id,key]) => [key,$(id).value]));
  }
  function hasMetadataDraft() {
    return !!project && !!metadataDraft && metaFields.some(([,key]) => metadataDraft[key] !== project.meta[key]);
  }
  function renderDraftStatus() {
    const dirty = hasMetadataDraft();
    $('meta-draft-status').textContent = !project ? '导入资料后，填写并保存来源说明。' : dirty ? `有未保存的来源草稿${draftStored ? '，已暂存到当前浏览器，刷新可恢复' : '，当前仅保留在页面中，刷新可能丢失；请先保存来源说明或复制草稿文字保留'}。阅读资料和所有导出仍使用已保存说明；保存后，变更会撤销旧复核。` : '来源说明与已保存资料一致；阅读资料和导出使用此版本。';
    $('meta-draft-status').classList.toggle('pending',dirty);
    $('discard-meta-draft').disabled = !dirty;
    $('reader-draft-note').hidden = !dirty;
  }
  function persist() {
    localStorage.setItem(STORAGE,JSON.stringify({project,metadataDraft}));
    draftStored = true;
  }

  function message(text, error = false) {
    $('message').textContent = text;
    $('message').classList.toggle('error', error);
  }
  function commit(next, notice, resetMetadata = false) {
    project = CP.validateProject(next);
    if (resetMetadata || !metadataDraft) metadataDraft = {...project.meta};
    render();
    try {
      persist();
      message(notice + ' 已保存到当前浏览器。');
    } catch (_) {
      draftStored = false;
      message(notice + ' 浏览器草稿无法保存，请导出 JSON 备份已保存资料。' + (hasMetadataDraft() ? '备份不含来源草稿；请先保存来源说明或复制草稿保留，关闭页面前不要刷新。' : ''), true);
    }
    renderDraftStatus();
  }
  function action(fn) {
    try { fn(); } catch (error) { message(error.message || '操作失败，原有项目已保留。', true); }
  }
  function requireProject() {
    if (!project) throw new Error('请先导入 CSV 或载入样例。');
  }
  function replace(next, notice) {
    if (project && !window.confirm('这会替换当前项目' + (hasMetadataDraft() ? '并丢弃未保存的来源草稿' : '') + '。请先导出 JSON 备份；备份仅包含已保存资料。继续替换吗？')) return;
    selectedSeries = '';
    $('pending-only').checked = false;
    commit(next, notice, true);
  }
  function pointHistory(point) {
    return `${point.series}，横轴 ${point.x}，数值 ${point.y === null ? '缺测' : point.y}，${labels[point.kind]}；出处：${point.evidence || '未填写'}；说明：${point.note || '无'}；复核：${point.review?.name || '未复核'}`;
  }
  function metaHistory(meta) {
    return `标题：${meta.title}；来源：${meta.source || '未填写'}；横轴：${meta.xLabel}（${meta.xScale === 'log' ? '对数' : '线性'}）；纵轴：${meta.yLabel}（${meta.yScale === 'log' ? '对数' : '线性'}）；说明：${meta.description || '无'}`;
  }
  function historyText(entry) {
    const title = entry.action === 'meta' ? '修改资料说明，撤销旧复核' : entry.action === 'review' ? '人工署名复核' : '修改数据点';
    const describe = entry.action === 'meta' ? metaHistory : pointHistory;
    return `<li><strong>${escape(entry.date)} · ${escape(entry.actor)} · ${title}</strong><p>之前：${escape(describe(entry.before))}</p><p>之后：${escape(describe(entry.after))}</p>${entry.revokedReviews?.length ? `<p>撤销了 ${entry.revokedReviews.length} 条旧复核，完整责任记录保存在 JSON 备份。</p>` : ''}</li>`;
  }
  function render() {
    for (const id of ['export-html','export-json','export-csv','export-md','save-meta']) $(id).disabled = !project;
    const body = $('point-table').querySelector('tbody');
    renderDraftStatus();
    if (!project) {
      $('metrics').innerHTML = [['0','数据点'],['0','缺测'],['0','近似 / 插值'],['0','待复核']].map(([n,label]) => `<div class="metric"><strong>${n}</strong><span>${label}</span></div>`).join('');
      body.innerHTML = '<tr><td colspan="6" class="empty">导入后，在此核对每个数据点的语义和出处。</td></tr>';
      $('reading-content').innerHTML = '<h3>阅读资料将在这里生成。</h3><p>资料含原始数值、缺测边界、数据类型、来源和复核责任，无需通过颜色或曲线读取数值。</p>';
      $('audit-list').replaceChildren();
      $('series-filter').innerHTML = '<option value="">全部系列</option>';
      return;
    }
    const meta = project.meta;
    for (const [id,key] of metaFields) $(id).value = metadataDraft[key];
    const summary = CP.getSummary(project);
    const counts = summary.counts;
    $('metrics').innerHTML = [[project.points.length,'数据点'],[counts.missing || 0,'缺测'],[(counts.approximate || 0) + (counts.interpolated || 0),'近似 / 插值'],[summary.unreviewed,'待复核']].map(([n,label]) => `<div class="metric"><strong>${n}</strong><span>${label}</span></div>`).join('');
    const names = [...new Set(project.points.map(p => p.series))];
    $('series-filter').innerHTML = '<option value="">全部系列</option>' + names.map(name => `<option value="${escape(name)}">${escape(name)}</option>`).join('');
    if (!names.includes(selectedSeries)) selectedSeries = '';
    $('series-filter').value = selectedSeries;
    const filtered = project.points.filter(p => (!selectedSeries || p.series === selectedSeries) && (!$('pending-only').checked || !p.review?.name));
    body.innerHTML = filtered.map(p => `<tr><td><strong>${escape(p.series)}</strong><small>${escape(meta.xLabel)}：${escape(p.x)}</small></td><td>${p.y === null ? '— 缺测' : escape(p.y)}</td><td><span class="tag ${p.kind}">${labels[p.kind]}</span></td><td>${p.evidence ? escape(p.evidence) : '未填写出处'}${p.note ? `<small>${escape(p.note)}</small>` : ''}</td><td>${p.review?.name ? `${escape(p.review.name)}<small>${escape(p.review.date)}</small>` : '<span class="tag unconfirmed">待复核</span>'}</td><td><button data-edit="${escape(p.id)}" aria-label="编辑 ${escape(p.series)} 横轴 ${escape(p.x)}">编辑</button><button data-review="${escape(p.id)}" aria-label="复核 ${escape(p.series)} 横轴 ${escape(p.x)}">${p.review?.name ? '重新复核' : '署名复核'}</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">此筛选下没有数据点。</td></tr>';
    const allReviewed = summary.unreviewed === 0;
    $('reading-content').innerHTML = `<p class="eyebrow">非视觉阅读 / ${allReviewed ? '每点已有人工署名' : '含待复核数据'}</p><h3>${escape(meta.title || '未命名资料')}</h3><p><strong>来源：</strong>${escape(meta.source || '尚未填写')}</p><p><strong>横轴：</strong>${escape(meta.xLabel)}（${meta.xScale === 'log' ? '对数' : '线性'}）；<strong>纵轴：</strong>${escape(meta.yLabel)}（${meta.yScale === 'log' ? '对数' : '线性'}）。</p>${meta.description ? `<p>${escape(meta.description)}</p>` : ''}<p>共 ${project.points.length} 点；缺测 ${counts.missing || 0} 点；近似 ${counts.approximate || 0} 点；插值 ${counts.interpolated || 0} 点；未确认 ${counts.unconfirmed || 0} 点；待复核 ${summary.unreviewed} 点。缺测未被填补，人工署名不构成系统正确性认证。</p>` + names.map(name => {
      const points = project.points.filter(p => p.series === name).sort((a,b) => a.x-b.x);
      return `<div class="series-read"><h4>${escape(name)}</h4><ul>${points.map(p => `<li>${escape(meta.xLabel)} ${escape(p.x)}：${p.y === null ? '缺测，无观测数值' : `${escape(meta.yLabel)} ${escape(p.y)}（${labels[p.kind]}）`}。出处：${escape(p.evidence || '未填写')}。${p.note ? `说明：${escape(p.note)}。` : ''}复核：${p.review?.name ? `${escape(p.review.name)}，${escape(p.review.date)}` : '尚未复核'}。</li>`).join('')}</ul></div>`;
    }).join('');
    $('audit-list').innerHTML = project.history.length ? project.history.slice().reverse().map(historyText).join('') : '<li>尚无修改或署名复核记录。</li>';
  }
  function importCSV(text) {
    const points = CP.parseCSV(text).map(point => ({...point,review:{name:'',date:'',note:''}}));
    replace(CP.createProject(points, {title:'新导入的图表资料',source:'',xLabel:'横轴',yLabel:'纵轴',xScale:'linear',yScale:'linear',description:''}), `已导入 ${points.length} 个数据点，请补充来源与轴说明。`);
  }
  $('import-csv').addEventListener('click', () => action(() => importCSV($('csv-input').value)));
  $('load-demo').addEventListener('click', () => action(() => {
    const csv = 'series,x,y,kind,evidence,note\n样本A,2021,12,observed,构造数据第1行,用于演示\n样本A,2022,18,observed,构造数据第2行,用于演示\n样本A,2023,,missing,构造数据第3行,未采集；不是零\n样本A,2024,24,approximate,构造数据第4行,根据图形估计\n样本B,2021,8,observed,构造数据第5行,用于演示\n样本B,2022,11,interpolated,构造数据第6行,仅为演示的插值\n样本B,2023,15,unconfirmed,构造数据第7行,尚未核对原值\n样本B,2024,19,observed,构造数据第8行,用于演示';
    const next = CP.createProject(CP.parseCSV(csv),{title:'两组样本的年度测量 · 构造样例',source:'本产品构造数据，不是真实研究或采用证据',xLabel:'年份',yLabel:'测量值（单位）',xScale:'linear',yScale:'linear',description:'用于体验缺测、近似、插值与未确认数据的交接。样本A在2023年缺测，不应跨空白推断连续趋势。'});
    replace(next, '已载入构造样例，全部数据均待人工复核。');
    $('csv-input').value = csv;
  }));
  for (const [id,handler] of [['csv-file',importCSV],['project-file',text => replace(CP.importProject(text),'已恢复项目备份。')]]) {
    $(id).addEventListener('change', async event => {
      const file = event.target.files[0];
      if (!file) return;
      try {
        const limit = id === 'csv-file' ? 5 : 30;
        if (file.size > limit * 1024 * 1024) throw new Error(`文件超过 ${limit} MB，请拆分或选择较小备份。`);
        const text = await file.text();
        handler(text);
      } catch (error) { message(error.message + ' 原有项目已保留。', true); }
      event.target.value = '';
    });
  }
  $('meta-form').addEventListener('submit', event => {
    event.preventDefault();
    action(() => {
      requireProject();
      const meta = Object.fromEntries(Object.entries(readMetadata()).map(([key,value]) => [key,value.trim()]));
      commit(CP.updateMeta(project,meta,$('reviewer').value.trim() || '资料制作者'),'已保存来源说明；变更后的数据需重新复核。',true);
    });
  });
  function captureMetadataDraft() {
    if (!project) return;
    metadataDraft = readMetadata();
    try { persist(); } catch (_) { draftStored = false; }
    renderDraftStatus();
  }
  $('meta-form').addEventListener('input',captureMetadataDraft);
  $('meta-form').addEventListener('change',captureMetadataDraft);
  window.addEventListener('beforeunload', event => {
    if (!hasMetadataDraft() || draftStored) return;
    event.preventDefault();
    event.returnValue = '';
  });
  $('discard-meta-draft').addEventListener('click', () => {
    if (!hasMetadataDraft() || !window.confirm('放弃未保存的来源草稿，恢复已保存说明吗？数据点与复核记录会保留。')) return;
    metadataDraft = {...project.meta};
    try { persist(); message('已放弃来源草稿，恢复已保存说明。'); }
    catch (_) { draftStored = false; message('页面已恢复已保存说明，但浏览器暂存更新失败；刷新可能再次恢复旧草稿。',true); }
    render();
  });
  $('series-filter').addEventListener('change', () => { selectedSeries = $('series-filter').value; render(); });
  $('pending-only').addEventListener('change', render);
  $('point-table').addEventListener('click', event => action(() => {
    const edit = event.target.closest('[data-edit]');
    const review = event.target.closest('[data-review]');
    if (edit) {
      const point = project.points.find(p => p.id === edit.dataset.edit);
      editing = point.id;
      $('editing-label').textContent = `${point.series} / ${project.meta.xLabel} ${point.x}`;
      $('edit-value').value = point.y === null ? '' : point.y;
      $('edit-kind').value = point.kind;
      $('edit-evidence').value = point.evidence;
      $('edit-note').value = point.note;
      $('edit-error').textContent = '';
      $('editor').showModal();
      $('edit-value').focus();
    }
    if (review) commit(CP.reviewPoint(project,review.dataset.review,$('reviewer').value.trim(),'人工核对了数值、语义与出处'),'已记录人工署名复核。');
  }));
  $('close-editor').addEventListener('click', () => $('editor').close());
  $('edit-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const raw = $('edit-value').value.trim();
      if (raw && (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw) || !Number.isFinite(Number(raw)))) throw new Error('数值格式无效，请输入有限十进制数字。');
      const next = CP.updatePoint(project,editing,{y:raw === '' ? null : Number(raw),kind:$('edit-kind').value,evidence:$('edit-evidence').value.trim(),note:$('edit-note').value.trim()},$('reviewer').value.trim() || '资料制作者');
      commit(next,'已保存数据点，相关旧复核已撤销。');
      $('editor').close();
    } catch (error) { $('edit-error').textContent = error.message; }
  });
  function download(content, extension, mime) {
    const url = URL.createObjectURL(new Blob([content],{type:mime}));
    const link = document.createElement('a');
    link.href = url;
    link.download = (project.meta.title || '图表资料').replace(/[\\/:*?"<>|]/g,'_').slice(0,80) + '.' + extension;
    document.body.appendChild(link);link.click();link.remove();
    setTimeout(() => URL.revokeObjectURL(url),1000);
    message('已生成下载文件。' + (hasMetadataDraft() ? '未保存的来源草稿未包含，草稿仍保留；如需交付新说明，请先保存来源说明。' : '请检查下载目录，并连同来源与未复核边界一起交付。'));
  }
  for (const [id,generate,ext,mime] of [
    ['export-html',() => CP.exportHTML(project),'html','text/html;charset=utf-8'],
    ['export-json',() => JSON.stringify(project,null,2),'json','application/json;charset=utf-8'],
    ['export-csv',() => CP.exportCSV(project),'csv','text/csv;charset=utf-8'],
    ['export-md',() => CP.exportMarkdown(project),'md','text/markdown;charset=utf-8']
  ]) $(id).addEventListener('click', () => action(() => {requireProject();download(generate(),ext,mime);}));
  $('reset-project').addEventListener('click', () => {
    if (!window.confirm('清空会删除当前浏览器项目' + (hasMetadataDraft() ? '及未保存的来源草稿' : '') + '。请先导出 JSON 备份；备份仅包含已保存资料。确认清空吗？')) return;
    try { localStorage.removeItem(STORAGE); } catch (_) { message('浏览器拒绝清空草稿；请从浏览器设置清除本页面数据。',true); return; }
    project = null;
    metadataDraft = null;
    draftStored = true;
    $('csv-input').value = '';
    $('meta-form').reset();
    render();message('已清空本地项目。可以重新导入。');
  });
  try {
    const saved = localStorage.getItem(STORAGE);
    if (saved) {
      const stored = JSON.parse(saved);
      project = CP.importProject(stored.project ? JSON.stringify(stored.project) : saved);
      metadataDraft = {...project.meta};
      if (stored.metadataDraft) {
        const draft = stored.metadataDraft;
        const limits = {title:10000,source:10000,xLabel:10000,yLabel:10000,xScale:6,yScale:6,description:10000};
        if (!draft || typeof draft !== 'object' || Array.isArray(draft) || Object.keys(draft).length !== metaFields.length || !metaFields.every(([,key]) => typeof draft[key] === 'string' && draft[key].length <= limits[key]) || !['linear','log'].includes(draft.xScale) || !['linear','log'].includes(draft.yScale)) throw new Error('来源草稿格式无效');
        metadataDraft = draft;
      }
      message(hasMetadataDraft() ? '已恢复浏览器项目及未保存的来源草稿。阅读与导出仍使用已保存说明；请核对后保存草稿。' : '已恢复当前浏览器项目。继续编辑前可先导出 JSON 备份。');
    }
  } catch (_) { message('无法读取浏览器草稿。原草稿未删除；可导入 JSON 备份恢复。',true); }
  render();
}());
