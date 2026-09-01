(function () {
  'use strict';

  const STORAGE_KEY = 'devfocus.state.v1';

  const DEFAULTS = {
    background: 'terminal',
    focusMin: 25,
    shortBreakMin: 5,
    longBreakMin: 15,
    sessionsUntilLongBreak: 4,
    soundOnComplete: true,
    spotifyUrl: '',
    youtubeUrl: '',
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULTS };
      return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch (e) {
      return { ...DEFAULTS };
    }
  }

  function saveState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* storage unavailable — degrade silently, nothing persists */ }
  }

  const state = loadState();

  /* ---------------- Pomodoro timer ---------------- */

  const el = {
    display: document.getElementById('timer-display'),
    modeBadge: document.getElementById('timer-mode-badge'),
    sessionLabel: document.getElementById('timer-session'),
    sessionGoal: document.getElementById('session-goal'),
    progress: document.getElementById('timer-progress'),
    btnStart: document.getElementById('btn-start'),
    btnPause: document.getElementById('btn-pause'),
    btnReset: document.getElementById('btn-reset'),
    chime: document.getElementById('chime'),
  };

  let mode = 'focus'; // focus | short_break | long_break
  let sessionCount = 1;
  let totalSeconds = state.focusMin * 60;
  let remaining = totalSeconds;
  let ticking = null;

  function modeDuration(m) {
    if (m === 'focus') return state.focusMin * 60;
    if (m === 'short_break') return state.shortBreakMin * 60;
    return state.longBreakMin * 60;
  }

  function formatTime(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function renderTimer() {
    el.display.textContent = formatTime(remaining);
    el.modeBadge.textContent = mode === 'focus' ? 'FOCUS' : mode === 'short_break' ? 'BREAK' : 'LONG BREAK';
    el.sessionLabel.innerHTML = `# session ${sessionCount} &middot; <span id="session-goal">${state.sessionsUntilLongBreak}</span> planned`;
    const pct = totalSeconds > 0 ? ((totalSeconds - remaining) / totalSeconds) * 100 : 0;
    el.progress.style.width = `${pct}%`;
    document.title = ticking ? `${formatTime(remaining)} · ${mode === 'focus' ? 'focus' : 'break'} — devfocus` : 'devfocus — a focus workspace for developers';
  }

  function playChime() {
    if (!state.soundOnComplete) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 660;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.9);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.95);
    } catch (e) { /* Web Audio unavailable — skip the chime, timer still completed */ }
  }

  function advanceMode() {
    if (mode === 'focus') {
      const isLong = sessionCount % state.sessionsUntilLongBreak === 0;
      mode = isLong ? 'long_break' : 'short_break';
    } else {
      if (mode === 'short_break' || mode === 'long_break') sessionCount += 1;
      mode = 'focus';
    }
    totalSeconds = modeDuration(mode);
    remaining = totalSeconds;
  }

  function tick() {
    remaining -= 1;
    if (remaining <= 0) {
      playChime();
      advanceMode();
    }
    renderTimer();
  }

  function start() {
    if (ticking) return;
    ticking = setInterval(tick, 1000);
    el.btnStart.disabled = true;
    el.btnPause.disabled = false;
    renderTimer();
  }

  function pause() {
    clearInterval(ticking);
    ticking = null;
    el.btnStart.disabled = false;
    el.btnPause.disabled = true;
    renderTimer();
  }

  function reset() {
    clearInterval(ticking);
    ticking = null;
    mode = 'focus';
    sessionCount = 1;
    totalSeconds = modeDuration(mode);
    remaining = totalSeconds;
    el.btnStart.disabled = false;
    el.btnPause.disabled = true;
    renderTimer();
  }

  el.btnStart.addEventListener('click', start);
  el.btnPause.addEventListener('click', pause);
  el.btnReset.addEventListener('click', reset);

  reset();

  /* ---------------- Spotify embed ---------------- */

  function parseSpotifyEmbedUrl(raw) {
    try {
      const url = new URL(raw.trim());
      if (!url.hostname.includes('spotify.com')) return null;
      const parts = url.pathname.split('/').filter(Boolean); // [type, id] e.g. playlist, abc123
      if (parts.length < 2) return null;
      const [type, id] = parts;
      if (!['playlist', 'album', 'track', 'episode', 'show'].includes(type)) return null;
      return `https://open.spotify.com/embed/${type}/${id}?utm_source=devfocus`;
    } catch (e) {
      return null;
    }
  }

  function renderSpotify(rawUrl) {
    const wrap = document.getElementById('embed-spotify');
    const embedUrl = parseSpotifyEmbedUrl(rawUrl);
    if (!embedUrl) {
      wrap.innerHTML = '<div class="embed-placeholder">couldn\'t parse that as a Spotify playlist/album/track link</div>';
      return;
    }
    wrap.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.src = embedUrl;
    iframe.height = '152';
    iframe.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
    iframe.loading = 'lazy';
    wrap.appendChild(iframe);
  }

  const formSpotify = document.getElementById('form-spotify');
  const inputSpotify = document.getElementById('input-spotify');
  formSpotify.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = inputSpotify.value.trim();
    if (!val) return;
    state.spotifyUrl = val;
    saveState(state);
    renderSpotify(val);
  });

  if (state.spotifyUrl) {
    inputSpotify.value = state.spotifyUrl;
    renderSpotify(state.spotifyUrl);
  }

  /* ---------------- YouTube embed ---------------- */

  function parseYoutubeId(raw) {
    try {
      const url = new URL(raw.trim());
      if (url.hostname.includes('youtu.be')) {
        return url.pathname.slice(1).split('/')[0] || null;
      }
      if (url.hostname.includes('youtube.com')) {
        if (url.pathname === '/watch') return url.searchParams.get('v');
        if (url.pathname.startsWith('/embed/')) return url.pathname.split('/')[2] || null;
        if (url.pathname.startsWith('/live/')) return url.pathname.split('/')[2] || null;
        if (url.pathname.startsWith('/shorts/')) return url.pathname.split('/')[2] || null;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  function renderYoutube(rawUrl) {
    const wrap = document.getElementById('embed-youtube');
    const id = parseYoutubeId(rawUrl);
    if (!id) {
      wrap.innerHTML = '<div class="embed-placeholder">couldn\'t parse that as a YouTube video link</div>';
      return;
    }
    wrap.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&rel=0`;
    iframe.height = '210';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    iframe.loading = 'lazy';
    iframe.allowFullscreen = true;
    wrap.appendChild(iframe);
  }

  const formYoutube = document.getElementById('form-youtube');
  const inputYoutube = document.getElementById('input-youtube');
  formYoutube.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = inputYoutube.value.trim();
    if (!val) return;
    state.youtubeUrl = val;
    saveState(state);
    renderYoutube(val);
  });

  if (state.youtubeUrl) {
    inputYoutube.value = state.youtubeUrl;
    renderYoutube(state.youtubeUrl);
  }

  /* ---------------- Settings drawer ---------------- */

  const drawer = document.getElementById('drawer-settings');
  const overlay = document.getElementById('drawer-overlay');
  const btnSettings = document.getElementById('btn-settings');
  const btnCloseSettings = document.getElementById('btn-close-settings');

  function openDrawer() {
    drawer.classList.add('open');
    overlay.classList.add('open');
  }
  function closeDrawer() {
    drawer.classList.remove('open');
    overlay.classList.remove('open');
  }

  btnSettings.addEventListener('click', openDrawer);
  btnCloseSettings.addEventListener('click', closeDrawer);
  overlay.addEventListener('click', closeDrawer);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer();
  });

  /* ---------------- Background picker ---------------- */

  const bgGrid = document.getElementById('bg-grid');
  const bgSwatches = Array.from(bgGrid.querySelectorAll('.bg-swatch'));

  function setActiveSwatch(name) {
    bgSwatches.forEach((btn) => btn.classList.toggle('active', btn.dataset.bg === name));
  }

  bgSwatches.forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.bg;
      state.background = name;
      saveState(state);
      window.devfocusSetBackground(name);
      setActiveSwatch(name);
    });
  });

  window.devfocusSetBackground(state.background);
  setActiveSwatch(state.background);

  /* ---------------- Pomodoro config form ---------------- */

  const cfgFocus = document.getElementById('cfg-focus');
  const cfgShortBreak = document.getElementById('cfg-short-break');
  const cfgLongBreak = document.getElementById('cfg-long-break');
  const cfgSessions = document.getElementById('cfg-sessions');
  const cfgSound = document.getElementById('cfg-sound');
  const btnApplyTimer = document.getElementById('btn-apply-timer');

  cfgFocus.value = state.focusMin;
  cfgShortBreak.value = state.shortBreakMin;
  cfgLongBreak.value = state.longBreakMin;
  cfgSessions.value = state.sessionsUntilLongBreak;
  cfgSound.checked = state.soundOnComplete;

  btnApplyTimer.addEventListener('click', () => {
    state.focusMin = Math.max(1, Math.min(120, Number(cfgFocus.value) || DEFAULTS.focusMin));
    state.shortBreakMin = Math.max(1, Math.min(60, Number(cfgShortBreak.value) || DEFAULTS.shortBreakMin));
    state.longBreakMin = Math.max(1, Math.min(60, Number(cfgLongBreak.value) || DEFAULTS.longBreakMin));
    state.sessionsUntilLongBreak = Math.max(1, Math.min(12, Number(cfgSessions.value) || DEFAULTS.sessionsUntilLongBreak));
    state.soundOnComplete = cfgSound.checked;
    saveState(state);
    reset();
    closeDrawer();
  });
})();
