/* 双人轮流使用的本地手册；封存只遮盖屏幕，不提供安全隔离。 */
(() => {
  'use strict';
  const E = window.IslandEngine;
  const S = window.IslandStory;
  const KEY = 'crossed-island.v1';
  const main = document.querySelector('#experience');
  const notice = document.querySelector('#notice');
  const status = document.querySelector('#save-status');
  const dialog = document.querySelector('#confirm-dialog');
  let state = E.create();
  let initialWarning = '';
  let confirmation = null;
  let pendingImport = null;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) state = E.importBackup(stored);
  } catch (error) {
    initialWarning = '无法读取这台设备的旧进度。可以导入之前下载的备份；当前仍可开始新体验。' + error.message;
  }
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const button = (label, test = 'continue') => `<button class="primary" type="button" data-testid="${test}">${label}</button>`;
  const label = (name, title, value = '', hint = '', max = 600, kind = 'textarea') => `<label class="field"><span>${title}</span>${kind === 'input' ? `<input name="${name}" maxlength="${max}" value="${esc(value)}" required>` : `<textarea name="${name}" maxlength="${max}" ${name.startsWith('reflection') || name === 'joint' ? '' : 'required'}>${esc(value)}</textarea>`}${hint ? `<small>${hint}</small>` : ''}</label>`;
  const eyebrow = text => `<p class="eyebrow">${text}</p>`;
  const ruleLabel = rule => ({moon:'月光',sun:'日光',low:'退潮',high:'涨潮'}[rule] || '尚未选择');
  function message(text) {
    notice.textContent = text;
    notice.hidden = !text;
  }
  function persist() {
    try {
      localStorage.setItem(KEY, E.exportBackup(state));
      status.textContent = '已保存到这台设备 · 离开前也可下载进度备份';
    } catch (_) {
      status.textContent = '设备存储不可用，刷新会丢失进度 · 请使用“保存进度”下载备份';
    }
  }
  function update(next, renderNow = true) {
    state = next;
    persist();
    message('');
    if (renderNow) render();
  }
  function attempt(action) {
    try { action(); } catch (error) { message(error.message || '操作未完成，原进度已保留。'); }
  }
  function map(outcome = null) {
    const route = E.route(state);
    return `<svg class="map" viewBox="0 0 650 230" aria-label="${outcome === 'objects' ? '原物保留，离岛路舍弃' : outcome === 'road' ? '两个地标转成共同通路' : '两位作者各自的地标'}" role="img"><g fill="none" stroke="#b6beaa"><ellipse cx="160" cy="130" rx="108" ry="74"/><ellipse cx="480" cy="100" rx="122" ry="78"/><path d="M30 195Q170 165 300 193T620 177M45 211Q180 185 300 212T615 193"/></g><g fill="#193f42"><path d="M131 158l14-80h23l15 80z"/><path d="M427 135v-39l30-32 32 32v39zm48 0v-39l30-32 32 32v39z"/></g>${outcome === 'road' ? '<path d="M169 170Q312 11 460 150" fill="none" stroke="#b7462e" stroke-width="6" stroke-dasharray="8 6"/>' : '<path d="M178 170Q312 30 432 150" fill="none" stroke="#a4ae9e" stroke-width="2" stroke-dasharray="3 8"/>'}${outcome === 'objects' ? '<path d="M302 91l25 25m0-25l-25 25" stroke="#b7462e" stroke-width="3"/>' : ''}<g fill="#193f42" font-size="12" font-family="serif"><text x="145" y="52">灯塔一侧</text><text x="443" y="177">花园一侧</text><text x="270" y="219">${esc(route?.label || '尚未定名的潮汐')}</text></g></svg>`;
  }
  function authorForm(role) {
    const a = state.authors[role];
    const isA = role === 'A';
    const rules = isA ? [['moon','只在月光中照路'],['sun','只在日光中照路']] : [['low','只在退潮时开放'],['high','只在涨潮时开放']];
    return `${eyebrow('第一章 / 分别创造')}<h2>${isA ? '阿岚' : '雨生'}，先留下你的世界。</h2><p class="body-copy">${esc(S.roles[role].brief)}</p><div class="callout">现在只由这一位填写。另一位请转身或离开屏幕；下一步会盖住作品。环境条件将决定对方能做什么，缘由则留待你们一起读。</div><form data-testid="author-form"><div class="field-grid">${label('name','你在故事里的名字',a.name,'',30,'input')}${label('landmark',isA ? '你的灯塔叫什么？' : '你的花园叫什么？',a.landmark,'',60,'input')}</div>${label('detail','用文字画它的样子',a.detail,'')}${label('reason','我希望留住它，因为……',a.reason,'')}<label class="field"><span>${isA ? '你的灯塔何时照路？' : '你的花园何时开放？'}</span><select name="rule" required><option value="">请选择一种条件</option>${rules.map(([value,text]) => `<option value="${value}" ${a.rule === value ? 'selected' : ''}>${text}</option>`).join('')}</select></label>${label('prediction','我猜对方会……',a.prediction,'')}<div class="button-row"><button class="primary" type="submit">保存并封存 →</button></div></form>`;
  }
  function handoff(title, copy, seal = '封') {
    return `<section class="handoff">${eyebrow('交接页 / 作品已盖住')}<div class="seal" aria-hidden="true">${seal}</div><h2>${title}</h2><p class="lead">${copy}</p><p class="note">只有接手的人准备好后，才展开下一页。这里的遮盖依靠彼此约定；同一设备上的备份不加密。</p><div class="button-row">${button('我已接手，展开下一页 →')}</div></section>`;
  }
  function actionForm(role) {
    const r = E.route(state)[role];
    return `${eyebrow('第二章 / 进入对方世界')}<h2>${esc(state.authors[role].name)}，你先遇见的是条件。</h2><p class="lead">你还不知道对方为何珍惜这件东西。先在对方设定的世界里，带着你的地标走一次。</p><div class="rule-note"><p>对方的条件：<strong>${esc(r.condition)}</strong></p><p>你能做：${esc(r.action)}<br>这次不能：${esc(r.forbidden)}</p></div><form data-testid="action-form">${label('action','在你的世界里，我打算……',state.actions[role],'为上面的行动添一段你自己的细节，不需要猜中对方的想法。')}<div class="button-row"><button class="primary" type="submit">留下行动，交给下一位 →</button></div></form>`;
  }
  function records() {
    const route = E.route(state);
    return `<div class="record-grid">${['A','B'].map(role => {
      const a = state.authors[role];
      return `<section class="record"><span class="caption">${role === 'A' ? '灯塔一侧' : '花园一侧'}</span><h3>${esc(a.landmark || '未命名的地标')}</h3><p>作者：${esc(a.name || '尚未填写')}</p><p>${esc(a.detail || '尚未留下样子')}</p><blockquote>${esc(a.reason || '缘由尚未填写')}</blockquote><p>环境：${esc(ruleLabel(a.rule))}</p><p>原先猜想：${esc(a.prediction || '尚未填写')}</p><p>实际行动：${esc(state.actions[role] || '尚未行动')}</p>${route ? `<p class="note">规则中的行动：${esc(route[role].action)}</p>` : ''}${state.reflections[role] ? `<p>回望：${esc(state.reflections[role])}</p>` : ''}</section>`;
    }).join('')}</div>`;
  }
  function decisionForm() {
    return `${eyebrow('第三章 / 共同取舍')}<h2>两枚筹码，只有一个共同结局。</h2><p class="body-copy">${esc(S.stages[2].body)}</p><div class="rules"><div class="rule-note"><strong>留路</strong><p>花掉两枚筹码。灯塔改成路灯，花园改成路面或浮台。留下共同通路，失去两件原物的外形。</p></div><div class="rule-note"><strong>留物</strong><p>各花一枚修复原物。两件地标完整留下，你们放弃离岛通路。</p></div></div><p class="note">彼此读完缘由再选择。意见不同可以再聊，也可以“停在这里”，留下作品且没有共同结局。</p><form data-testid="decision-form"><div class="field-grid">${['A','B'].map(role => `<label class="field"><span>${esc(state.authors[role].name)}的选择</span><select name="vote${role}" required><option value="">请由本人选择</option><option value="road" ${state.votes[role] === 'road' ? 'selected' : ''}>留路 · 放弃原物外形</option><option value="objects" ${state.votes[role] === 'objects' ? 'selected' : ''}>留物 · 放弃离岛路</option></select></label>`).join('')}</div>${label('joint','共同结局：我们决定……',state.joint,'同意后，用你们自己的话写得到什么、愿意放下什么。',1000)}${label('reflectionA',`${esc(state.authors.A.name)}的回望（可留空）`,state.reflections.A,'我原以为……，但你让我看到……')}${label('reflectionB',`${esc(state.authors.B.name)}的回望（可留空）`,state.reflections.B,'我原以为……，但你让我看到……')}<div class="button-row"><button class="primary" type="submit">确认双方取舍 →</button></div></form><details><summary>再看双方揭晓的作品</summary>${records()}</details>`;
  }
  function finished() {
    const road = state.outcome === 'road';
    const objects = state.outcome === 'objects';
    return `<article data-testid="artifact">${eyebrow('交错岛 / 这一次的纪念页')}<h2>${road ? '你们把原物，变成了路。' : objects ? '你们留下了原物。' : '你们停在这里，也留下了作品。'}</h2><p class="lead">${esc(S.endings[state.outcome])}</p>${map(state.outcome)}<p>${road ? '两枚筹码已用于修路 · 原物外形失去 · 离岛路留下' : objects ? '两枚筹码各修一件原物 · 原物完整 · 离岛路放弃' : '筹码未使用 · 已有输入保留 · 没有共同结局'}</p>${state.joint ? `<blockquote class="ending-copy">${esc(state.joint)}</blockquote>` : ''}${state.votes.A || state.votes.B ? `<p class="note">双方留下的选择：${esc(state.authors.A.name || '阿岚')} ${esc({road:'留路',objects:'留物'}[state.votes.A] || '尚未选择')} / ${esc(state.authors.B.name || '雨生')} ${esc({road:'留路',objects:'留物'}[state.votes.B] || '尚未选择')}</p>` : ''}${records()}<div class="artifact-footer">这是一份共同虚构的作品。自由句原样留存，由你们赋予意义；程序只按明确条件生成行动与路线，不自动解读表达。</div></article><div class="button-row">${button('下载纪念记录 .md','export-md')}<button class="secondary" type="button" data-testid="print-result">打印 / 保存为 PDF</button></div>`;
  }
  function render() {
    main.dataset.stage = state.stage;
    const stage = state.stage;
    let content = '';
    if (state.paused) {
      content = `<section class="paused">${eyebrow('旅程暂停 / 作品已盖住')}<h2>先把时间还给自己。</h2><p class="lead">不用现在决定下一步。进度已经留在这台设备上；离开前也可以下载备份。</p><div class="button-row">${button('准备好了，继续旅程','resume')}</div></section>`;
    } else if (stage === 'intro') {
      content = `${eyebrow('原创双人叙事 / 无需主持人')}<div class="hero"><div><h1>把你的世界<br>交给另一个人。</h1><p class="lead">${esc(S.intro)}</p></div><svg class="hero-art" viewBox="0 0 270 330" role="img" aria-label="灯塔和花园被潮汐环绕"><g fill="none" stroke="#98a892"><ellipse cx="126" cy="171" rx="114" ry="141"/><ellipse cx="126" cy="171" rx="96" ry="123"/><path d="M12 276Q95 251 147 276T260 280M15 296Q95 270 147 296T260 296"/></g><path fill="#193f42" d="M51 166l13-76h24l14 76zm8-84l17-25 17 25zM158 245v-40l28-33 30 33v40z"/><path d="M84 180Q123 213 175 169" stroke="#b7462e" stroke-width="3" fill="none" stroke-dasharray="5 6"/><circle cx="125" cy="175" r="5" fill="#b7462e"/><text x="105" y="35">潮汐之间</text><text x="28" y="217">一份未知的缘由</text></svg></div><div class="intro-meta"><span>两人轮流使用同一设备</span><span>三次交换 · 两枚筹码</span><span>也可打印后用纸笔玩</span></div><details class="experience-guide"><summary>体验规则与本机数据</summary><p class="body-copy">一位创造灯塔，一位创造花园。先把缘由盖住，只交换条件；进入对方的世界之后，再共同揭晓。最后，你们必须决定留下原物，还是把它们变成离岛的路。</p><p class="note">不需要真实回忆。两人轮流使用同一设备，没有在线同步；所有文字留在本机。可随时暂停，不限时、不计分。</p></details><div class="button-row">${button('一起登岛 →','start')}<a href="printable.html" target="_blank">打开纸面体验包 ↗</a></div><p class="note">准备一位愿意共同虚构的伙伴。任何时候都可以停。</p>`;
    } else if (stage === 'createA' || stage === 'createB') content = authorForm(stage === 'createA' ? 'A' : 'B');
    else if (stage === 'handoffB') content = handoff('请把屏幕交给雨生。','第一份作品已经封存。现在由雨生独自创造花园；阿岚暂时不要看。');
    else if (stage === 'handoffA') content = handoff('请把屏幕交回阿岚。','两份作品都已封存。阿岚先进入对方的世界，只看潮汐条件，不看缘由。');
    else if (stage === 'handoffActionB') content = handoff('现在，换雨生进入世界。','第一段行动已经留好。由雨生独自回应光照条件，完成后你们再一起看。');
    else if (stage === 'actionA' || stage === 'actionB') content = actionForm(stage === 'actionA' ? 'A' : 'B');
    else if (stage === 'reveal') content = `${eyebrow('第二章 / 一起揭晓')}<h2>现在，看见条件背后的缘由。</h2><p class="lead">一起读出原句和实际行动。哪一处和原先的猜想不同？如果什么都没有不同，也完全可以。</p>${records()}<div class="callout">不评判表达，也不解释对方的真实生活。让每个人自己说，为什么想留下这件东西。</div><div class="button-row">${button('我们都读完了，走向取舍 →')}</div>`;
    else if (stage === 'decision') content = decisionForm();
    else if (stage === 'finished') content = finished();
    main.innerHTML = content;
    if (stage === 'finished' && state.outcome === 'stop' && state.joint) {
      const draftNote = document.createElement('p');
      draftNote.className = 'note';
      draftNote.textContent = '未完成的共同句草稿（不代表共同同意）：';
      main.querySelector('.ending-copy').before(draftNote);
    }
    document.querySelectorAll('#progress li').forEach((li,index) => {
      const chapter = ['intro','createA','handoffB','createB'].includes(stage) ? 0 : ['handoffA','actionA','handoffActionB','actionB','reveal'].includes(stage) ? 1 : 2;
      li.classList.toggle('active', chapter === index);
      if (chapter === index) li.setAttribute('aria-current','step'); else li.removeAttribute('aria-current');
    });
    document.querySelector('.tokens').classList.toggle('spent', stage === 'finished' && state.outcome !== 'stop');
    document.querySelector('#pause').hidden = stage === 'intro' || stage === 'finished' || state.paused;
    document.querySelector('#stop').hidden = stage === 'finished';
    main.focus({preventScroll:true});
  }
  function draft() {
    const form = main.querySelector('form');
    if (!form || state.paused) return;
    const values = Object.fromEntries(new FormData(form));
    if (state.stage.startsWith('create')) state = E.saveDraft(state,{author:values});
    else if (state.stage.startsWith('action')) state = E.saveDraft(state,{action:values.action});
    else if (state.stage === 'decision') state = E.saveDraft(state,{votes:{A:values.voteA,B:values.voteB},joint:values.joint,reflections:{A:values.reflectionA,B:values.reflectionB}});
    persist();
  }
  main.addEventListener('input', () => attempt(draft));
  main.addEventListener('change', () => attempt(draft));
  main.addEventListener('submit', event => {
    event.preventDefault();
    attempt(() => {
      const values = Object.fromEntries(new FormData(event.target));
      if (state.stage.startsWith('create')) update(E.saveAuthor(state,state.stage === 'createA' ? 'A' : 'B',values));
      else if (state.stage.startsWith('action')) update(E.saveAction(state,state.stage === 'actionA' ? 'A' : 'B',values.action));
      else if (state.stage === 'decision') {
        update(E.resolve(state,values.voteA,values.voteB,values.joint,{A:values.reflectionA,B:values.reflectionB}));
        if (state.stage === 'decision') message('你们的选择还不同。可以继续讨论并调整，也可以停在这里；不会替任何一方决定。');
      }
    });
  });
  function download(text,filename,type) {
    const url = URL.createObjectURL(new Blob([text],{type}));
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  main.addEventListener('click', event => {
    const control = event.target.closest('[data-testid]');
    if (!control) return;
    attempt(() => {
      switch (control.dataset.testid) {
        case 'start': case 'continue': update(E.advance(state)); break;
        case 'resume': update(E.resume(state)); break;
        case 'export-md': download(E.toMarkdown(state),'交错岛-纪念记录.md','text/markdown;charset=utf-8'); break;
        case 'print-result': window.print(); break;
      }
    });
  });
  function confirm(action,title,copy,testid) {
    confirmation = action;
    document.querySelector('#dialog-title').textContent = title;
    document.querySelector('#dialog-copy').textContent = copy;
    dialog.returnValue = 'cancel';
    const control = document.querySelector('#dialog-confirm');
    control.dataset.testid = testid;
    dialog.showModal();
  }
  dialog.addEventListener('close', () => {
    const action = confirmation;
    confirmation = null;
    if (dialog.returnValue === 'confirm' && action) attempt(action);
    pendingImport = null;
  });
  document.querySelector('#pause').addEventListener('click', () => attempt(() => {draft();update(E.pause(state));}));
  document.querySelector('#backup').addEventListener('click', () => attempt(() => {
    draft();download(E.exportBackup(state),'交错岛-进度.json','application/json;charset=utf-8');
    status.textContent = '已生成进度文件 · 含全部已写原句，请妥善保存';
  }));
  document.querySelector('#stop').addEventListener('click', () => attempt(() => {
    draft();confirm(() => update(E.stop(state)),'停在这里？','会保留你们已经写下的作品，不花筹码，也不产生共同结局。停止后仍可导出记录；如需稍后继续，请选择暂停。','confirm-stop');
  }));
  document.querySelector('#new-game').addEventListener('click', () => attempt(() => {
    draft();confirm(() => update(E.create()),'另起一局？','本设备中的当前进度将被替换。请先保存进度或下载纪念记录；已经下载的文件不受影响。','confirm-new');
  }));
  document.querySelector('#import-file').addEventListener('change', async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 100000) throw new Error('文件过大，请选择从本体验导出的进度 JSON（不超过 100 KB）。');
      pendingImport = E.importBackup(await file.text());
      confirm(() => update(pendingImport),'替换当前进度？','备份已验证。导入会替换这台设备中的当前作品；请先取消并保存当前进度，再重新导入。','confirm-import');
    } catch (error) {pendingImport = null;message('导入未完成，当前进度已保留。' + error.message);}
  });
  render();
  if (initialWarning) message(initialWarning);
})();
