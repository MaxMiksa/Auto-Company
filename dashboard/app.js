const els = {
  pulseDot: document.getElementById("pulseDot"),
  pulseText: document.getElementById("pulseText"),
  lastUpdate: document.getElementById("lastUpdate"),
  latency: document.getElementById("latency"),

  guardianState: document.getElementById("guardianState"),
  guardianMeta: document.getElementById("guardianMeta"),
  daemonState: document.getElementById("daemonState"),
  daemonMeta: document.getElementById("daemonMeta"),
  loopState: document.getElementById("loopState"),
  loopMeta: document.getElementById("loopMeta"),
  autostartState: document.getElementById("autostartState"),
  autostartMeta: document.getElementById("autostartMeta"),

  cardGuardian: document.getElementById("cardGuardian"),
  cardDaemon: document.getElementById("cardDaemon"),
  cardLoop: document.getElementById("cardLoop"),
  cardAutostart: document.getElementById("cardAutostart"),

  stateList: document.getElementById("stateList"),
  consensusText: document.getElementById("consensusText"),
  logText: document.getElementById("logText"),
  rawText: document.getElementById("rawText"),

  vaultSubtitle: document.getElementById("vaultSubtitle"),
  vaultStats: document.getElementById("vaultStats"),
  vaultChart: document.getElementById("vaultChart"),
  vaultLatest: document.getElementById("vaultLatest"),
  vaultResults: document.getElementById("vaultResults"),
  vaultQuery: document.getElementById("vaultQuery"),
  btnVaultSearch: document.getElementById("btnVaultSearch"),
  btnVaultRefresh: document.getElementById("btnVaultRefresh"),

  btnRefresh: document.getElementById("btnRefresh"),
  btnStart: document.getElementById("btnStart"),
  btnStop: document.getElementById("btnStop"),
  btnTail: document.getElementById("btnTail"),
  btnRaw: document.getElementById("btnRaw"),
  autoToggle: document.getElementById("autoToggle"),
  refreshInterval: document.getElementById("refreshInterval"),
};

let timer = null;
let rawVisible = false;

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderInlineMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return html;
}

function renderMarkdown(md) {
  const lines = String(md || "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let inList = false;
  let inCode = false;
  let inParagraph = false;

  const closeParagraph = () => {
    if (inParagraph) {
      out.push("</p>");
      inParagraph = false;
    }
  };
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      closeParagraph();
      closeList();
      if (!inCode) {
        out.push("<pre><code>");
        inCode = true;
      } else {
        out.push("</code></pre>");
        inCode = false;
      }
      continue;
    }

    if (inCode) {
      out.push(`${escapeHtml(line)}\n`);
      continue;
    }

    if (!line.trim()) {
      closeParagraph();
      closeList();
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeParagraph();
      closeList();
      const level = h[1].length;
      out.push(`<h${level}>${renderInlineMarkdown(h[2].trim())}</h${level}>`);
      continue;
    }

    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      closeParagraph();
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${renderInlineMarkdown(li[1].trim())}</li>`);
      continue;
    }

    closeList();
    if (!inParagraph) {
      out.push("<p>");
      inParagraph = true;
    } else {
      out.push("<br />");
    }
    out.push(renderInlineMarkdown(line.trim()));
  }

  closeParagraph();
  closeList();
  if (inCode) {
    out.push("</code></pre>");
  }

  return out.join("");
}

function classForState(kind, state) {
  if (kind === "daemon") {
    if (state === "active") return "good";
    if (state === "inactive" || state === "not_installed" || state === "unsupported") return "warn";
    return "bad";
  }
  if (kind === "loop") {
    if (state === "running") return "good";
    if (state === "stopped") return "warn";
    return "bad";
  }
  if (kind === "guardian") {
    if (state === "running") return "good";
    if (state === "stopped" || state === "unsupported") return "warn";
    return "bad";
  }
  if (kind === "autostart") {
    if (state === "configured") return "good";
    if (state === "not_configured" || state === "unsupported") return "warn";
    return "bad";
  }
  return "warn";
}

function applyCardState(card, kind, state) {
  card.classList.remove("good", "warn", "bad");
  card.classList.add(classForState(kind, state));
}

function formatTime(isoText) {
  try {
    return new Date(isoText).toLocaleString();
  } catch {
    return isoText;
  }
}

function renderStateList(parsed, stateFile) {
  const rows = [
    ["Engine", parsed.loop.engine || "-"],
    ["Model", parsed.loop.model || "-"],
    ["Loop Count", parsed.loop.loopCount || stateFile.LOOP_COUNT || "-"],
    ["Error Count", parsed.loop.errorCount || stateFile.ERROR_COUNT || "-"],
    ["Last Run", parsed.loop.lastRun || stateFile.LAST_RUN || "-"],
    ["Loop Daemon Summary", parsed.loop.daemonSummary || "-"],
    ["Daemon ActiveState", parsed.daemon.activeState || "-"],
    ["Daemon SubState", parsed.daemon.subState || "-"],
  ];

  els.stateList.innerHTML = rows
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${String(v)}</dd></div>`)
    .join("");
}

async function fetchStatus() {
  const started = performance.now();
  const res = await fetch("/api/status", { cache: "no-store" });
  const data = await res.json();
  const elapsed = Math.round(performance.now() - started);

  const parsed = data.parsed || {};
  const guardian = parsed.guardian || {};
  const daemon = parsed.daemon || {};
  const loop = parsed.loop || {};
  const autostart = parsed.autostart || {};

  els.guardianState.textContent = (guardian.state || "unknown").toUpperCase();
  els.guardianMeta.textContent = guardian.pid ? `PID ${guardian.pid}` : "PID --";
  applyCardState(els.cardGuardian, "guardian", guardian.state);

  els.daemonState.textContent = (daemon.state || "unknown").toUpperCase();
  els.daemonMeta.textContent = daemon.mainPid ? `MainPID ${daemon.mainPid}` : "MainPID --";
  applyCardState(els.cardDaemon, "daemon", daemon.state);

  els.loopState.textContent = (loop.state || "unknown").toUpperCase();
  const loopCycle = loop.loopCount ? `Cycle ${loop.loopCount}` : "Cycle --";
  const loopPid = loop.pid ? `PID ${loop.pid}` : "PID --";
  els.loopMeta.textContent = `${loopCycle} | ${loopPid}`;
  applyCardState(els.cardLoop, "loop", loop.state);

  els.autostartState.textContent = (autostart.state || "unknown").toUpperCase();
  els.autostartMeta.textContent = autostart.raw || "Autostart";
  applyCardState(els.cardAutostart, "autostart", autostart.state);

  renderStateList(parsed, data.stateFile || {});

  const consensusRaw = (data.consensusHead || parsed.consensusPreview || "(no consensus)").trim();
  els.consensusText.innerHTML = renderMarkdown(consensusRaw);
  els.logText.textContent = (data.logTail || parsed.recentLog || "(no logs yet)").trim();
  els.rawText.textContent = data.raw || "";

  const healthy = data.ok && loop.state === "running" && daemon.state === "active";
  els.pulseText.textContent = healthy ? "Live Link: STABLE" : "Live Link: ATTENTION";
  els.pulseDot.style.background = healthy ? "var(--good)" : "var(--warn)";

  els.lastUpdate.textContent = `Last update: ${formatTime(data.timestamp)}`;
  els.latency.textContent = `Roundtrip: ${elapsed}ms`;
}

function drawVaultChart(bySource) {
  const canvas = els.vaultChart;
  if (!canvas || !bySource) return;
  const ctx = canvas.getContext("2d");
  const { width: W, height: H } = canvas;
  ctx.clearRect(0, 0, W, H);

  const entries = Object.entries(bySource).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (entries.length === 0) {
    ctx.fillStyle = "#5b6b7a";
    ctx.font = "14px 'Rajdhani', sans-serif";
    ctx.fillText("no chunks indexed yet", 16, H / 2);
    return;
  }

  const max = Math.max(...entries.map((e) => e[1]), 1);
  const padL = 14, padT = 14;
  const rowH = (H - padT * 2) / entries.length;
  const barMax = W - padL - 16;

  // subtle axes
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT - 4);
  ctx.lineTo(padL, H - padT);
  ctx.moveTo(padL, H - padT);
  ctx.lineTo(W - 8, H - padT);
  ctx.stroke();

  entries.forEach(([src, count], i) => {
    const y = padT + i * rowH + rowH / 2;
    const len = count / max * barMax;
    const grad = ctx.createLinearGradient(padL, 0, padL + len, 0);
    grad.addColorStop(0, "#5ee7df");
    grad.addColorStop(1, "#7c5cff");
    ctx.fillStyle = grad;
    const r = 3;
    ctx.beginPath();
    ctx.roundRect(padL, y - 7, Math.max(len, 2), 14, r);
    ctx.fill();

    // label
    ctx.fillStyle = "rgba(220,230,240,0.85)";
    ctx.font = "600 12px 'Rajdhani', sans-serif";
    let label = src.replace(/\.md$/i, "");
    if (label.length > 18) label = "…" + label.slice(-17);
    ctx.fillText(label, padL + Math.max(len, 2) + 8, y + 4);
    ctx.fillStyle = "#5ee7df";
    ctx.font = "700 12px 'Rajdhani', sans-serif";
    ctx.fillText(String(count), W - 10, y + 4);
  });
}

function truncateMiddle(text, n = 150) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  return t.slice(0, n) + "…";
}

function renderVault(data) {
  if (!data.ok || !data.stats) {
    els.vaultSubtitle.textContent = "Vault not initialized yet — will appear after the first cycle.";
    els.vaultStats.innerHTML = "<p class='muted'>Waiting for memories/vault/index.json…</p>";
    drawVaultChart(null);
    els.vaultLatest.innerHTML = "";
    return;
  }

  const s = data.stats;
  const lastIdx = data.timestamp ? "" : "";
  els.vaultSubtitle.textContent =
    `Indexed ${s.lastIndexed || "recently"} · ${s.sizeMb} MB`;

  const cols = [
    ["Chunks", s.chunks],
    ["Sources", s.sources],
    ["Distinct Terms", s.distinctTerms],
    ["Size", `${s.sizeMb} MB`],
  ];
  els.vaultStats.innerHTML = cols
    .map(([k, v]) => `<div class="vault-stat"><dt>${k}</dt><dd>${v}</dd></div>`)
    .join("");

  drawVaultChart(data.bySource || {});

  const latest = data.latest || [];
  if (latest.length) {
    els.vaultLatest.innerHTML = `<div class="vault-latest-title">Latest entries</div>` +
      latest.map((c) =>
        `<div class="vault-entry"><span class="tag">${escapeHtml(c.source)}</span>` +
        `<span class="muted mono">${escapeHtml(truncateMiddle(c.text, 110))}</span></div>`
      ).join("");
  } else {
    els.vaultLatest.innerHTML = "";
  }
}

function renderVaultSearch(data) {
  const hits = (data.search && data.search.hits) || [];
  if (!hits.length) {
    els.vaultResults.innerHTML = "<p class='muted'>No relevant memory found.</p>";
    els.vaultResults.classList.remove("hidden");
    return;
  }
  els.vaultResults.innerHTML =
    `<div class="vault-latest-title">Top ${hits.length} semantic matches</div>` +
    hits.map((h) =>
      `<div class="vault-entry"><span class="tag tag-score">${h.score.toFixed(3)}</span>` +
      `<span class="tag">${escapeHtml(h.source)}</span>` +
      `<span class="muted mono">${escapeHtml(truncateMiddle(h.text, 140))}</span></div>`
    ).join("");
  els.vaultResults.classList.remove("hidden");
}

async function fetchVault(query) {
  const qs = query ? `?q=${encodeURIComponent(query)}&top_k=6` : "?top_k=6";
  const res = await fetch(`/api/vault${qs}`, { cache: "no-store" });
  const data = await res.json();
  renderVault(data);
  if (query) renderVaultSearch(data);
  return data;
}

async function runAction(action) {
  const btn = action === "start" ? els.btnStart : els.btnStop;
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = `${label}...`;
  try {
    const res = await fetch(`/api/action/${action}`, { method: "POST" });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.output || `Action ${action} failed`);
    }
    await fetchStatus();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    alert(msg);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

function resetAutoTimer() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (els.autoToggle.checked) {
    timer = setInterval(() => {
      fetchStatus().catch(() => {});
    }, Number(els.refreshInterval.value));
  }
}

els.btnRefresh.addEventListener("click", () => fetchStatus().catch(() => {}));
els.btnStart.addEventListener("click", () => runAction("start"));
els.btnStop.addEventListener("click", () => runAction("stop"));
els.btnTail.addEventListener("click", () => fetchStatus().catch(() => {}));
els.btnRaw.addEventListener("click", () => {
  rawVisible = !rawVisible;
  els.rawText.classList.toggle("hidden", !rawVisible);
});
els.autoToggle.addEventListener("change", resetAutoTimer);
els.refreshInterval.addEventListener("change", resetAutoTimer);

els.btnVaultRefresh.addEventListener("click", () => {
  fetchVault().catch(() => {});
});
els.btnVaultSearch.addEventListener("click", () => {
  const q = els.vaultQuery.value.trim();
  if (q) fetchVault(q).catch(() => {});
});
els.vaultQuery.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const q = els.vaultQuery.value.trim();
    if (q) fetchVault(q).catch(() => {});
  }
});

fetchStatus().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  els.rawText.textContent = msg;
});
fetchVault().catch(() => {});
resetAutoTimer();
