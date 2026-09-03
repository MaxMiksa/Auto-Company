/* devfocus — canvas-generated backgrounds (no external image assets, zero licensing risk) */
(function () {
  const canvas = document.getElementById('bg-canvas');
  const ctx = canvas.getContext('2d');
  let w, h, dpr;
  let raf = null;
  let matrixDrops = [];
  let stars = [];

  const THEMES = {
    terminal: { accent: '#39ff14', border: 'rgba(57,255,20,0.22)', borderStrong: 'rgba(57,255,20,0.5)' },
    matrix:   { accent: '#39ff14', border: 'rgba(57,255,20,0.25)', borderStrong: 'rgba(57,255,20,0.55)' },
    circuit:  { accent: '#4fd1c5', border: 'rgba(79,209,197,0.22)', borderStrong: 'rgba(79,209,197,0.5)' },
    synthwave:{ accent: '#ff6ec7', border: 'rgba(255,110,199,0.25)', borderStrong: 'rgba(255,110,199,0.55)' },
    deepspace:{ accent: '#8ea6ff', border: 'rgba(142,166,255,0.22)', borderStrong: 'rgba(142,166,255,0.5)' },
    editor:   { accent: '#61afef', border: 'rgba(97,175,239,0.2)', borderStrong: 'rgba(97,175,239,0.5)' },
    amber:    { accent: '#ffb454', border: 'rgba(255,180,84,0.25)', borderStrong: 'rgba(255,180,84,0.55)' },
    nord:     { accent: '#88c0d0', border: 'rgba(136,192,208,0.22)', borderStrong: 'rgba(136,192,208,0.5)' },
  };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.width = window.innerWidth * dpr;
    h = canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    matrixDrops = Array.from({ length: Math.floor(window.innerWidth / 22) }, () => Math.random() * -50);
    stars = Array.from({ length: 160 }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.6 * dpr + 0.3,
      p: Math.random() * Math.PI * 2,
    }));
  }

  function clear(grad) {
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  function drawTerminal(_t) {
    const g = ctx.createRadialGradient(w * 0.5, -h * 0.1, 0, w * 0.5, -h * 0.1, w * 0.7);
    g.addColorStop(0, '#0f1a13');
    g.addColorStop(1, '#07090a');
    clear(g);
  }

  function drawMatrix(_t) {
    ctx.fillStyle = 'rgba(0,4,0,1)';
    ctx.fillRect(0, 0, w, h);
    ctx.font = `${14 * dpr}px monospace`;
    const chars = 'アイウエオカキクケコサシスセソ01';
    matrixDrops.forEach((y, i) => {
      const x = i * 22 * dpr;
      const glyph = chars[Math.floor(Math.random() * chars.length)];
      ctx.fillStyle = 'rgba(57,255,20,0.55)';
      ctx.fillText(glyph, x, y * dpr);
      matrixDrops[i] += 4;
      if (matrixDrops[i] * dpr > h && Math.random() > 0.975) matrixDrops[i] = 0;
    });
    ctx.fillStyle = 'rgba(0,6,0,0.06)';
    ctx.fillRect(0, 0, w, h);
  }

  function drawCircuit() {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#050b0d');
    g.addColorStop(1, '#081512');
    clear(g);
    ctx.strokeStyle = 'rgba(79,209,197,0.18)';
    ctx.lineWidth = 1 * dpr;
    const step = 64 * dpr;
    for (let x = 0; x < w; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(79,209,197,0.35)';
    for (let x = 0; x < w; x += step) {
      for (let y = 0; y < h; y += step) {
        if (Math.random() > 0.85) ctx.fillRect(x - 2 * dpr, y - 2 * dpr, 4 * dpr, 4 * dpr);
      }
    }
  }

  function drawSynthwave() {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1a0b33');
    g.addColorStop(0.55, '#4a1856');
    g.addColorStop(1, '#ff6a3d');
    clear(g);
    const horizon = h * 0.62;
    ctx.strokeStyle = 'rgba(255,110,199,0.5)';
    ctx.lineWidth = 1.2 * dpr;
    for (let i = 1; i < 14; i++) {
      const y = horizon + i * i * 3 * dpr;
      if (y > h) break;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    const cx = w / 2;
    for (let x = -20; x <= 20; x++) {
      ctx.beginPath();
      ctx.moveTo(cx, horizon);
      ctx.lineTo(cx + x * 60 * dpr, h);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,220,150,0.85)';
    ctx.beginPath();
    ctx.arc(cx, horizon - h * 0.16, h * 0.11, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawDeepspace(t) {
    const g = ctx.createRadialGradient(w * 0.5, h * 0.3, 0, w * 0.5, h * 0.3, w);
    g.addColorStop(0, '#151235');
    g.addColorStop(1, '#020208');
    clear(g);
    ctx.fillStyle = '#fff';
    stars.forEach((s) => {
      const twinkle = 0.4 + Math.abs(Math.sin(t / 900 + s.p)) * 0.6;
      ctx.globalAlpha = twinkle;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function drawEditor() {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#161a20');
    g.addColorStop(1, '#0a0c0f');
    clear(g);
    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    for (let y = 0; y < h; y += 28 * dpr) {
      if (Math.floor(y / (28 * dpr)) % 2 === 0) ctx.fillRect(0, y, w, 14 * dpr);
    }
    ctx.fillStyle = 'rgba(97,175,239,0.06)';
    ctx.fillRect(0, 0, 46 * dpr, h);
  }

  function drawAmber() {
    const g = ctx.createRadialGradient(w * 0.5, h * 0.15, 0, w * 0.5, h * 0.15, w * 0.75);
    g.addColorStop(0, '#2a1500');
    g.addColorStop(1, '#0a0500');
    clear(g);
  }

  function drawNord() {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#2e3440');
    g.addColorStop(1, '#0f1319');
    clear(g);
  }

  const RENDERERS = {
    terminal: drawTerminal,
    matrix: drawMatrix,
    circuit: drawCircuit,
    synthwave: drawSynthwave,
    deepspace: drawDeepspace,
    editor: drawEditor,
    amber: drawAmber,
    nord: drawNord,
  };

  const STATIC_THEMES = new Set(['terminal', 'circuit', 'synthwave', 'editor', 'amber', 'nord']);

  function applyThemeVars(name) {
    const theme = THEMES[name] || THEMES.terminal;
    document.documentElement.style.setProperty('--accent', theme.accent);
    document.documentElement.style.setProperty('--panel-border', theme.border);
    document.documentElement.style.setProperty('--panel-border-strong', theme.borderStrong);
  }

  function loop(t) {
    const name = document.body.dataset.bg || 'terminal';
    const renderer = RENDERERS[name] || drawTerminal;
    renderer(t);
    if (!STATIC_THEMES.has(name)) {
      raf = requestAnimationFrame(loop);
    } else {
      raf = null;
    }
  }

  function render() {
    if (raf) cancelAnimationFrame(raf);
    const name = document.body.dataset.bg || 'terminal';
    applyThemeVars(name);
    if (STATIC_THEMES.has(name)) {
      RENDERERS[name](performance.now());
    } else {
      raf = requestAnimationFrame(loop);
    }
  }

  window.addEventListener('resize', () => { resize(); render(); });
  resize();
  render();

  window.devfocusSetBackground = function (name) {
    document.body.dataset.bg = name;
    render();
  };
})();
