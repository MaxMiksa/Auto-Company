'use strict';
(() => {
  const STORAGE_KEY = 'family-art-show.v1';
  const MAX_ARTWORKS = 24;
  const MAX_SESSIONS = 20;
  const MAX_IMAGE_CHARS = 240000;
  const MAX_STATE_CHARS = 2400000;
  const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
  const $ = id => document.getElementById(id);
  const freshState = () => ({version: 1, title: '', host: '', artworks: [], sessions: [], activeSessionId: null, isDemo: false});
  let state = freshState();
  let editingId = null;
  let draftImage = null;
  let imageBusy = false;
  let imageError = false;
  let imageGeneration = 0;
  let storageBlocked = false;
  let storageFailure = '';
  let activeView = 'prepare';
  let pendingInitialization = true;
  const identifier = () => (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'a-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  const now = () => new Date().toISOString();
  const artName = art => art.title || '未命名作品';
  const showName = () => state.title || '家里的小展会';
  const currentSession = () => state.sessions.find(item => item.id === state.activeSessionId) || null;
  const includedArtworks = () => state.artworks.filter(art => art.included);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const notice = (message, isError = false) => {
    $('notice').textContent = message;
    $('notice').className = isError ? 'error' : '';
    $('notice').hidden = false;
  };
  function save() {
    if (storageBlocked) {
      $('save-status').textContent = storageFailure + ' 当前改动只在页面中，请导出备份。';
      return false;
    }
    try {
      const serialized = JSON.stringify(state);
      if (serialized.length > MAX_STATE_CHARS) throw new Error('小展会超过本机保存容量，请减少图片或先导出备份。');
      localStorage.setItem(STORAGE_KEY, serialized);
      storageFailure = '';
      $('save-status').textContent = '已自动保存到当前浏览器' + (state.isDemo ? ' · 合成示例' : '');
      return true;
    } catch (error) {
      storageFailure = '本机保存失败，可能是空间不足或浏览器限制。';
      $('save-status').textContent = storageFailure + ' 当前改动仍在页面，请导出备份。';
      notice(storageFailure + ' 当前作品仍在页面里，请立即导出完整备份；关闭或刷新可能丢失未保存改动。', true);
      return false;
    }
  }
  function update(mutator) {
    const previous = JSON.parse(JSON.stringify(state));
    mutator();
    if (JSON.stringify(state).length > MAX_STATE_CHARS) {
      state = previous; render();
      notice('作品夹容量已满，本次操作没有保存。请先导出完整备份，再减少图片或清空后重新策展。', true);
      return false;
    }
    const saved = save();
    render();
    return saved;
  }
  function exactObject(value, keys, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(name + '格式不正确。');
    const actual = Object.keys(value);
    if (actual.length !== keys.length || keys.some(key => !Object.hasOwn(value, key)) || actual.some(key => !keys.includes(key))) throw new Error(name + '字段不完整或含不支持的字段。');
  }
  function string(value, max, name) {
    if (typeof value !== 'string' || value.length > max) throw new Error(name + '必须是长度不超过 ' + max + ' 的文字。');
    return value;
  }
  function id(value) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) throw new Error('记录编号不正确。');
  }
  function date(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('记录时间不正确。');
  }
  function imageSignature(data) {
    if (typeof data !== 'string' || data.length > MAX_IMAGE_CHARS || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('图片只支持大小受限的 PNG、JPEG、WebP 数据。');
    const [prefix, content] = data.split(',');
    if (content.length % 4 !== 0) throw new Error('图片编码损坏。');
    let bytes;
    try { bytes = atob(content); } catch (_) { throw new Error('图片编码损坏。'); }
    const byte = n => bytes.charCodeAt(n);
    const isPNG = bytes.length > 24 && [137,80,78,71,13,10,26,10].every((n, i) => byte(i) === n);
    const isJPEG = bytes.length > 4 && byte(0) === 255 && byte(1) === 216 && byte(2) === 255;
    const isWebP = bytes.length > 16 && bytes.slice(0, 4) === 'RIFF' && bytes.slice(8, 12) === 'WEBP';
    if (!(prefix.includes('/png') && isPNG || prefix.includes('/jpeg') && isJPEG || prefix.includes('/webp') && isWebP)) throw new Error('图片内容与声明的格式不一致。');
  }
  async function validateState(candidate) {
    if (JSON.stringify(candidate).length > MAX_STATE_CHARS) throw new Error('备份内容过大，超过 240 万字符限制。');
    exactObject(candidate, ['version','title','host','artworks','sessions','activeSessionId','isDemo'], '小展会');
    if (candidate.version !== 1) throw new Error('不支持这个备份版本。请使用本工具导出的版本 1 备份。');
    string(candidate.title, 80, '展会名字'); string(candidate.host, 40, '昵称');
    if (typeof candidate.isDemo !== 'boolean') throw new Error('示例标记不正确。');
    if (!Array.isArray(candidate.artworks) || candidate.artworks.length > MAX_ARTWORKS) throw new Error('作品数量不能超过 24 件。');
    if (!Array.isArray(candidate.sessions) || candidate.sessions.length > MAX_SESSIONS) throw new Error('回顾数量不能超过 20 场。');
    const ids = new Set();
    for (const art of candidate.artworks) {
      exactObject(art, ['id','title','words','image','included'], '作品'); id(art.id);
      if (ids.has(art.id)) throw new Error('作品编号重复。'); ids.add(art.id);
      string(art.title, 120, '作品名字'); string(art.words, 4000, '孩子原话');
      if (typeof art.included !== 'boolean') throw new Error('入展选择不正确。');
      if (art.image !== null) {
        imageSignature(art.image);
        const decoded = await decodeImage(art.image);
        if (decoded.naturalWidth > 1600 || decoded.naturalHeight > 1600) throw new Error('备份图片超过 1600 像素，请使用本工具导出的压缩图片。');
      }
    }
    const sessionIds = new Set();
    for (const session of candidate.sessions) {
      exactObject(session, ['id','startedAt','endedAt','status','index','artworkIds','records','pendingNote'], '主持记录'); id(session.id);
      if (sessionIds.has(session.id)) throw new Error('主持记录编号重复。'); sessionIds.add(session.id);
      string(session.pendingNote, 4000, '未完成的主持原话');
      date(session.startedAt); if (session.endedAt !== null) date(session.endedAt);
      if (!['running','paused','ended'].includes(session.status)) throw new Error('主持状态不正确。');
      if (!Array.isArray(session.artworkIds) || session.artworkIds.length > MAX_ARTWORKS || new Set(session.artworkIds).size !== session.artworkIds.length) throw new Error('主持顺序不正确。');
      session.artworkIds.forEach(id);
      if (!Number.isInteger(session.index) || session.index < 0 || session.index > session.artworkIds.length) throw new Error('主持进度不正确。');
      if (!Array.isArray(session.records) || session.records.length > MAX_ARTWORKS || session.records.length !== session.index) throw new Error('回顾记录不完整。');
      session.records.forEach((record, index) => {
        exactObject(record, ['artworkId','title','words','note','status','at'], '回顾'); id(record.artworkId);
        if (record.artworkId !== session.artworkIds[index]) throw new Error('回顾与主持顺序不一致。');
        string(record.title,120,'回顾作品名字'); string(record.words,4000,'回顾孩子原话'); string(record.note,4000,'回顾原话'); date(record.at);
        if (!['viewed','skipped'].includes(record.status)) throw new Error('回顾状态不正确。');
      });
      if (session.status === 'ended' && session.endedAt === null || session.status !== 'ended' && session.endedAt !== null) throw new Error('主持结束时间不正确。');
    }
    if (candidate.activeSessionId !== null) {
      id(candidate.activeSessionId);
      const active = candidate.sessions.find(item => item.id === candidate.activeSessionId);
      if (!active || active.status === 'ended' || active.index >= active.artworkIds.length || active.artworkIds.some(artId => !candidate.artworks.some(art => art.id === artId && art.included))) throw new Error('进行中的主持记录与作品不一致。');
    }
    if (candidate.sessions.some(item => item.status !== 'ended' && item.id !== candidate.activeSessionId)) throw new Error('发现没有对应进度的主持记录。');
    return candidate;
  }
  function decodeImage(source) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => img.naturalWidth && img.naturalHeight ? resolve(img) : reject(new Error('图片没有有效尺寸。'));
      img.onerror = () => reject(new Error('图片无法读取或已损坏，请换一张 PNG、JPEG 或 WebP 图片。'));
      img.src = source;
    });
  }
  async function compressImage(file) {
    if (!['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('只支持 PNG、JPEG 或 WebP 图片。');
    if (file.size > 12 * 1024 * 1024 || file.size === 0) throw new Error('图片必须大于 0 且不超过 12 MB。');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const header = String.fromCharCode(...bytes.slice(0, 16));
    const valid = file.type === 'image/png' && bytes[0] === 137 && header.slice(1,4) === 'PNG' || file.type === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 || file.type === 'image/webp' && header.slice(0,4) === 'RIFF' && header.slice(8,12) === 'WEBP';
    if (!valid) throw new Error('图片文件内容与格式不一致。请重新选择有效图片。');
    const objectURL = URL.createObjectURL(file);
    let image;
    try { image = await decodeImage(objectURL); } finally { URL.revokeObjectURL(objectURL); }
    if (image.naturalWidth * image.naturalHeight > 32000000) throw new Error('图片像素过大，请先缩小到 3200 万像素以内。');
    let scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器不支持图片处理，可先使用无图原作。');
    for (let attempt = 0; attempt < 8; attempt++) {
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.86, 0.7, 0.52]) {
        const result = canvas.toDataURL('image/webp', quality);
        if (result.length <= MAX_IMAGE_CHARS && /^data:image\/(webp|png);base64,/.test(result)) return result;
      }
      scale *= 0.75;
    }
    throw new Error('图片压缩后仍过大，请换一张更小的照片或使用原作。');
  }
  function artVisual(art, className = 'artwork-visual') {
    const visual = el('div', className);
    if (art.image) {
      const image = el('img'); image.src = art.image; image.alt = art.title ? '作品：' + art.title : '未命名作品的图片'; visual.append(image);
    } else {
      const placeholder = el('div', 'original-placeholder', '请看手边的原作');
      placeholder.append(el('small', '', '没有上传照片，也能一起看。')); visual.append(placeholder);
    }
    return visual;
  }
  function renderCollection() {
    const list = $('artwork-list'); list.replaceChildren();
    $('empty-state').hidden = state.artworks.length > 0;
    $('art-count').textContent = state.artworks.length ? state.artworks.length + ' 件作品 · ' + includedArtworks().length + ' 件入展' : '还没有作品';
    state.artworks.forEach((art, index) => {
      const row = el('article', 'artwork-row' + (art.included ? '' : ' excluded'));
      row.dataset.artId = art.id;
      row.append(artVisual(art));
      const info = el('div','artwork-info'); info.append(el('span','artwork-number',String(index + 1).padStart(2,'0')));
      const copy = el('div'); copy.append(el('h3','',artName(art)), el('p','artwork-status',art.included ? '孩子选择：这次入展' : '孩子选择：暂不展示'));
      if (art.words) copy.append(el('p','artwork-words',art.words));
      else copy.append(el('p','artwork-words','孩子还没有留下原话。'));
      const controls = el('div','artwork-actions');
      [['edit','编辑'],['toggle',art.included ? '暂不展示' : '选择入展'],['up','上移'],['down','下移'],['delete','删除']].forEach(([action,label]) => {
        const button = el('button','',label); button.type = 'button'; button.dataset.action = action; button.dataset.artId = art.id;
        if (action === 'up' && index === 0 || action === 'down' && index === state.artworks.length - 1) button.disabled = true;
        controls.append(button);
      });
      copy.append(controls); info.append(copy); row.append(info); list.append(row);
    });
    $('start-show').textContent = currentSession() ? '继续小展会 →' : '开始小展会 →';
  }
  function currentArtwork() {
    const session = currentSession();
    return session ? state.artworks.find(art => art.id === session.artworkIds[session.index] && art.included) : null;
  }
  function renderHost() {
    $('host-title').textContent = showName();
    const session = currentSession(); const art = currentArtwork();
    $('host-empty').hidden = !!art; $('host-stage').hidden = !art;
    $('host-progress').textContent = art ? (session.index + 1) + ' / ' + session.artworkIds.length : '';
    if (!art) return;
    $('host-greeting').textContent = (state.host ? state.host + '，' : '') + (state.isDemo ? '这是合成示例。' : '') + '这里由你主持，慢慢来。';
    $('stage-art').replaceChildren(...artVisual(art, '').childNodes);
    $('stage-number').textContent = '作品 ' + String(session.index + 1).padStart(2,'0');
    $('stage-title').textContent = artName(art);
    $('stage-words').textContent = art.words || '还没有留下原话，可以留白。';
    $('host-note').value = session.pendingNote || '';
    const paused = session.status === 'paused';
    $('paused-message').hidden = !paused;
    $('host-pause').textContent = paused ? '继续看作品' : '暂停一下';
    $('host-next').disabled = paused; $('host-skip').disabled = paused; $('host-note').disabled = paused;
    $('host-next').textContent = session.index === session.artworkIds.length - 1 ? '看好了，完成这一场 →' : '看好了，下一件 →';
  }
  function visibleRecord(record) {
    const art = state.artworks.find(item => item.id === record.artworkId);
    return !!art && art.included;
  }
  function renderReview() {
    $('review-list').replaceChildren();
    if (!state.sessions.length) { $('review-summary').textContent = '还没有主持记录。准备好一件愿意入展的作品，就可以开始。'; return; }
    const sessions = [...state.sessions].reverse();
    $('review-summary').textContent = '共保留 ' + sessions.length + ' 场记录。暂不展示或已删除的作品不会出现在这里或打印稿里。';
    for (const session of sessions) {
      const section = el('section','review-session');
      section.append(el('h2','',new Date(session.startedAt).toLocaleString('zh-CN') + ' 的小展会'));
      section.append(el('p','review-meta', session.status === 'ended' ? '已结束 · 看过或跳过 ' + session.records.length + ' 件' : session.status === 'paused' ? '暂停中 · 随时继续' : '进行中'));
      const records = session.records.filter(visibleRecord);
      if (!records.length) section.append(el('p','review-meta','本场还没有可展示的回顾。开始前结束、留白都可以。'));
      records.forEach(record => {
        const row = el('article','review-row');row.append(el('span','artwork-number','回顾'));
        const content = el('div'); content.append(el('h3','',record.title || '未命名作品'),el('span','review-meta',record.status === 'skipped' ? '不说也可以 / 已跳过' : '一起看过'));
        if (record.words) content.append(el('p','', '作品原话：\n' + record.words));
        if (record.note) content.append(el('p','', '这次留下的原话：\n' + record.note));
        if (!record.words && !record.note) content.append(el('p','review-meta','没有留下原话。'));
        row.append(content); section.append(row);
      });
      $('review-list').append(section);
    }
  }
  function buildPrint() {
    const output = $('print-document'); output.replaceChildren();
    const cover = el('section','print-cover'); cover.append(el('p','eyebrow',state.isDemo ? '合成示例 · 家庭小展会' : '家庭小展会'),el('h1','',showName()),el('p','print-meta',state.host ? '小主持：' + state.host : '小主持的昵称留白'),el('p','', '只展示孩子愿意入展的作品。没有评分，没有必须讲完的要求。'));
    cover.append(el('h2','','给小主持和观众的话'));
    const guidance = el('ol','print-guidance');
    ['孩子选作品、定顺序。只看愿意展示的作品。','每件作品可以说、指、安静看看，或跳过。','观众只说看到的颜色、线条与细节，问“你想让我们看哪里？”','孩子原话照原样保留，不替孩子解释。','随时暂停、结束。把原作收好，不评分、不丢弃。'].forEach(text => guidance.append(el('li','',text)));
    cover.append(guidance); output.append(cover);
    includedArtworks().forEach((art,index) => {
      const label = el('section','print-label'); label.append(el('p','eyebrow','展签 ' + String(index + 1).padStart(2,'0')),el('h2','',artName(art)));
      if (art.image) { const image = el('img','print-image'); image.src = art.image; image.alt = artName(art); label.append(image); } else label.append(el('p','print-meta','请把这张展签放在手边的原作旁。'));
      label.append(el('h3','','孩子原话'),el('p','print-words',art.words || '（留白）'),el('p','print-meta','可以说、指、安静看看，或跳过。想结束时，随时结束。')); output.append(label);
    });
    const review = el('section','print-label'); review.append(el('h2','','一起看过的回顾'));
    if (!state.sessions.length) review.append(el('p','','还没有主持记录。愿意时再开始。'));
    [...state.sessions].reverse().forEach(session => {
      review.append(el('h3','',new Date(session.startedAt).toLocaleString('zh-CN')),el('p','print-meta',session.status === 'ended' ? '本场已结束' : session.status === 'paused' ? '本场暂停中' : '本场进行中'));
      const records = session.records.filter(visibleRecord);
      if (!records.length) review.append(el('p','','还没有可展示的回顾。'));
      records.forEach(record => {
        const item = el('div','print-review-item'); item.append(el('h3','',record.title || '未命名作品'),el('p','print-meta',record.status === 'skipped' ? '不说也可以 / 已跳过' : '一起看过'),el('p','print-words','作品原话：\n' + (record.words || '（留白）')),el('p','print-words','这次留下的原话：\n' + (record.note || '（留白）'))); review.append(item);
      });
    });
    output.append(review);
  }
  function render() { renderCollection(); renderHost(); renderReview(); buildPrint(); }
  function view(name, focus = true) {
    activeView = name;
    document.querySelectorAll('[data-panel]').forEach(panel => panel.hidden = panel.dataset.panel !== name);
    document.querySelectorAll('nav [data-view]').forEach(button => {
      if (button.dataset.view === name) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
    });
    render(); if (focus) $('main').focus();
  }
  function resetEditor() {
    imageGeneration++; editingId = null; draftImage = null; imageBusy = false; imageError = false; $('artwork-form').reset();
    $('editor-mode').textContent = '添加一件作品'; $('editor-heading').textContent = '给作品留个位置'; $('save-artwork').textContent = '放进作品夹'; $('save-artwork').disabled = false; $('cancel-edit').hidden = true; $('image-preview').hidden = true; $('form-error').hidden = true;
  }
  function endForCollectionChange() {
    const session = currentSession();
    if (session) { saveHostNote(); session.status = 'ended'; session.endedAt = now(); state.activeSessionId = null; notice('作品夹已调整，当前小展会已结束；看过的回顾仍保留。准备好可以再开始。'); }
  }
  function formError(message) { $('form-error').textContent = message; $('form-error').hidden = !message; }
  function saveHostNote() {
    const session = currentSession(); if (!session) return;
    // Unfinished words are kept separately on the current artwork until the child advances.
    const art = currentArtwork();
    if (art && session.pendingNote) {
      const record = {artworkId: art.id, title: art.title, words: art.words, note: session.pendingNote, status:'viewed', at:now()};
      session.records.push(record); session.index++;session.pendingNote='';
    }
  }
  function startSession() {
    if (currentSession()) { view('host'); return; }
    if (!includedArtworks().length) { notice('还没有愿意入展的作品。先添加一件，或把孩子愿意展示的作品选择入展。', true); view('prepare'); return; }
    if (state.sessions.length >= MAX_SESSIONS) { notice('已经保留 20 场回顾。请先导出完整备份，再清空重新策展。旧记录仍保存在备份文件中。',true); return; }
    const session = {id:identifier(),startedAt:now(),endedAt:null,status:'running',index:0,artworkIds:includedArtworks().map(art => art.id),records:[],pendingNote:''};
    update(() => {state.sessions.push(session);state.activeSessionId = session.id;}); view('host');
  }
  function advance(status) {
    const session = currentSession(); const art = currentArtwork();
    if (!session || !art || session.status === 'paused') return;
    const note = $('host-note').value;
    const saved = update(() => {
      session.records.push({artworkId:art.id,title:art.title,words:art.words,note,status,at:now()});session.index++;session.pendingNote='';
      if (session.index >= session.artworkIds.length) {session.status = 'ended';session.endedAt = now();state.activeSessionId = null;}
    });
    if (!currentSession()) { if (saved) notice('今天的小展会收好了。原话和回顾留在这里。'); view('review'); }
  }
  $('show-title').addEventListener('input', event => update(() => state.title = event.target.value));
  $('host-name').addEventListener('input', event => update(() => state.host = event.target.value));
  $('show-settings').addEventListener('submit', event => event.preventDefault());
  $('art-image').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) {imageError=false;formError('');return;}
    const generation = ++imageGeneration;
    imageBusy = true; $('save-artwork').disabled = true; formError('');
    try {
      const image = await compressImage(file);
      if (generation !== imageGeneration) return;
      imageError=false;draftImage = image; $('preview-image').src = image; $('image-preview').hidden = false;
    } catch (error) { if (generation === imageGeneration) {imageError=true;formError(error.message + ' 请重新选择有效图片，或移除图片使用原作。');$('image-preview').hidden=false; }  }
    finally { if (generation === imageGeneration) {imageBusy = false;$('save-artwork').disabled = false;} }
  });
  $('remove-image').addEventListener('click', () => { imageGeneration++;imageBusy = false;imageError=false;formError('');draftImage = null;$('art-image').value = '';$('image-preview').hidden = true;$('save-artwork').disabled = false; });
  $('cancel-edit').addEventListener('click', resetEditor);
  $('artwork-form').addEventListener('submit', event => {
    event.preventDefault(); if (imageBusy) return;
    if (imageError) {formError('图片尚未成功读取。请换一张有效图片，或移除图片后使用原作。');return;}
    if (!editingId && state.artworks.length >= MAX_ARTWORKS) {formError('最多保留 24 件作品。请先备份，再删除暂时不需要的作品。');return;}
    const art = {id:editingId || identifier(),title:$('art-title').value,words:$('art-words').value,image:draftImage,included:$('art-included').checked};
    const candidate = {...state,artworks:editingId ? state.artworks.map(item => item.id === editingId ? art : item) : [...state.artworks,art]};
    if (JSON.stringify(candidate).length > MAX_STATE_CHARS) {formError('作品夹容量不足，请先导出备份，再减少图片。当前作品尚未加入。');return;}
    const saved = update(() => {endForCollectionChange();state.artworks = candidate.artworks;}); resetEditor();
    if (saved) notice(art.included ? '作品已收进本机作品夹，按孩子的选择入展。' : '作品已收进本机作品夹，暂不展示。问问孩子愿不愿意入展，再选择展示。');
  });
  $('artwork-list').addEventListener('click', event => {
    const button = event.target.closest('button[data-action]'); if (!button) return;
    const index = state.artworks.findIndex(art => art.id === button.dataset.artId); if (index < 0) return;
    const art = state.artworks[index];
    if (button.dataset.action === 'edit') {
      resetEditor(); editingId = art.id; draftImage = art.image;$('art-title').value = art.title;$('art-words').value = art.words;$('art-included').checked = art.included;$('art-excluded').checked = !art.included;
      $('editor-mode').textContent = '编辑这件作品';$('editor-heading').textContent = '照孩子的意思调整';$('save-artwork').textContent = '保存作品修改';$('cancel-edit').hidden = false;
      if (art.image) {$('preview-image').src = art.image;$('image-preview').hidden = false;} $('art-title').focus(); return;
    }
    if (button.dataset.action === 'delete' && !confirm('删除“' + artName(art) + '”？图片和展签会从本机作品夹删除。已留下的回顾原话仍保留在本机私人记录中；回顾页面与打印将隐藏这件作品。若想留住，请先导出备份。')) return;
    update(() => {
      endForCollectionChange();
      if (button.dataset.action === 'delete') state.artworks.splice(index,1);
      if (button.dataset.action === 'toggle') art.included = !art.included;
      if (button.dataset.action === 'up' && index > 0) [state.artworks[index-1],state.artworks[index]] = [state.artworks[index],state.artworks[index-1]];
      if (button.dataset.action === 'down' && index < state.artworks.length - 1) [state.artworks[index+1],state.artworks[index]] = [state.artworks[index],state.artworks[index+1]];
    });
    if (editingId === art.id && button.dataset.action === 'delete') resetEditor();
  });
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.view === 'host') {startSession();return;} view(button.dataset.view);
  }));
  $('start-show').addEventListener('click', startSession);
  $('restart-show').addEventListener('click', () => {
    if (currentSession() && !confirm('结束当前这一场并重新开始？看过的回顾会保留。')) return;
    if (currentSession()) update(() => {saveHostNote();const session = currentSession();session.status='ended';session.endedAt=now();state.activeSessionId=null;});
    startSession();
  });
  $('host-note').addEventListener('input', event => {
    const session=currentSession();if (!session) return;
    const previous = session.pendingNote;session.pendingNote=event.target.value;
    if (JSON.stringify(state).length > MAX_STATE_CHARS) {
      session.pendingNote=previous;event.target.value=previous;$('host-note-error').hidden=false;$('host-note-error').textContent='作品夹容量已满，这句话未保存。请先导出备份。';return;
    }
    $('host-note-error').hidden=true;save();
  });
  $('host-next').addEventListener('click', () => advance('viewed'));
  $('host-skip').addEventListener('click', () => advance('skipped'));
  $('host-pause').addEventListener('click', () => {
    const session = currentSession();if (!session) return;
    update(() => {session.status = session.status === 'paused' ? 'running' : 'paused';});
  });
  $('host-end').addEventListener('click', () => {
    const session = currentSession();if (!session) return;
    const saved=update(() => {saveHostNote();session.status='ended';session.endedAt=now();state.activeSessionId=null;});if (saved) notice('今天到这里就很好。愿意留下的原话已收好。');view('review');
  });
  $('print-show').addEventListener('click', () => {
    if (!includedArtworks().length) {notice('没有愿意入展的作品，先选一件再打印展签。',true);return;} buildPrint();window.print();
  });
  window.addEventListener('beforeprint', buildPrint);
  $('export-backup').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const url = URL.createObjectURL(blob);const link = el('a');link.href=url;link.download='家里的小展会-完整备份-' + new Date().toISOString().slice(0,10) + '.json';document.body.append(link);link.click();link.remove();setTimeout(() => URL.revokeObjectURL(url), 1000);notice('已请求下载完整备份（含图片）。请确认浏览器下载完成，并把文件收好。');
  });
  $('import-backup').addEventListener('change', async event => {
    const file = event.target.files[0];event.target.value = '';if (!file) return;
    try {
      if (file.size > MAX_BACKUP_BYTES || file.size === 0) throw new Error('备份文件必须大于 0 且不超过 5 MB。');
      let candidate;try {candidate=JSON.parse(await file.text());} catch (_) {throw new Error('备份不是有效的 JSON 文件。当前作品没有改变。');}
      await validateState(candidate);
      if (!confirm('备份检查通过：' + candidate.artworks.length + ' 件作品、' + candidate.sessions.length + ' 场回顾。恢复将覆盖当前小展会。建议先导出当前备份，确定覆盖吗？')) return;
      try {localStorage.setItem(STORAGE_KEY,JSON.stringify(candidate));} catch (_) {throw new Error('恢复失败：浏览器不能保存这份备份。当前小展会没有改变，请先导出或释放空间。');}
      state=candidate;storageBlocked=false;storageFailure='';resetEditor();$('show-title').value=state.title;$('host-name').value=state.host;$('save-status').textContent='已恢复并保存到当前浏览器' + (state.isDemo ? ' · 合成示例' : '');view('prepare');notice('备份已恢复到当前浏览器。图片、原话和回顾都已保留。');
    } catch (error) {notice('无法恢复备份：' + error.message,true);}
  });
  $('reset-show').addEventListener('click', () => {
    if (!confirm('清空当前小展会的全部作品、图片和回顾？无法撤销。请先导出完整备份。')) return;
    try {localStorage.removeItem(STORAGE_KEY);} catch (_) {notice('清空失败：浏览器不允许移除记录。当前小展会没有改变。',true);return;}
    state=freshState();storageBlocked=false;resetEditor();$('show-title').value='';$('host-name').value='';save();view('prepare');notice('当前小展会已清空。可以从一件原作重新开始。');
  });
  $('load-demo').addEventListener('click', () => {
    if (!confirm('加载明确标记的合成示例，会覆盖当前小展会。示例不是实际孩子或家庭的记录。请先导出当前备份，确定加载吗？')) return;
    const candidate=freshState();candidate.title='窗边的小小展览（合成示例）';candidate.host='示例小主持';candidate.isDemo=true;
    candidate.artworks=[{id:identifier(),title:'橙色的下午（合成示例）',words:'“这里的圆圆是太阳。”（合成示例原话）',image:null,included:true},{id:identifier(),title:'纸盒里的山（合成示例）',words:'',image:null,included:true},{id:identifier(),title:'先收好的线条（合成示例）',words:'',image:null,included:false}];
    try {localStorage.setItem(STORAGE_KEY,JSON.stringify(candidate));} catch (_) {notice('示例未加载：浏览器不能保存。当前小展会没有改变。',true);return;}
    state=candidate;storageBlocked=false;resetEditor();$('show-title').value=state.title;$('host-name').value=state.host;$('save-status').textContent='已保存到当前浏览器 · 合成示例';view('prepare');notice('已加载合成示例，仅展示操作方式，不代表真实家庭体验。');
  });
  async function initialize() {
    try {
      const stored=localStorage.getItem(STORAGE_KEY);
      if (stored !== null) {
        if (stored.length > MAX_STATE_CHARS) throw new Error('已保存内容超过支持的容量。');
        let parsed;try {parsed=JSON.parse(stored);} catch (_) {throw new Error('已保存内容损坏，无法读取 JSON。');}
        state=await validateState(parsed);
      }
      $('save-status').textContent = '作品只保存在当前浏览器' + (state.isDemo ? ' · 合成示例' : '');
    } catch (error) {
      storageBlocked=true;storageFailure='本机记录无法读取：' + error.message;
      $('save-status').textContent=storageFailure + ' 原记录未覆盖。';notice(storageFailure + ' 原记录未覆盖。可导入有效备份，或确认清空后重新开始；当前页面的新作品仍可导出。',true);
    }
    $('show-title').value=state.title;$('host-name').value=state.host;pendingInitialization=false;render();
  }
  document.querySelectorAll('button,input,textarea').forEach(control => {
    const preventEarly = event => {if (pendingInitialization) {event.preventDefault();event.stopImmediatePropagation();notice('正在读取本机记录，请稍等。');}};
    control.addEventListener('click',preventEarly,true);control.addEventListener('input',preventEarly,true);control.addEventListener('change',preventEarly,true);
  });
  initialize();
})();
