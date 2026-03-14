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

fetchStatus().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  els.rawText.textContent = msg;
});
resetAutoTimer();
