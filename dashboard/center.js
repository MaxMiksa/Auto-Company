(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const API = "/api/center/v1";
  const OPEN_STATES = new Set(["queued", "starting", "running", "stopping", "attention", "preparing"]);
  const TERMINAL_STATES = new Set(["ended", "failed", "canceled"]);
  const state = {
    language: "zh-CN", revision: null, centerId: null, observedAt: null,
    summary: null, entries: [], requests: [], preferences: null,
    query: "", filter: "all", loading: true, stale: false, refreshing: null,
    refreshToken: 0, timer: null, menuEntryId: null, historyVisible: false,
    activeEntry: null, managementEntry: null, selectedSourceId: null, sourceToken: 0, probe: null, confirmAction: null, drawerOpen: false, pendingWrites: new Map(),
  };

  function message(key, values = {}) {
    const dictionary = window.CENTER_MESSAGES[state.language] || window.CENTER_MESSAGES.en;
    return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), dictionary[key] || key);
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function clear(node) { node.replaceChildren(); return node; }
  function text(value) { return typeof value === "string" ? value.trim() : ""; }
  function knownNumber(value) { return Number.isFinite(value) && value >= 0; }
  function idempotencyKey() { return globalThis.crypto?.randomUUID?.() || `center-${Date.now()}-${Math.random().toString(16).slice(2)}`; }

  class APIError extends Error {
    constructor(payload, status) {
      super(payload?.message || payload?.messageKey || `HTTP ${status}`);
      this.code = payload?.code || "UNKNOWN";
      this.messageKey = payload?.messageKey || "";
      this.params = payload?.params || {};
      this.status = status;
    }
  }

  async function api(path, options = {}, timeout = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(`${API}${path}`, { cache: "no-store", ...options, signal: controller.signal });
      let payload;
      try { payload = await response.json(); }
      catch (_) { throw new APIError({ code: "INVALID_RESPONSE", messageKey: "invalidResponse" }, response.status); }
      if (!response.ok || payload?.code) throw new APIError(payload, response.status);
      if (!payload || payload.schemaVersion !== 1 || !Object.hasOwn(payload, "data")) throw new APIError({ code: "INVALID_RESPONSE", messageKey: "invalidResponse" }, response.status);
      if (payload.centerId) state.centerId = payload.centerId;
      if (Number.isFinite(payload.revision)) state.revision = payload.revision;
      if (payload.observedAt) state.observedAt = payload.observedAt;
      return payload.data;
    } finally { clearTimeout(timer); }
  }

  async function write(path, body, timeout = 30000) {
    const signature = `${path}\n${JSON.stringify(body)}`;
    const key = body.idempotencyKey || state.pendingWrites.get(signature) || idempotencyKey(); state.pendingWrites.set(signature, key);
    const value = { ...body, idempotencyKey: key };
    try {
      const result = await api(path, { method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": key }, body: JSON.stringify(value) }, timeout);
      state.pendingWrites.delete(signature); return result;
    } catch (error) { throw error; }
  }

  function errorText(error) {
    const map = {
      SOURCE_MISSING: "sourceMissing", SOURCE_CONFLICT: "sourceConflict", SOURCE_CHANGED: "sourceChanged",
      READ_ONLY_SOURCE: "readOnlySource", CONTEXT_UNAVAILABLE: "contextUnavailable", RUNTIME_INCOMPATIBLE: "runtimeIncompatible",
      SLOT_BUSY: "slotBusy", DISPATCH_UNCERTAIN: "dispatchUncertain", STOP_UNCONFIRMED: "stopUnconfirmed",
      GOVERNANCE_PAUSED: "governancePaused", BUDGET_PAUSED: "budgetPaused", CURSOR_EXPIRED: "cursorExpired",
      REVISION_CONFLICT: "revisionConflict", UNSUPPORTED: "unsupported", INVALID_RESPONSE: "invalidResponse",
      EXECUTION_DOMAIN_UNCONFIGURED: "executionUnavailable", OPEN_REQUEST_EXISTS: "openRequestExists",
      PRODUCT_LANGUAGE_LOCKED: "productLanguageLocked", RECOVERY_REQUIRED: "recoveryRequired", INVALID_CONFIG: "invalidConfig",
    };
    const key = map[error?.code] || (error?.messageKey && window.CENTER_MESSAGES.en[error.messageKey] ? error.messageKey : null);
    return key ? message(key, error.params) : text(error?.message) || message("unknownError");
  }

  function languageLabel(value) { return message(value === "zh-CN" ? "language_zh" : value === "en" ? "language_en" : "notRecorded"); }
  function formatTime(value, relative = false) {
    if (!value || !Number.isFinite(Date.parse(value))) return message("unknownTime");
    const date = new Date(value);
    if (relative) {
      const seconds = Math.round((Date.now() - date.getTime()) / 1000);
      if (seconds >= 0 && seconds < 60) return state.language === "zh-CN" ? "刚刚" : "Just now";
      if (seconds >= 60 && seconds < 3600) return state.language === "zh-CN" ? `${Math.floor(seconds / 60)} 分钟前` : `${Math.floor(seconds / 60)}m ago`;
      if (seconds >= 3600 && seconds < 86400) return state.language === "zh-CN" ? `${Math.floor(seconds / 3600)} 小时前` : `${Math.floor(seconds / 3600)}h ago`;
    }
    return new Intl.DateTimeFormat(state.language, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  }

  function requestState(request) { return text(request?.state).toLowerCase() || "unknown"; }
  function execution(entry) { return typeof entry?.executionSummary === "object" && entry.executionSummary ? entry.executionSummary : { state: text(entry?.executionSummary) }; }
  function entryState(entry) {
    if (entry?.archived) return "archived";
    const value = text(execution(entry).state).toLowerCase();
    if (["running", "starting", "stopping", "queued", "attention", "failed", "ended", "canceled", "preparing", "paused", "unknown"].includes(value)) return value;
    const availability = entry?.availability?.state || entry?.availability;
    if (["unknown", "unavailable", "conflict"].includes(availability)) return "unknown";
    if (availability === "read_only" || (value === "idle" && entry?.capabilities?.execute === false)) return "read_only";
    return "idle";
  }

  function statusLabel(value) {
    const key = `state_${value}`;
    return window.CENTER_MESSAGES[state.language][key] || message("state_unknown");
  }
  function phaseLabel(value) { const key = `phase_${value}`; return window.CENTER_MESSAGES[state.language][key] || value; }

  function capability(entry, name) {
    const raw = entry?.capabilities?.[name];
    const enabled = raw === true || raw?.enabled === true;
    const availability = typeof entry?.availability === "object" ? entry.availability : {};
    const reason = text(raw?.reason || raw?.reasonCode || entry?.capabilityReasons?.[name] || (["preview", "capture"].includes(name) ? entry?.capabilityReasons?.media : "") || availability?.reasons?.[name] || availability?.reason);
    return { enabled, reason };
  }

  function capabilityReason(reason, fallback = "capabilityUnavailable") {
    if (!reason) return message(fallback);
    const known = { unmanaged_source: "unmanagedSource", read_only_source: "readOnlySource", execution_domain_unconfigured: "executionUnavailable", runtime_incompatible: "runtimeIncompatible", slot_busy: "slotBusy", open_request_exists: "openRequestExists", source_unavailable: "sourceUnavailableReason", entry_archived: "archiveBlocked", SOURCE_UNAVAILABLE: "sourceUnavailableReason", ENTRY_ARCHIVED: "archiveBlocked" };
    if (window.CENTER_MESSAGES[state.language][reason]) return message(reason);
    return known[reason] ? message(known[reason]) : errorText({ code: reason });
  }

  async function allEntries() {
    const items = []; let cursor = null; let total = null; const seen = new Set();
    do {
      const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
      const page = await api(`/entries?filter=all&sort=activity&limit=100${suffix}`);
      if (!page || !Array.isArray(page.items)) throw new APIError({ code: "INVALID_RESPONSE" }, 200);
      items.push(...page.items); total = page.total; cursor = page.nextCursor || null;
      if (cursor && seen.has(cursor)) throw new APIError({ code: "INVALID_RESPONSE" }, 200);
      if (cursor) seen.add(cursor);
    } while (cursor);
    if (knownNumber(total) && items.length !== total) throw new APIError({ code: "INVALID_RESPONSE" }, 200);
    return { items, total: total ?? items.length };
  }

  function normalizeCounts() {
    const fromSummary = state.summary?.counts || {};
    const counts = { all: state.entries.filter((entry) => !entry.archived && ["product", "legacy"].includes(entry.kind)).length, running: 0, queued: 0, attention: 0, archived: 0 };
    for (const entry of state.entries) {
      const value = entryState(entry);
      if (value === "archived") counts.archived += 1;
      if (entry.kind !== "exploration" && ["running", "starting", "stopping"].includes(value)) counts.running += 1;
      if (entry.kind !== "exploration" && value === "queued") counts.queued += 1;
      if (entry.kind !== "exploration" && ["attention", "failed", "unknown"].includes(value)) counts.attention += 1;
    }
    for (const key of Object.keys(counts)) if (knownNumber(fromSummary[key])) counts[key] = fromSummary[key];
    if (knownNumber(state.summary?.queuedCount)) counts.queued = state.summary.queuedCount;
    if (knownNumber(state.summary?.attentionCount)) counts.attention = state.summary.attentionCount;
    return counts;
  }

  function filteredEntries() {
    const query = state.query.toLocaleLowerCase(state.language);
    return state.entries.filter((entry) => {
      const value = entryState(entry);
      const filterMatch = state.filter === "all" ? !entry.archived && entry.kind !== "exploration"
        : state.filter === "running" ? entry.kind !== "exploration" && ["running", "starting", "stopping"].includes(value)
        : state.filter === "queued" ? entry.kind !== "exploration" && value === "queued"
        : state.filter === "attention" ? entry.kind !== "exploration" && ["attention", "failed", "unknown"].includes(value)
        : state.filter === "archived" ? entry.archived === true
        : state.filter === "exploration" ? entry.kind === "exploration" && !entry.archived
        : state.filter === "reference" ? entry.kind === "reference" && !entry.archived : true;
      if (state.filter === "all" && entry.kind === "reference") return false;
      if (!filterMatch) return false;
      if (!query) return true;
      return [entry.displayName, entry.description, entry.alias].some((value) => text(value).toLocaleLowerCase(state.language).includes(query));
    });
  }

  function emptyListState(entries = filteredEntries()) {
    if (entries.length) return null;
    if (state.stale && !state.entries.length) return { messageKey: "loadFailed" };
    if (state.query || state.filter !== "all") return { messageKey: "noMatches", actionKey: "clearFilters", target: "all" };
    const hasProduct = state.entries.some((entry) => !entry.archived && ["product", "legacy"].includes(entry.kind));
    if (!hasProduct) return { messageKey: "noFormedProducts", actionKey: "viewExplorations", target: "exploration" };
    return { messageKey: "noProducts" };
  }

  function safeAssetURL(value) {
    if (typeof value !== "string" || !value.startsWith(`${API}/`)) return null;
    try { const url = new URL(value, location.origin); return url.origin === location.origin && url.pathname.startsWith(`${API}/`) ? `${url.pathname}${url.search}` : null; }
    catch (_) { return null; }
  }

  function fallbackIcon(kind) {
    const box = element("span", "product-icon");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 42 42"); svg.setAttribute("aria-hidden", "true");
    const shapes = kind === "exploration"
      ? '<circle cx="19" cy="19" r="12"></circle><path d="m28 28 8 8M19 12v14M12 19h14"></path>'
      : kind === "legacy"
        ? '<path d="M9 5h17l7 7v25H9zM26 5v8h7M15 21h12M15 27h12"></path>'
        : '<path d="M7 8h28v26H7zM21 8v26M7 17h28"></path>';
    svg.innerHTML = shapes; box.append(svg); return box;
  }

  function entryIcon(entry) {
    const href = safeAssetURL(entry.iconUrl);
    if (!href) return fallbackIcon(entry.kind);
    const box = element("span", "product-icon");
    const image = element("img"); image.src = href; image.alt = ""; image.width = image.height = 42;
    image.addEventListener("error", () => box.replaceChildren(fallbackIcon(entry.kind).firstChild), { once: true });
    box.append(image); return box;
  }

  function statusSymbol(value) {
    const visual = ["running", "starting", "stopping"].includes(value) ? "running"
      : value === "queued" ? "queued" : ["paused", "ended", "archived", "read_only"].includes(value) ? "paused"
      : value === "attention" ? "attention" : value === "failed" ? "failed" : "unknown";
    const node = element("span", `status-symbol ${visual}`);
    node.setAttribute("role", "img"); node.setAttribute("aria-label", statusLabel(value));
    return node;
  }

  function detailURL(entry) { return `/products/${encodeURIComponent(entry.entryId)}`; }

  function renderRow(entry) {
    const row = element("article", "product-row"); row.setAttribute("role", "row"); row.dataset.entryId = entry.entryId;
    const identity = element("div", "product-identity"); identity.setAttribute("role", "cell");
    const copy = element("div");
    const name = element("h3", "product-name", text(entry.displayName) || message("fieldMissing")); name.title = name.textContent;
    const description = element("p", "product-description", text(entry.description) || message("purposeMissing"));
    copy.append(name, description); identity.append(entryIcon(entry), copy);

    const recent = element("div", "recent-work"); recent.setAttribute("role", "cell");
    const title = element("p", "work-title", text(entry.latestTitle) || message("workMissing")); title.title = title.textContent;
    const meta = [];
    if (knownNumber(entry.cycleNumber)) meta.push(message("cycleNumber", { number: String(entry.cycleNumber).padStart(2, "0") }));
    if (text(entry.reportedPhase)) meta.push(message("phaseRecorded", { phase: phaseLabel(entry.reportedPhase) }));
    recent.append(title, element("p", "work-meta", meta.join(" · ") || message("phaseUnknown")));

    const value = entryState(entry);
    const status = element("div", "status-cell"); status.setAttribute("role", "cell");
    const statusCopy = element("div"); statusCopy.append(element("strong", "", statusLabel(value)));
    const summary = execution(entry);
    const position = summary.queuePosition || summary.position;
    const detail = value === "queued" && knownNumber(position) ? message("queuePosition", { position })
      : summary.reason === "unmanaged_source" ? message("unmanagedSource") : "";
    if (detail) statusCopy.append(element("p", "status-detail", detail));
    status.append(statusSymbol(value), statusCopy);

    const activity = element("time", "activity-time", formatTime(entry.lastActivityAt, true)); activity.setAttribute("role", "cell");
    if (entry.lastActivityAt) { activity.dateTime = entry.lastActivityAt; activity.title = formatTime(entry.lastActivityAt); }

    const actions = element("div", "row-actions"); actions.setAttribute("role", "cell");
    if (entry.kind !== "reference") { const view = element("a", "", message("view")); view.href = detailURL(entry); actions.append(view); }
    const execute = capability(entry, "execute");
    if (execute.enabled && !entry.archived && ["product", "exploration"].includes(entry.kind)) {
      const continueButton = element("button", "text-button continue-inline", message("continue")); continueButton.type = "button";
      continueButton.addEventListener("click", () => openContinue(entry)); actions.append(continueButton);
    }
    const menu = element("div", "action-menu");
    const more = element("button", "more-button", "⋮"); more.type = "button"; more.setAttribute("aria-label", message("moreActions")); more.setAttribute("aria-expanded", String(state.menuEntryId === entry.entryId));
    more.addEventListener("click", (event) => { event.stopPropagation(); state.menuEntryId = state.menuEntryId === entry.entryId ? null : entry.entryId; renderEntries(); });
    menu.append(more);
    if (state.menuEntryId === entry.entryId) {
      const content = element("div", "menu-content");
      if (["product", "exploration"].includes(entry.kind) && !entry.archived) {
        const continueMenu = element("button", "", message("continue")); continueMenu.type = "button"; continueMenu.disabled = !execute.enabled; continueMenu.addEventListener("click", () => openContinue(entry)); content.append(continueMenu);
        if (!execute.enabled) content.append(element("div", "menu-reason", execute.reason ? message("unavailableReason", { reason: execute.reason }) : message("capabilityUnavailable")));
      }
      const manageButton = element("button", "", message("manageSources")); manageButton.type = "button";
      manageButton.addEventListener("click", () => openSourceManager(entry)); content.append(manageButton);
      const archiveButton = element("button", "", message(entry.archived ? "restore" : "archive")); archiveButton.type = "button";
      archiveButton.addEventListener("click", () => confirmEntryVisibility(entry)); content.append(archiveButton);
      if (entry.kind === "reference" && !entry.archived) {
        const detachButton = element("button", "danger", message("detachReference")); detachButton.type = "button";
        detachButton.addEventListener("click", () => confirmReferenceDetach(entry)); content.append(detachButton);
      }
      menu.append(content);
    }
    actions.append(menu);
    row.append(identity, recent, status, activity, actions);
    return row;
  }

  function renderEntries() {
    const container = clear($("productRows"));
    const listState = clear($("listState"));
    if (state.loading && !state.entries.length) { listState.textContent = message("loading"); return; }
    const entries = filteredEntries();
    for (const entry of entries) container.append(renderRow(entry));
    if (!entries.length) {
      const emptyState = emptyListState(entries);
      listState.append(element("span", "", message(emptyState.messageKey)));
      if (emptyState.actionKey) {
        const action = element("button", "text-button", message(emptyState.actionKey)); action.type = "button";
        action.addEventListener("click", () => { state.query = ""; $("productSearch").value = ""; setFilter(emptyState.target); });
        listState.append(action);
      }
    }
  }

  function renderActivity() {
    const request = state.summary?.currentRequest;
    const icon = $("activityIcon"); icon.classList.toggle("idle", !request);
    const link = $("activityLink");
    if (!request) {
      $("activityTitle").textContent = message("noCurrentWork");
      $("activityDetail").textContent = state.summary?.queuedCount ? message("queuedCount", { count: state.summary.queuedCount }) : "";
      link.hidden = true; return;
    }
    $("activityTitle").textContent = text(request.displayName) || message(`kind_${request.kind}`);
    const parts = [statusLabel(requestState(request))];
    if (knownNumber(request.cycleNumber)) parts.unshift(message("currentCycle", { number: String(request.cycleNumber).padStart(2, "0") }));
    if (request.startedAt) parts.push(message("startedAt", { time: formatTime(request.startedAt, true) }));
    $("activityDetail").textContent = parts.join(" · ");
    link.hidden = !request.entryId; if (request.entryId) link.href = `/products/${encodeURIComponent(request.entryId)}`;
  }

  function renderCounts() {
    const counts = normalizeCounts();
    for (const key of ["All", "Running", "Queued", "Attention", "Archived"]) $(`count${key}`).textContent = counts[key.toLowerCase()] ? String(counts[key.toLowerCase()]) : "";
    const queueCount = (counts.queued || 0) + (counts.running || 0) + (counts.attention || 0);
    $("queueNavCount").hidden = !queueCount; $("queueNavCount").textContent = String(queueCount);
  }

  function applyLanguage() {
    document.documentElement.lang = state.language;
    document.title = `Auto Company · ${message("products")}`;
    document.querySelectorAll("[data-i18n]").forEach((node) => { node.textContent = message(node.dataset.i18n); });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => { node.placeholder = message(node.dataset.i18nPlaceholder); });
    document.querySelectorAll("[data-i18n-aria]").forEach((node) => { node.setAttribute("aria-label", message(node.dataset.i18nAria)); });
  }

  function renderPage() {
    applyLanguage(); renderActivity(); renderCounts(); renderEntries(); renderQueue();
    const executionAvailable = state.summary?.executionAvailable !== false;
    $("newWorkButton").disabled = state.stale || !executionAvailable;
    $("newWorkButton").title = !executionAvailable ? message("executionUnavailable") : "";
    $("connectionNotice").hidden = !state.stale;
    $("connectionNotice").textContent = message(state.entries.length ? "staleData" : "loadFailed");
    $("observedAt").textContent = state.observedAt ? message(state.stale ? "observedStale" : "refreshedAt", { time: formatTime(state.observedAt) }) : "";
    document.querySelectorAll(".filter-button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.filter === state.filter)));
  }

  function queueGroups() {
    const groups = { running: [], queued: [], attention: [], history: [] };
    for (const request of state.requests) {
      const value = requestState(request);
      if (["running", "starting", "stopping"].includes(value)) groups.running.push(request);
      else if (value === "queued") groups.queued.push(request);
      else if (value === "attention") groups.attention.push(request);
      else if (TERMINAL_STATES.has(value)) groups.history.push(request);
      else if (value === "preparing") groups.attention.push(request);
    }
    groups.queued.sort((a, b) => (a.queuePosition ?? a.position ?? Infinity) - (b.queuePosition ?? b.position ?? Infinity));
    return groups;
  }

  function queueItem(request, index, group, queued) {
    const item = element("article", "queue-item");
    item.append(element("span", "queue-number", group === "queued" ? String(index + 1).padStart(2, "0") : ""));
    const body = element("div"); body.append(element("h4", "", text(request.displayName) || message(`kind_${request.kind}`)));
    const value = requestState(request);
    body.append(element("p", "", `${statusLabel(value)}${request.cycleNumber ? ` · ${message("cycleNumber", { number: String(request.cycleNumber).padStart(2, "0") })}` : ""}`));
    const config = request.config || {};
    if (config.model || config.effort) body.append(element("p", "", message("plannedConfig", { model: config.model || message("notRecorded"), effort: config.effort || message("notRecorded") })));
    if (config.productLanguage) body.append(element("p", "", message("languageConfig", { language: languageLabel(config.productLanguage) })));
    if (request.attentionReason || request.reasonDetail || request.terminalReason) body.append(element("p", "", message("attentionReason", { reason: request.reasonDetail || request.attentionReason || request.terminalReason })));
    const actions = element("div", "queue-actions");
    if (["running", "starting", "stopping"].includes(value)) {
      const stop = element("button", "text-button danger", message("stopItem")); stop.type = "button"; stop.disabled = value === "stopping" || state.stale; stop.addEventListener("click", () => confirmRequestAction(request, "stop")); actions.append(stop);
    } else if (group === "queued") {
      const up = element("button", "text-button", message("moveUp")); up.type = "button"; up.disabled = index === 0 || state.stale; up.addEventListener("click", () => moveRequest(index, -1, queued));
      const down = element("button", "text-button", message("moveDown")); down.type = "button"; down.disabled = index === queued.length - 1 || state.stale; down.addEventListener("click", () => moveRequest(index, 1, queued));
      const cancel = element("button", "text-button danger", message("cancelItem")); cancel.type = "button"; cancel.disabled = state.stale; cancel.addEventListener("click", () => confirmRequestAction(request, "cancel"));
      actions.append(up, down, cancel);
    } else if (group === "attention") {
      const reconcile = element("button", "text-button", message("reconcile")); reconcile.type = "button"; reconcile.disabled = state.stale; reconcile.addEventListener("click", () => runRequestAction(request, "reconcile")); actions.append(reconcile);
    }
    item.append(body, actions); return item;
  }

  function queueSection(titleKey, items, group, queued) {
    const section = element("section", "queue-section");
    section.append(element("h3", "", message(titleKey, { count: items.length })));
    items.forEach((request, index) => section.append(queueItem(request, index, group, queued)));
    return section;
  }

  function renderQueue() {
    const enabled = state.summary?.dispatchEnabled === true;
    $("dispatchLabel").textContent = message(enabled ? "dispatchOn" : "dispatchOff");
    $("dispatchHint").textContent = message(enabled ? "dispatchOnHint" : "dispatchOffHint");
    $("dispatchButton").textContent = message(enabled ? "pauseQueue" : "resumeQueue");
    $("dispatchButton").disabled = state.stale || (!enabled && state.summary?.executionAvailable === false);
    $("dispatchButton").title = !enabled && state.summary?.executionAvailable === false ? message("executionUnavailable") : "";
    const content = clear($("queueContent"));
    const groups = queueGroups();
    if (groups.running.length) content.append(queueSection("runningSection", groups.running, "running", groups.queued));
    if (groups.queued.length) content.append(queueSection("queuedSection", groups.queued, "queued", groups.queued));
    if (groups.attention.length) content.append(queueSection("attentionSection", groups.attention, "attention", groups.queued));
    if (state.historyVisible && groups.history.length) content.append(queueSection("historySection", groups.history, "history", groups.queued));
    if (!groups.running.length && !groups.queued.length && !groups.attention.length && !(state.historyVisible && groups.history.length)) content.append(element("p", "list-state", message("queueEmpty")));
    $("queueHistoryButton").textContent = message(state.historyVisible ? "hideHistory" : "showHistory");
    $("stopAllButton").disabled = state.stale || (!groups.running.length && !groups.queued.length);
  }

  async function refresh() {
    if (state.refreshing) return state.refreshing;
    const token = ++state.refreshToken;
    const promise = (async () => {
      try {
        const [summary, entries, requests, preferences] = await Promise.all([
          api("/summary"), allEntries(), api("/requests?limit=100"), api("/preferences"),
        ]);
        if (token !== state.refreshToken) return;
        if (!summary || !Array.isArray(entries?.items) || !Array.isArray(requests?.items)) throw new APIError({ code: "INVALID_RESPONSE" }, 200);
        state.summary = summary; state.entries = entries.items; state.requests = requests.items; state.preferences = preferences; state.loading = false; state.stale = false;
        const language = summary.language || state.preferences?.language;
        if (["en", "zh-CN"].includes(language)) state.language = language;
        renderPage();
      } catch (_) {
        if (token !== state.refreshToken) return;
        state.loading = false; state.stale = true; renderPage();
      } finally {
        state.refreshing = null; clearTimeout(state.timer); state.timer = setTimeout(refresh, state.stale ? 15000 : 5000);
      }
    })();
    state.refreshing = promise; return promise;
  }

  function showStatus(key, values = {}, isError = false) {
    const node = $("globalStatus"); node.hidden = false; node.textContent = message(key, values); node.style.background = isError ? "#781e1e" : "";
    clearTimeout(showStatus.timer); showStatus.timer = setTimeout(() => { node.hidden = true; }, 5000);
  }

  function setFormStatus(form, value, isError = false) {
    const node = form.querySelector(".form-status"); node.textContent = value; node.classList.toggle("error", isError);
  }

  function fillDefaults(form, productLanguage) {
    const defaults = state.preferences?.defaults || state.preferences || state.summary?.defaults || {};
    for (const name of ["engine", "model", "effort", "productLanguage"]) {
      const field = form.elements[name]; if (!field) continue;
      field.value = name === "productLanguage" && productLanguage ? productLanguage : defaults[name] || (name === "effort" ? "high" : name === "productLanguage" ? "zh-CN" : "");
    }
  }

  function openDialog(dialog) { dialog.showModal(); const field = dialog.querySelector("input:not([type=radio]), textarea, select"); field?.focus(); }
  function closeDialog(dialog) { if (dialog.open) dialog.close(); }

  function openContinue(entry) {
    state.menuEntryId = null; state.activeEntry = entry;
    const form = $("continueForm"); form.reset(); fillDefaults(form, entry.productLanguage || entry.language);
    $("continueProduct").textContent = `${text(entry.displayName) || message("fieldMissing")} · ${text(entry.description) || message("purposeMissing")}`;
    const cap = capability(entry, "execute");
    $("continueCapability").hidden = cap.enabled; $("continueCapability").textContent = cap.reason ? message("unavailableReason", { reason: cap.reason }) : message("capabilityUnavailable");
    form.querySelector('[type="submit"]').disabled = !cap.enabled || state.stale;
    setFormStatus(form, ""); openDialog($("continueDialog"));
  }

  function formConfig(form) {
    return { engine: text(form.elements.engine?.value), model: text(form.elements.model?.value), effort: form.elements.effort?.value || null, productLanguage: form.elements.productLanguage?.value || null };
  }

  async function submitContinue(event) {
    event.preventDefault(); const form = event.currentTarget; const entry = state.activeEntry; if (!entry) return;
    setFormStatus(form, message("actionPending")); form.querySelector('[type="submit"]').disabled = true;
    try {
      await write("/requests", { kind: entry.kind === "exploration" ? "explore" : "continue", entryId: entry.entryId, sourceId: entry.sourceId, runtimeId: entry.runtimeId,
        expectedSourceRevision: entry.sourceRevision, executionMode: form.elements.executionMode.value, config: formConfig(form) });
      closeDialog($("continueDialog")); showStatus("requestCreated"); await refresh(); openQueue();
    } catch (error) { setFormStatus(form, message("requestFailed", { detail: errorText(error) }), true); }
    finally { form.querySelector('[type="submit"]').disabled = !capability(entry, "execute").enabled || state.stale; }
  }

  async function submitNewWork(event) {
    event.preventDefault(); const form = event.currentTarget;
    setFormStatus(form, message("actionPending")); form.querySelector('[type="submit"]').disabled = true;
    try {
      await write("/explorations", { direction: text(form.elements.direction.value) || null, executionMode: form.elements.executionMode.value, config: formConfig(form) }, 60000);
      closeDialog($("newWorkDialog")); showStatus("explorationPrepared"); await refresh(); openQueue();
    } catch (error) { setFormStatus(form, message("requestFailed", { detail: errorText(error) }), true); }
    finally { form.querySelector('[type="submit"]').disabled = state.stale; }
  }

  function renderProbe(candidate) {
    const container = clear($("probeResult")); container.hidden = false;
    const list = element("dl");
    const items = Array.isArray(candidate.items) ? candidate.items : [candidate];
    const names = items.map((item) => text(item.displayName || item.name)).filter(Boolean).join(" · ") || message("probeNoName");
    const kinds = [...new Set(items.map((item) => text(item.kind)).filter(Boolean))].map((kind) => window.CENTER_MESSAGES[state.language][`kind_${kind}`] ? message(`kind_${kind}`) : kind).join(" · ") || message("notRecorded");
    for (const [label, value] of [[message("probeName"), names], [message("probeKind"), kinds], [message("probeCapabilities"), message("readOnly")], [message("probeWarnings"), (candidate.warnings || []).join(" · ") || message("notRecorded")]]) {
      list.append(element("dt", "", label), element("dd", "", String(value)));
    }
    container.append(list);
  }

  async function submitProbe(event) {
    event.preventDefault(); const form = event.currentTarget; state.probe = null; $("commitImportButton").hidden = true; $("probeResult").hidden = true;
    setFormStatus(form, message("probing")); $("probeButton").disabled = true;
    try {
      const mode = form.elements.mode.value;
      const candidate = await write("/imports/probe", { root: text(form.elements.root.value), ...(mode === "reference" ? { kindHint: "reference" } : {}) }, 60000);
      if (!candidate?.candidateId || !candidate?.candidateHash) throw new APIError({ code: "INVALID_RESPONSE" }, 200);
      state.probe = candidate; renderProbe(candidate); $("commitImportButton").hidden = false; setFormStatus(form, message("probeReady"));
    } catch (error) { setFormStatus(form, message("requestFailed", { detail: errorText(error) }), true); }
    finally { $("probeButton").disabled = false; }
  }

  async function commitImport() {
    const form = $("importForm"); if (!state.probe) return;
    $("commitImportButton").disabled = true; setFormStatus(form, message("actionPending"));
    try {
      await write("/imports/commit", { candidateId: state.probe.candidateId, candidateHash: state.probe.candidateHash, mode: form.elements.mode.value === "reference" ? "reference" : "readonly", expectedRevision: state.revision }, 60000);
      closeDialog($("importDialog")); showStatus("importComplete"); state.probe = null; await refresh();
    } catch (error) { setFormStatus(form, message("requestFailed", { detail: errorText(error) }), true); }
    finally { $("commitImportButton").disabled = false; }
  }

  function sourceStatus(value, error = false) {
    const node = $("sourceManagerStatus"); node.textContent = value; node.classList.toggle("error", error);
  }

  async function waitOperation(operation) {
    if (!operation?.operationId || !["running", "preparing"].includes(operation.state)) return operation;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      operation = await api(`/operations/${encodeURIComponent(operation.operationId)}`);
      if (!["running", "preparing"].includes(operation.state)) return operation;
    }
    throw new APIError({ code: "CONTEXT_UNAVAILABLE", messageKey: "operationInProgress" }, 408);
  }

  async function refreshSourceManager(successKey) {
    const entryId = state.managementEntry?.entryId; if (!entryId) return;
    state.managementEntry = await api(`/entries/${encodeURIComponent(entryId)}`);
    state.selectedSourceId = state.managementEntry.sourceId;
    renderSourceManager(); sourceStatus(message(successKey)); await refresh();
  }

  async function sourceOperation(path, body, successKey = "managementComplete") {
    sourceStatus(message("operationInProgress"));
    try {
      const operation = await waitOperation(await write(path, body, 60000));
      if (["attention", "failed"].includes(operation?.state)) { sourceStatus(message("operationAttention", { reason: capabilityReason(operation.reason || "CONTEXT_UNAVAILABLE") }), true); return; }
      await refreshSourceManager(successKey);
    } catch (error) { sourceStatus(message("requestFailed", { detail: errorText(error) }), true); }
  }

  function managementAction(container, labelKey, enabled, reason, action, danger = false) {
    const row = element("div", "management-action");
    const button = element("button", `button ${danger ? "danger" : "secondary"}`, message(labelKey)); button.type = "button"; button.disabled = !enabled;
    if (enabled) button.addEventListener("click", action);
    row.append(button, element("small", "", enabled ? "" : capabilityReason(reason)));
    container.append(row);
  }

  function renderSourceManager() {
    const entry = state.managementEntry; const body = clear($("sourceManagerBody")); if (!entry) return;
    const sources = Array.isArray(entry.sources) ? entry.sources : [];
    if (!sources.length) { body.append(element("p", "list-state", message("noSources"))); return; }
    const fieldset = element("fieldset", "source-list"); fieldset.append(element("legend", "visually-hidden", message("sourceList")));
    sources.forEach((source, index) => {
      const label = element("label", "source-choice"); const input = document.createElement("input"); input.type = "radio"; input.name = "managedSource"; input.value = source.sourceId;
      input.checked = source.sourceId === state.selectedSourceId; input.addEventListener("change", () => { state.selectedSourceId = source.sourceId; renderSourceManager(); });
      const title = text(source.displayName || source.rootName) || source.project || message("sourceNumber", { number: index + 1 });
      const detail = [message(`kind_${source.kind}`), source.sourceId === entry.sourceId ? message("currentSource") : "", statusLabel(source.availability === "available" ? "read_only" : "unknown"), source.project && source.project !== title ? message("sourceProject", { project: source.project }) : "", message("sourceIdShort", { id: source.sourceId.slice(-8) })].filter(Boolean).join(" · ");
      label.append(input, element("strong", "", title), element("small", "", detail)); fieldset.append(label);
    });
    body.append(fieldset);
    const source = sources.find((item) => item.sourceId === state.selectedSourceId) || sources[0]; const current = source.sourceId === entry.sourceId;
    const diagnostics = element("details", "source-diagnostics"); diagnostics.append(element("summary", "", message("sourceDetails")));
    const diagnosticRows = [[message("sourceIdentifier"), source.sourceId], [message("sourceProjectLabel"), source.project], [message("sourceLocation"), source.displayPath], [message("sourceLastVerified"), source.lastVerifiedAt ? formatTime(source.lastVerifiedAt) : message("notRecorded")]].filter(([, value]) => text(value));
    const diagnosticList = element("dl"); for (const [label, value] of diagnosticRows) diagnosticList.append(element("dt", "", label), element("dd", "", value)); diagnostics.append(diagnosticList); body.append(diagnostics);
    const documents = Array.isArray(source.registeredDocuments) ? source.registeredDocuments : [];
    if (documents.length) {
      const section = element("div", "source-documents"); section.append(element("strong", "", message("registeredDocuments")));
      for (const document of documents) { const link = element("a", "", document.label || document.path || message("view")); link.href = `${API}/entries/${encodeURIComponent(entry.entryId)}/resources/${encodeURIComponent(document.id)}?sourceId=${encodeURIComponent(source.sourceId)}`; link.target = "_blank"; link.rel = "noopener"; section.append(link); }
      body.append(section);
    }
    const reconnect = element("label", "reconnect-field"); reconnect.append(element("span", "", message("reconnectPath")));
    const root = document.createElement("input"); root.type = "text"; root.autocomplete = "off"; root.spellcheck = false; root.placeholder = message("folderPlaceholder"); reconnect.append(root, element("small", "", message("reconnectHint"))); body.append(reconnect);
    const actions = element("div", "management-actions"); const takeover = capability(entry, "takeover"); const release = capability(entry, "release"); const preview = capability(entry, "preview"); const capture = capability(entry, "capture");
    managementAction(actions, "selectSource", !current, current ? "UNSUPPORTED" : "", async () => {
      sourceStatus(message("actionPending")); try { await write(`/entries/${encodeURIComponent(entry.entryId)}/source-selection`, { sourceId: source.sourceId, expectedRevision: entry.revision }); await refreshSourceManager("sourceSelected"); } catch (error) { sourceStatus(message("requestFailed", { detail: errorText(error) }), true); }
    });
    const sourceRevision = source.revision;
    managementAction(actions, "reconnectSource", current && !release.enabled, !current ? "selectCurrentFirst" : release.enabled ? "releaseFirst" : "", async () => {
      if (!text(root.value)) { sourceStatus(message("requestFailed", { detail: message("folderPath") }), true); root.focus(); return; }
      sourceStatus(message("probing")); try { const candidate = await write("/imports/probe", { root: text(root.value) }, 60000); await write(`/sources/${encodeURIComponent(source.sourceId)}/reconnect`, { candidateId: candidate.candidateId, candidateHash: candidate.candidateHash, expectedRevision: sourceRevision }, 60000); await refreshSourceManager("sourceReconnected"); } catch (error) { sourceStatus(message("requestFailed", { detail: errorText(error) }), true); }
    });
    managementAction(actions, "takeover", current && takeover.enabled, !current ? "selectCurrentFirst" : takeover.reason, () => sourceOperation(`/sources/${encodeURIComponent(source.sourceId)}/takeover`, { expectedRevision: sourceRevision }));
    managementAction(actions, "release", current && release.enabled, !current ? "selectCurrentFirst" : release.reason, () => sourceOperation(`/sources/${encodeURIComponent(source.sourceId)}/release`, { expectedRevision: sourceRevision }));
    managementAction(actions, "previewStart", current && preview.enabled, !current ? "selectCurrentFirst" : preview.reason, () => sourceOperation(`/entries/${encodeURIComponent(entry.entryId)}/preview/start`, { sourceId: source.sourceId, expectedRevision: sourceRevision }));
    managementAction(actions, "previewStop", current && preview.enabled, !current ? "selectCurrentFirst" : preview.reason, () => sourceOperation(`/entries/${encodeURIComponent(entry.entryId)}/preview/stop`, { sourceId: source.sourceId, expectedRevision: sourceRevision }));
    managementAction(actions, "captureMedia", current && capture.enabled, !current ? "selectCurrentFirst" : capture.reason, () => sourceOperation(`/entries/${encodeURIComponent(entry.entryId)}/media/capture`, { sourceId: source.sourceId, expectedRevision: sourceRevision }));
    managementAction(actions, "detachEntry", current && !release.enabled, !current ? "selectCurrentFirst" : release.enabled ? "releaseFirst" : "", () => { closeDialog($("sourceDialog")); confirmReferenceDetach(entry); }, true);
    body.append(actions);
  }

  async function openSourceManager(entry) {
    const token = ++state.sourceToken; state.managementEntry = null; state.selectedSourceId = null; $("sourceProduct").textContent = entry.displayName || message("fieldMissing"); clear($("sourceManagerBody")); sourceStatus(message("loading")); openDialog($("sourceDialog"));
    try { const detail = await api(`/entries/${encodeURIComponent(entry.entryId)}`); if (token !== state.sourceToken || !$("sourceDialog").open) return; state.managementEntry = detail; state.selectedSourceId = detail.sourceId; renderSourceManager(); sourceStatus(""); }
    catch (error) { if (token === state.sourceToken) sourceStatus(message("requestFailed", { detail: errorText(error) }), true); }
  }

  async function loadPreferences() {
    const form = $("settingsForm"); setFormStatus(form, message("loading"));
    try {
      state.preferences = await api("/preferences");
      form.elements.language.value = state.preferences.language || state.language;
      fillDefaults(form); setFormStatus(form, "");
    } catch (error) { setFormStatus(form, message("requestFailed", { detail: errorText(error) }), true); }
  }

  async function savePreferences(event) {
    event.preventDefault(); const form = event.currentTarget; form.querySelector('[type="submit"]').disabled = true; setFormStatus(form, message("actionPending"));
    try {
      state.preferences = await write("/preferences", { preferences: { language: form.elements.language.value, ...formConfig(form) }, expectedRevision: state.preferences?.revision ?? state.revision });
      state.language = form.elements.language.value; closeDialog($("settingsDialog")); renderPage(); showStatus("preferencesSaved"); await refresh();
    } catch (error) { setFormStatus(form, message("requestFailed", { detail: errorText(error) }), true); }
    finally { form.querySelector('[type="submit"]').disabled = false; }
  }

  function confirmAction(titleKey, messageKey, action, danger = false) {
    state.confirmAction = action; $("confirmTitle").textContent = message(titleKey); $("confirmMessage").textContent = message(messageKey);
    $("confirmActionButton").classList.toggle("primary", !danger); $("confirmActionButton").classList.toggle("danger", danger);
    setFormStatus($("confirmForm"), ""); openDialog($("confirmDialog"));
  }

  function confirmEntryVisibility(entry) {
    const action = entry.archived ? "restore" : "archive";
    confirmAction(`${action}Title`, `${action}Message`, async () => {
      await write(`/entries/${encodeURIComponent(entry.entryId)}/${action}`, { expectedRevision: entry.revision ?? state.revision });
      showStatus(entry.archived ? "restoreSuccess" : "archiveSuccess"); await refresh();
    });
  }

  function confirmReferenceDetach(entry) {
    const reference = entry.kind === "reference";
    confirmAction(reference ? "detachReferenceTitle" : "detachEntryTitle", reference ? "detachReferenceMessage" : "detachEntryMessage", async () => {
      await write(`/entries/${encodeURIComponent(entry.entryId)}/detach`, { expectedRevision: entry.revision ?? state.revision });
      showStatus(reference ? "detachReferenceSuccess" : "detachEntrySuccess"); await refresh();
    }, true);
  }

  function confirmRequestAction(request, action) {
    confirmAction(action === "stop" ? "stopTitle" : "cancelTitle", action === "stop" ? "stopMessage" : "cancelMessage", () => runRequestAction(request, action), action === "stop");
  }

  async function runRequestAction(request, action) {
    try {
      const body = action === "stop" ? { expectedDispatchId: request.dispatchId } : { expectedRevision: request.revision ?? state.revision };
      await write(`/requests/${encodeURIComponent(request.requestId)}/${action}`, body, action === "stop" ? 60000 : 30000);
      showStatus("actionAccepted"); await refresh();
    } catch (error) { showStatus("requestFailed", { detail: errorText(error) }, true); }
  }

  async function moveRequest(index, offset, queued) {
    const reordered = [...queued]; const [item] = reordered.splice(index, 1); reordered.splice(index + offset, 0, item);
    try {
      await write("/queue/order", { requestIds: reordered.map((request) => request.requestId), expectedRevision: state.summary?.queueRevision });
      showStatus("queueChanged"); await refresh();
    } catch (error) { showStatus("requestFailed", { detail: errorText(error) }, true); }
  }

  async function toggleDispatch() {
    const action = state.summary?.dispatchEnabled === true ? "pause" : "resume";
    $("dispatchButton").disabled = true;
    try { await write(`/queue/${action}`, { expectedRevision: state.summary?.queueRevision }); showStatus("actionAccepted"); await refresh(); }
    catch (error) { showStatus("requestFailed", { detail: errorText(error) }, true); }
  }

  function openQueue() {
    state.drawerOpen = true; $("queueDrawer").classList.add("open"); $("queueDrawer").setAttribute("aria-hidden", "false");
    $("queueNavButton").setAttribute("aria-expanded", "true"); $("drawerBackdrop").hidden = false; document.body.style.overflow = "hidden";
    document.querySelector(".center-header").inert = true; $("centerMain").inert = true; $("queueDrawer").focus();
  }

  function closeQueue() {
    state.drawerOpen = false; $("queueDrawer").classList.remove("open"); $("queueDrawer").setAttribute("aria-hidden", "true");
    $("queueNavButton").setAttribute("aria-expanded", "false"); $("drawerBackdrop").hidden = true; document.body.style.overflow = "";
    document.querySelector(".center-header").inert = false; $("centerMain").inert = false; $("queueNavButton").focus();
  }

  function clearFilters() { state.filter = "all"; state.query = ""; $("productSearch").value = ""; renderPage(); }

  function resetImportProbe() {
    state.probe = null; $("probeResult").hidden = true; $("commitImportButton").hidden = true; setFormStatus($("importForm"), "");
  }

  function wire() {
    $("queueNavButton").addEventListener("click", openQueue); $("closeQueueButton").addEventListener("click", closeQueue); $("drawerBackdrop").addEventListener("click", closeQueue);
    $("dispatchButton").addEventListener("click", toggleDispatch);
    $("stopAllButton").addEventListener("click", () => confirmAction("stopAllTitle", "stopAllMessage", async () => { await write("/queue/stop-all", { expectedRevision: state.summary?.queueRevision }, 60000); showStatus("actionAccepted"); await refresh(); }, true));
    $("queueHistoryButton").addEventListener("click", () => { state.historyVisible = !state.historyVisible; renderQueue(); });
    $("newWorkButton").addEventListener("click", () => { const form = $("newWorkForm"); form.reset(); fillDefaults(form); setFormStatus(form, ""); openDialog($("newWorkDialog")); });
    $("importButton").addEventListener("click", () => { const form = $("importForm"); form.reset(); resetImportProbe(); openDialog($("importDialog")); });
    $("settingsButton").addEventListener("click", () => { openDialog($("settingsDialog")); loadPreferences(); });
    $("newWorkForm").addEventListener("submit", submitNewWork); $("continueForm").addEventListener("submit", submitContinue); $("importForm").addEventListener("submit", submitProbe); $("commitImportButton").addEventListener("click", commitImport); $("settingsForm").addEventListener("submit", savePreferences);
    Array.from($("importForm").elements.mode).forEach((control) => control.addEventListener("change", resetImportProbe));
    $("importForm").elements.root.addEventListener("input", resetImportProbe);
    $("confirmForm").addEventListener("submit", async (event) => {
      event.preventDefault(); const action = state.confirmAction; if (!action) return; const button = $("confirmActionButton"); button.disabled = true; setFormStatus($("confirmForm"), message("actionPending"));
      try { await action(); state.confirmAction = null; closeDialog($("confirmDialog")); }
      catch (error) { setFormStatus($("confirmForm"), message("requestFailed", { detail: errorText(error) }), true); }
      finally { button.disabled = false; }
    });
    document.querySelectorAll(".dialog-close").forEach((button) => button.addEventListener("click", () => closeDialog(button.closest("dialog"))));
    document.querySelectorAll("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => { if (event.target !== dialog) return; const box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeDialog(dialog); }));
    document.querySelectorAll(".filter-button").forEach((button) => button.addEventListener("click", () => { state.filter = button.dataset.filter; renderPage(); }));
    document.querySelectorAll("[data-filter-target]").forEach((button) => button.addEventListener("click", () => { state.filter = button.dataset.filterTarget; renderPage(); $("catalogHeading").scrollIntoView({ behavior: "smooth" }); }));
    let searchTimer; $("productSearch").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.query = $("productSearch").value.trim(); renderEntries(); }, 120); });
    document.addEventListener("click", () => { if (state.menuEntryId) { state.menuEntryId = null; renderEntries(); } });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && state.drawerOpen) closeQueue(); });
    document.addEventListener("visibilitychange", () => { clearTimeout(state.timer); if (!document.hidden) refresh(); });
  }

  applyLanguage(); wire(); renderPage(); refresh();
})();
