/**
 * Static dashboard shell. Deliberately a single dependency-light HTML file —
 * no bundler, no framework, embedded as a template string so the Worker can
 * serve it with zero extra build config (Workers can't serve a filesystem
 * without an Assets/Sites binding, and this app doesn't need one for a
 * single page).
 *
 * Design direction (per .claude/skills/frontend-design.md): this is a
 * network-operations-center console, not a SaaS marketing dashboard — the
 * audience is a site owner checking "who's crawling me right now." Dark,
 * monospace, phosphor-green/amber signal colors, radar motif. Committed bit,
 * not decoration: no purple gradients, no Inter/system-ui, no card-soup.
 */
export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>BotWatch — Crawler Console</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
  :root{
    --bg:#0a0d0f;
    --bg-raised:#10151a;
    --bg-panel:#0d1216;
    --border:#1c2429;
    --border-bright:#2a353c;
    --text:#dbe8e1;
    --text-dim:#6c827a;
    --text-faint:#3f4d49;
    --green:#3ddc84;
    --green-dim:rgba(61,220,132,.14);
    --amber:#ffb454;
    --amber-dim:rgba(255,180,84,.14);
    --red:#ff5d6c;
    --red-dim:rgba(255,93,108,.14);
    --grid-line:rgba(61,220,132,.05);
  }
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;}
  body{
    background:
      linear-gradient(var(--grid-line) 1px, transparent 1px) 0 0/100% 28px,
      linear-gradient(90deg, var(--grid-line) 1px, transparent 1px) 0 0/28px 100%,
      var(--bg);
    color:var(--text);
    font-family:'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace;
    font-size:14px;
    line-height:1.5;
    min-height:100vh;
  }
  .hidden{display:none !important;}

  /* ---------- token gate ---------- */
  .gate{
    min-height:100vh;
    display:flex;
    align-items:center;
    justify-content:center;
    padding:24px;
  }
  .gate-card{
    width:100%;
    max-width:380px;
    background:var(--bg-raised);
    border:1px solid var(--border-bright);
    padding:32px 28px;
    position:relative;
    box-shadow:0 0 0 1px rgba(61,220,132,.04), 0 24px 60px -20px rgba(0,0,0,.6);
  }
  .gate-card::before{
    content:'';
    position:absolute; inset:0 0 auto 0; height:2px;
    background:linear-gradient(90deg, transparent, var(--green), transparent);
    opacity:.6;
  }
  .gate-title{
    font-size:20px; font-weight:700; letter-spacing:.14em;
    margin:0 0 4px; color:var(--text);
  }
  .gate-sub{ color:var(--text-dim); font-size:12.5px; margin:0 0 24px; }
  .gate-card input{
    width:100%; background:var(--bg-panel); border:1px solid var(--border-bright);
    color:var(--text); padding:11px 12px; font-family:inherit; font-size:13.5px;
    letter-spacing:.03em; outline:none;
  }
  .gate-card input:focus{ border-color:var(--green); }
  .gate-card button{
    width:100%; margin-top:14px; padding:11px 12px; background:var(--green);
    color:#04140a; border:none; font-family:inherit; font-weight:700;
    letter-spacing:.06em; font-size:13px; cursor:pointer; text-transform:uppercase;
  }
  .gate-card button:hover{ filter:brightness(1.08); }
  .gate-error{ color:var(--red); font-size:12.5px; margin-top:12px; min-height:16px; }

  /* ---------- app shell ---------- */
  .topbar{
    display:flex; align-items:center; justify-content:space-between;
    padding:18px 28px; border-bottom:1px solid var(--border);
    position:sticky; top:0; background:rgba(10,13,15,.92); backdrop-filter:blur(6px);
    z-index:10;
  }
  .brand{ display:flex; align-items:center; gap:12px; font-weight:700; letter-spacing:.16em; font-size:15px; }
  .radar{
    width:16px; height:16px; border-radius:50%;
    border:1px solid var(--green); position:relative; overflow:hidden;
    background:radial-gradient(circle at center, rgba(61,220,132,.08), transparent 70%);
  }
  .radar::after{
    content:''; position:absolute; inset:0;
    background:conic-gradient(from 0deg, var(--green), transparent 28%);
    animation:sweep 2.6s linear infinite;
    opacity:.9;
  }
  @keyframes sweep{ to{ transform:rotate(360deg); } }
  .brand-sub{ color:var(--text-dim); font-weight:400; letter-spacing:.06em; font-size:11px; text-transform:none; }
  .meta{ display:flex; align-items:center; gap:14px; }
  .pill{
    border:1px solid var(--border-bright); color:var(--text-dim); font-size:11px;
    padding:5px 10px; letter-spacing:.04em;
  }
  .live{ display:flex; align-items:center; gap:6px; color:var(--green); font-size:11px; letter-spacing:.08em; text-transform:uppercase; }
  .live-dot{ width:6px; height:6px; border-radius:50%; background:var(--green); animation:pulse 1.6s ease-in-out infinite; }
  @keyframes pulse{ 0%,100%{ opacity:1; box-shadow:0 0 0 0 rgba(61,220,132,.5);} 50%{ opacity:.4; box-shadow:0 0 0 5px rgba(61,220,132,0);} }
  .ghost-btn{
    background:transparent; border:1px solid var(--border-bright); color:var(--text-dim);
    font-family:inherit; font-size:11px; letter-spacing:.05em; padding:6px 10px; cursor:pointer;
  }
  .ghost-btn:hover{ color:var(--text); border-color:var(--text-dim); }

  main{ max-width:1080px; margin:0 auto; padding:28px; }

  .stats-row{ display:grid; grid-template-columns:repeat(4,1fr); gap:1px; background:var(--border); border:1px solid var(--border); margin-bottom:24px; }
  .stat-tile{ background:var(--bg-panel); padding:18px 20px; }
  .stat-label{ color:var(--text-dim); font-size:10.5px; letter-spacing:.1em; text-transform:uppercase; margin-bottom:10px; }
  .stat-value{ font-size:28px; font-weight:700; letter-spacing:-.01em; }
  .stat-value.accent-green{ color:var(--green); }
  .stat-value.accent-red{ color:var(--red); }
  .stat-sub{ color:var(--text-faint); font-size:11px; margin-top:4px; }

  .panel{ background:var(--bg-panel); border:1px solid var(--border); margin-bottom:20px; }
  .panel-head{ display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid var(--border); }
  .panel-head h2{ font-size:12.5px; letter-spacing:.08em; text-transform:uppercase; margin:0; font-weight:600; color:var(--text); }
  .hint{ color:var(--text-faint); font-size:11px; }
  .range-switch button{
    background:transparent; border:1px solid var(--border-bright); color:var(--text-dim);
    font-family:inherit; font-size:11px; padding:5px 10px; cursor:pointer;
  }
  .range-switch button + button{ border-left:none; }
  .range-switch button.active{ background:var(--green-dim); color:var(--green); border-color:var(--green); }

  .chart{ display:flex; align-items:flex-end; gap:6px; padding:24px 20px 16px; height:160px; }
  .chart-col{ flex:1; display:flex; flex-direction:column; align-items:center; gap:8px; height:100%; justify-content:flex-end; }
  .chart-bars{ width:100%; max-width:34px; display:flex; flex-direction:column-reverse; }
  .chart-bars .seg{ width:100%; }
  .chart-bars .seg.allow{ background:var(--green); }
  .chart-bars .seg.block{ background:var(--red); }
  .chart-col-label{ color:var(--text-faint); font-size:10px; letter-spacing:.02em; }

  .bot-table{ display:flex; flex-direction:column; }
  .bot-row{
    display:grid; grid-template-columns:1.6fr .9fr .6fr .6fr auto;
    align-items:center; gap:16px; padding:13px 20px; border-bottom:1px solid var(--border);
  }
  .bot-row:last-child{ border-bottom:none; }
  .bot-id .bot-name{ font-weight:600; font-size:13px; }
  .bot-id .bot-operator{ color:var(--text-dim); font-size:11px; }
  .spark{ display:flex; align-items:flex-end; gap:2px; height:22px; }
  .spark .bar{ width:5px; background:var(--border-bright); min-height:2px; }
  .spark .bar.active{ background:var(--green); }
  .col-num{ font-size:13px; }
  .col-num.dim{ color:var(--text-dim); }
  .col-num.red{ color:var(--red); }
  .toggle{ display:flex; border:1px solid var(--border-bright); overflow:hidden; }
  .toggle button{
    font-family:inherit; font-size:11px; letter-spacing:.04em; text-transform:uppercase;
    padding:7px 12px; background:transparent; color:var(--text-dim); border:none; cursor:pointer;
  }
  .toggle button + button{ border-left:1px solid var(--border-bright); }
  .toggle button.active.allow{ background:var(--green-dim); color:var(--green); }
  .toggle button.active.block{ background:var(--red-dim); color:var(--red); }
  .toggle button:disabled{ opacity:.5; cursor:wait; }

  footer{ color:var(--text-faint); font-size:11px; text-align:center; padding:20px 0 40px; letter-spacing:.02em; }

  .toast{
    position:fixed; bottom:20px; right:20px; background:var(--bg-raised);
    border:1px solid var(--red); color:var(--text); padding:12px 16px; font-size:12.5px;
    max-width:320px; box-shadow:0 12px 30px -10px rgba(0,0,0,.6);
  }

  @media (max-width:720px){
    .stats-row{ grid-template-columns:repeat(2,1fr); }
    .bot-row{ grid-template-columns:1fr; gap:8px; }
    .bot-row .spark{ display:none; }
  }
</style>
</head>
<body>

  <div id="gate" class="gate">
    <div class="gate-card">
      <p class="gate-title">BOTWATCH</p>
      <p class="gate-sub">Enter the dashboard token to open the console.</p>
      <form id="gate-form">
        <input id="gate-token" type="password" placeholder="DASHBOARD_TOKEN" autocomplete="off" autofocus />
        <button type="submit">Unlock console</button>
      </form>
      <p class="gate-error" id="gate-error"></p>
    </div>
  </div>

  <div id="app" class="app hidden">
    <header class="topbar">
      <div class="brand"><span class="radar"></span>BOTWATCH<span class="brand-sub">crawler console</span></div>
      <div class="meta">
        <span class="pill" id="site-pill">site: —</span>
        <span class="live"><span class="live-dot"></span>live</span>
        <button class="ghost-btn" id="signout-btn">sign out</button>
      </div>
    </header>

    <main>
      <section class="stats-row" id="stats-row"></section>

      <section class="panel">
        <div class="panel-head">
          <h2>Daily traffic — last <span id="range-label">7</span> days</h2>
          <div class="range-switch" id="range-switch">
            <button data-days="7" class="active">7d</button>
            <button data-days="30">30d</button>
          </div>
        </div>
        <div class="chart" id="chart"></div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>Known crawlers</h2>
          <span class="hint">click allow / block to update the rule instantly</span>
        </div>
        <div class="bot-table" id="bot-table"></div>
      </section>
    </main>

    <footer>BotWatch v1 — self-hosted on your Cloudflare Worker. Traffic data never leaves your D1 database.</footer>
  </div>

<script>
(function(){
  var TOKEN_KEY = 'botwatch_token';
  var API_BASE = window.location.pathname.replace(/\\/$/, '');
  var state = { token: localStorage.getItem(TOKEN_KEY) || '', days: 7, rules: {} };

  var gateEl = document.getElementById('gate');
  var appEl = document.getElementById('app');
  var gateForm = document.getElementById('gate-form');
  var gateTokenInput = document.getElementById('gate-token');
  var gateError = document.getElementById('gate-error');

  function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ 'Authorization': 'Bearer ' + state.token }, opts.headers || {});
    return fetch(API_BASE + path, Object.assign({}, opts, { headers: headers }))
      .then(function(res) {
        if (res.status === 401) { throw new Error('unauthorized'); }
        return res.json().then(function(data) {
          if (!res.ok) { throw new Error(data.error || ('request failed: ' + res.status)); }
          return data;
        });
      });
  }

  function showGate(message) {
    appEl.classList.add('hidden');
    gateEl.classList.remove('hidden');
    gateError.textContent = message || '';
  }

  function showApp() {
    gateEl.classList.add('hidden');
    appEl.classList.remove('hidden');
  }

  gateForm.addEventListener('submit', function(e) {
    e.preventDefault();
    var candidate = gateTokenInput.value.trim();
    if (!candidate) return;
    state.token = candidate;
    api('/api/rules').then(function() {
      localStorage.setItem(TOKEN_KEY, candidate);
      showApp();
      loadAll();
    }).catch(function() {
      gateError.textContent = 'Invalid token — check DASHBOARD_TOKEN and try again.';
    });
  });

  document.getElementById('signout-btn').addEventListener('click', function() {
    localStorage.removeItem(TOKEN_KEY);
    state.token = '';
    showGate();
  });

  document.getElementById('range-switch').addEventListener('click', function(e) {
    var btn = e.target.closest('button[data-days]');
    if (!btn) return;
    state.days = parseInt(btn.getAttribute('data-days'), 10);
    Array.prototype.forEach.call(document.querySelectorAll('#range-switch button'), function(b) {
      b.classList.toggle('active', b === btn);
    });
    document.getElementById('range-label').textContent = state.days;
    loadStats();
  });

  function fmt(n) { return n.toLocaleString('en-US'); }

  function renderStats(stats) {
    document.getElementById('site-pill').textContent = 'site: ' + stats.site_id;
    var t = stats.totals;
    var tiles = [
      { label: 'Bot requests (' + stats.range_days + 'd)', value: t.total, cls: '' },
      { label: 'Blocked', value: t.blocked, cls: 'accent-red' },
      { label: 'Allowed', value: t.allowed, cls: 'accent-green' },
      { label: 'Distinct crawlers seen', value: t.distinct_bots_seen, cls: '' }
    ];
    document.getElementById('stats-row').innerHTML = tiles.map(function(tile) {
      return '<div class="stat-tile"><div class="stat-label">' + tile.label + '</div>' +
        '<div class="stat-value ' + tile.cls + '">' + fmt(tile.value) + '</div></div>';
    }).join('');
  }

  function renderChart(stats) {
    var max = Math.max(1, Math.max.apply(null, stats.daily.map(function(d) { return d.allowed + d.blocked; })));
    document.getElementById('chart').innerHTML = stats.daily.map(function(d) {
      var total = d.allowed + d.blocked;
      var h = Math.max(2, Math.round((total / max) * 120));
      var allowH = total ? Math.round((d.allowed / total) * h) : 0;
      var blockH = total ? h - allowH : 0;
      var label = d.date.slice(5);
      return '<div class="chart-col" title="' + d.date + ': ' + fmt(total) + ' requests (' + fmt(d.blocked) + ' blocked)">' +
        '<div class="chart-bars" style="height:' + h + 'px">' +
          (blockH ? '<div class="seg block" style="height:' + blockH + 'px"></div>' : '') +
          (allowH ? '<div class="seg allow" style="height:' + allowH + 'px"></div>' : '') +
        '</div>' +
        '<div class="chart-col-label">' + label + '</div>' +
      '</div>';
    }).join('');
  }

  function renderSpark(daily) {
    var max = Math.max(1, Math.max.apply(null, daily));
    return '<div class="spark">' + daily.map(function(v) {
      var h = Math.max(2, Math.round((v / max) * 20));
      return '<div class="bar' + (v > 0 ? ' active' : '') + '" style="height:' + h + 'px"></div>';
    }).join('') + '</div>';
  }

  function renderBotTable(stats) {
    var rows = stats.bots.map(function(bot) {
      var action = state.rules[bot.name] || 'allow';
      return '<div class="bot-row" data-bot="' + bot.name + '">' +
        '<div class="bot-id"><div class="bot-name">' + bot.name + '</div><div class="bot-operator">' + bot.operator + '</div></div>' +
        renderSpark(bot.daily) +
        '<div class="col-num">' + fmt(bot.total) + '</div>' +
        '<div class="col-num' + (bot.blocked ? ' red' : ' dim') + '">' + fmt(bot.blocked) + ' blocked</div>' +
        '<div class="toggle" data-bot="' + bot.name + '">' +
          '<button data-action="allow" class="' + (action === 'allow' ? 'active allow' : '') + '">Allow</button>' +
          '<button data-action="block" class="' + (action === 'block' ? 'active block' : '') + '">Block</button>' +
        '</div>' +
      '</div>';
    }).join('');
    document.getElementById('bot-table').innerHTML = rows;
  }

  function showToast(message) {
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(function() { el.remove(); }, 4000);
  }

  document.getElementById('bot-table').addEventListener('click', function(e) {
    var btn = e.target.closest('button[data-action]');
    if (!btn) return;
    var group = btn.closest('.toggle');
    var botName = group.getAttribute('data-bot');
    var action = btn.getAttribute('data-action');
    var buttons = group.querySelectorAll('button');
    Array.prototype.forEach.call(buttons, function(b) { b.disabled = true; });

    api('/api/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bot_name: botName, action: action })
    }).then(function() {
      state.rules[botName] = action;
      Array.prototype.forEach.call(buttons, function(b) {
        b.disabled = false;
        var isActive = b.getAttribute('data-action') === action;
        b.className = isActive ? 'active ' + action : '';
      });
    }).catch(function(err) {
      Array.prototype.forEach.call(buttons, function(b) { b.disabled = false; });
      showToast('Could not update rule: ' + err.message);
    });
  });

  function loadStats() {
    return api('/api/stats?days=' + state.days).then(function(stats) {
      renderStats(stats);
      renderChart(stats);
      renderBotTable(stats);
    });
  }

  function loadRules() {
    return api('/api/rules').then(function(data) {
      state.rules = {};
      data.rules.forEach(function(r) { state.rules[r.bot_name] = r.action; });
    });
  }

  function loadAll() {
    loadRules().then(loadStats).catch(function(err) {
      if (err.message === 'unauthorized') {
        localStorage.removeItem(TOKEN_KEY);
        showGate('Session expired — enter the token again.');
      } else {
        showToast('Failed to load dashboard: ' + err.message);
      }
    });
  }

  if (state.token) {
    showApp();
    loadAll();
  } else {
    showGate();
  }
})();
</script>
</body>
</html>
`;
