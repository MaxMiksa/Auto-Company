(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const API = "/api/center/v1";
  const OPEN_STATES = new Set(["queued", "starting", "running", "stopping", "attention", "preparing"]);
  const CATALOG_FILTERS = ["all", "running", "queued", "attention", "archived", "exploration", "reference", "read_only", "paused", "ended", "idle", "unknown", "failed", "blocked", "canceled", "preparing", "starting", "stopping"];
  const TERMINAL_STATES = new Set(["ended", "failed", "canceled"]);
  const state = {
    language: "zh-CN", revision: null, centerId: null, observedAt: null,
    summary: null, entries: [], requests: [], operations: [], preferences: null,
    query: "", filter: "all", loading: true, stale: false, refreshing: null,
    refreshToken: 0, timer: null, menuEntryId: null, historyVisible: false,
    activeEntry: null, managementEntry: null, selectedSourceId: null, sourceToken: 0, probe: null, confirmAction: null, drawerOpen: false, pendingWrites: new Map(), projectionSignature: "", projectionTimer: null,
    activeWorkGroupId: null, nextWorkGroupId: 0, workSubmitting: false,
    lastSuccessAt: null, restoreScroll: null, focusOrder: [], announcement: "",
    actionLocks: new Set(),
    autoRefresh: true,
    otherExpanded: false,
    sort: "activity", sortDirection: "desc", roundFilter: "all", previewMode: "screenshot",
  };

  const VIEW_STATE_KEY = "auto-company:center:view:v1";
  function saveView() {
    try { window.sessionStorage?.setItem(VIEW_STATE_KEY, JSON.stringify({ query: $("productSearch")?.value.trim() ?? state.query, filter: state.filter, sort: state.sort, sortDirection: state.sortDirection, roundFilter: state.roundFilter, previewMode: state.previewMode, otherExpanded: state.otherExpanded, scroll: window.scrollY || 0 })); } catch (_) {}
  }
  function loadView() {
    try { state.autoRefresh = window.localStorage?.getItem("auto-company:center:auto-refresh") !== "off"; } catch (_) {}
    $("centerAutoRefresh").checked = state.autoRefresh;
    try {
      const saved = JSON.parse(window.sessionStorage?.getItem(VIEW_STATE_KEY) || "null");
      if (!saved) return;
      if (typeof saved.otherExpanded === "boolean") state.otherExpanded = saved.otherExpanded;
      if (["logo", "screenshot", "none"].includes(saved.previewMode)) state.previewMode = saved.previewMode;
      if (typeof saved.query === "string") state.query = saved.query;
      if (CATALOG_FILTERS.includes(saved.filter)) state.filter = saved.filter;
      if (["activity", "name", "work", "status", "round"].includes(saved.sort)) state.sort = saved.sort;
      if (["asc", "desc"].includes(saved.sortDirection)) state.sortDirection = saved.sortDirection;
      if (["all", "completed", "running", "failed", "pending", "interrupted", "completed_with_timeout", "paused", "unknown", "not_started", "startup_unconfirmed"].includes(saved.roundFilter)) state.roundFilter = saved.roundFilter;
      if (Number.isFinite(saved.scroll) && saved.scroll >= 0) state.restoreScroll = saved.scroll;
      $("productSearch").value = state.query;
    } catch (_) {}
  }
  function announce(value) { const node = $("searchStatus"); if (node && value !== state.announcement) { node.textContent = value; state.announcement = value; } }

  function message(key, values = {}) {
    const dictionary = window.CENTER_MESSAGES[state.language] || window.CENTER_MESSAGES.en;
    return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, typeof value === "number" && Number.isFinite(value) ? formatNumber(value) : String(value)), dictionary[key] || key);
  }
  function formatNumber(value) { return new Intl.NumberFormat(state.language).format(value); }

  function element(tag, className, text) {
    return window.DashboardUI.element(tag, className, text);
  }

  function clear(node) { node.replaceChildren(); return node; }
  function text(value) { return typeof value === "string" ? value.trim() : ""; }
  function knownNumber(value) { return Number.isFinite(value) && value >= 0; }
  function focusKey(node, value) { node.dataset.focusKey = value; return node; }
  function rememberFocus() {
    const active = document.activeElement;
    state.focusOrder = [...document.querySelectorAll("[data-focus-key]")].map(node => node.dataset.focusKey);
    return active && active !== document.body ? text(active.dataset?.focusKey) : "";
  }
  function restoreFocus(key) {
    if (!key) return;
    const node = [...document.querySelectorAll("[data-focus-key]")].find((item) => item.dataset.focusKey === key);
    if (node && !node.disabled) node.focus({ preventScroll: true });
    else {
      const index = state.focusOrder.indexOf(key);
      const next = state.focusOrder.slice(index + 1).concat(state.focusOrder.slice(0, Math.max(0, index)).reverse()).map(value => [...document.querySelectorAll("[data-focus-key]")].find(item => item.dataset.focusKey === value)).find(item => item && !item.disabled);
      (next || $("productSearch"))?.focus({ preventScroll: true });
      announce(message("focusedItemRemoved"));
    }
  }
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
      PRODUCT_LANGUAGE_LOCKED: "productLanguageLocked", PRODUCT_REGISTRATION_INVALID: "productRegistrationInvalid", UNRESOLVED_P1: "unresolvedP1",
      RECOVERY_REQUIRED: "recoveryRequired", INVALID_CONFIG: "invalidConfig", INVALID_PREFERENCE: "invalidConfig", INVALID_TEMPLATE: "templateNameInvalid", TEMPLATE_NOT_FOUND: "selectTemplateFirst",
      INVALID_BATCH: "workBatchLimit", INVALID_DIRECTION: "fieldInvalid", INVALID_REQUEST: "invalidConfig", INVALID_INPUT: "fieldInvalid",
    };
    const key = map[error?.code] || (error?.messageKey && window.CENTER_MESSAGES.en[error.messageKey] ? error.messageKey : null);
    return key ? message(key, error.params) : text(error?.message) || message("unknownError");
  }

  function languageLabel(value) { return message(value === "zh-CN" ? "language_zh" : value === "en" ? "language_en" : "notRecorded"); }
  function formatTime(value) { return fullTime(value); }
  function fullTime(value) { return window.DashboardDate.format(value, state.language) || message('unknownTime'); }
  function fieldLabel(node, key) { node.dataset.label = message(key); }

  function requestState(request) { return text(request?.state).toLowerCase() || "unknown"; }
  function requestIsFresh(request, currentTime = Date.now()) {
    if (state.stale) return false;
    const liveAge = currentTime - Date.parse(request?.liveConfirmedAt);
    return Number.isFinite(liveAge) && liveAge >= 0 && liveAge <= 15000;
  }
  function executionBlockReason(request, currentTime = Date.now()) {
    if (!requestIsFresh(request, currentTime) || requestState(request) !== "running" || text(request?.executionBlockedReason).toLowerCase() !== "unresolved_p1") return "";
    const blockedAt = Date.parse(request.executionBlockedAt);
    if (!Number.isFinite(blockedAt) || blockedAt > currentTime) return "";
    return "unresolved_p1";
  }
  function requestDisplayState(request, currentTime = Date.now()) {
    const value = requestState(request);
    if (!["starting", "running", "stopping"].includes(value)) return value;
    if (!requestIsFresh(request, currentTime)) return "unknown";
    const blockedReason = text(request?.executionBlockedReason).toLowerCase();
    if (blockedReason) return executionBlockReason(request, currentTime) ? "blocked" : "unknown";
    return value;
  }
  function execution(entry) { return typeof entry?.executionSummary === "object" && entry.executionSummary ? entry.executionSummary : { state: text(entry?.executionSummary) }; }
  function entryState(entry, currentTime = Date.now()) {
    if (entry?.archived) return "archived";
    const summary = execution(entry); const value = text(summary.state).toLowerCase();
    if (value === "read_only") return readonlyObservationState(entry, currentTime) || "unknown";
    if (["blocked", "running", "starting", "stopping"].includes(value)) {
      const request = (state.summary?.currentRequests || [state.summary?.currentRequest]).find((item) => item?.entryId === entry.entryId);
      if (!summary.requestId || summary.requestId !== request?.requestId || entry?.entryId !== request?.entryId) return "unknown";
      const projected = requestDisplayState(request, currentTime);
      if (value === "blocked") return projected === "blocked" && summary.reason === "unresolved_p1" ? "blocked" : "unknown";
      return projected === value ? value : "unknown";
    }
    if (["queued", "attention", "failed", "ended", "canceled", "preparing", "paused", "read_only", "unknown"].includes(value)) return value;
    const availability = entry?.availability?.state || entry?.availability;
    if (["unknown", "unavailable", "conflict"].includes(availability)) return "unknown";
    if (availability === "read_only" || (value === "idle" && entry?.capabilities?.execute === false)) return readonlyObservationState(entry, currentTime) || "unknown";
    return "idle";
  }

  function readonlyObservationState(entry, currentTime = Date.now()) {
    const observation = entry?.readonlyObservation;
    if (state.stale || observation?.readOnly !== true || observation.scoped !== true) return "";
    const age = currentTime - Date.parse(observation.liveConfirmedAt);
    if (["running", "paused", "idle"].includes(observation.state) && Number.isFinite(age) && age >= 0 && age <= 15000) return observation.state;
    const observedAge = currentTime - Date.parse(observation.observedAt);
    return observation.state === "ended" && observation.processState === "stopped" && Number.isFinite(observedAge) && observedAge >= 0 && observedAge <= 15000 ? "ended" : "";
  }

  function statusLabel(value) {
    const key = `state_${value}`;
    return window.CENTER_MESSAGES[state.language][key] || message("state_unknown");
  }
  function filterLabel(value) { const key = `filter${value[0].toUpperCase()}${value.slice(1)}`; return window.CENTER_MESSAGES[state.language][key] || statusLabel(value); }
  function roundLabel(value) { const key = `round_${value}`; return window.CENTER_MESSAGES[state.language][key] || statusLabel(value); }
  function latestWorkSource(entry) {
    const work = entry.latestWork;
    if (!work || typeof work !== "object" || (work.scope === "product" && work.isLatestCycle !== false)) return "";
    const scope = message(work.scope === "exploration" ? "workSourceExploration" : work.scope === "legacy" ? "workSourceLegacy" : "workSourceEarlier");
    return knownNumber(work.cycleNumber) ? message("workSourceCycle", { scope, cycle: String(work.cycleNumber).padStart(2, "0") }) : scope;
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
    const known = { unmanaged_source: "unmanagedSource", read_only_source: "readOnlySource", execution_domain_unconfigured: "executionUnavailable", runtime_incompatible: "runtimeIncompatible", slot_busy: "slotBusy", open_request_exists: "openRequestExists", source_unavailable: "sourceUnavailableReason", entry_archived: "archiveBlocked", product_registration_invalid: "productRegistrationInvalid", context_unavailable: "contextUnavailable", governance_pause: "governancePaused", budget_pause: "budgetPaused", stop_unconfirmed: "stopUnconfirmed", unresolved_p1: "unresolvedP1", framework_unverified: "frameworkUnverified", preparation_failed: "preparationFailed" };
    if (window.CENTER_MESSAGES[state.language][reason]) return message(reason);
    const key = known[reason] || known[String(reason).toLowerCase()];
    return key ? message(key) : errorText({ code: reason });
  }

  function requestReason(reason) {
    const value = text(reason);
    if (value === "user_stop") return message("requestedStop");
    if (value === "user_cancel") return message("requestedCancel");
    return /^(?:PRODUCT_REGISTRATION_INVALID|CONTEXT_UNAVAILABLE|GOVERNANCE_PAUSE|BUDGET_PAUSE|STOP_UNCONFIRMED|UNRESOLVED_P1|FRAMEWORK_UNVERIFIED|PREPARATION_FAILED)$/i.test(value) ? capabilityReason(value) : value || message("unknownError");
  }
  function queueWaitReason() {
    if (state.summary?.dispatchEnabled === false) return message("dispatchOffHint");
    const capacity = state.summary?.maxConcurrentProjects, occupied = state.summary?.occupiedCount;
    return knownNumber(capacity) && knownNumber(occupied) && occupied >= capacity ? message("queueCapacityWait") : message("queueOrderHint");
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

  function inProjectList(entry) {
    if (entry.kind !== "exploration") return entry.kind !== "reference";
    const request = state.requests.find((item) => item.requestId === execution(entry).requestId);
    return Boolean(request && (OPEN_STATES.has(requestState(request)) || requestState(request) === "failed"));
  }

  function normalizeCounts() {
    const counts = { all: state.entries.filter((entry) => !entry.archived && inProjectList(entry)).length, running: 0, queued: 0, attention: 0, archived: 0 };
    for (const entry of state.entries) {
      const value = entryState(entry);
      if (value === "archived") counts.archived += 1;
      if (inProjectList(entry) && ["running", "starting", "stopping"].includes(value)) counts.running += 1;
      if (inProjectList(entry) && value === "queued") counts.queued += 1;
      if (inProjectList(entry) && ["blocked", "attention", "failed", "unknown"].includes(value)) counts.attention += 1;
    }
    return counts;
  }

  function filteredEntries() {
    const query = state.query.toLocaleLowerCase(state.language);
    return state.entries.filter((entry) => {
      const value = entryState(entry);
      const filterMatch = state.filter === "all" ? !entry.archived && inProjectList(entry)
        : state.filter === "running" ? inProjectList(entry) && ["running", "starting", "stopping"].includes(value)
        : state.filter === "queued" ? inProjectList(entry) && value === "queued"
        : state.filter === "attention" ? inProjectList(entry) && ["blocked", "attention", "failed", "unknown"].includes(value)
        : state.filter === "archived" ? entry.archived === true
        : state.filter === "exploration" ? entry.kind === "exploration" && !entry.archived
        : state.filter === "reference" ? entry.kind === "reference" && !entry.archived
        : state.filter === "read_only" ? inProjectList(entry) && !entry.archived && execution(entry).state === "read_only"
        : CATALOG_FILTERS.includes(state.filter) && inProjectList(entry) && value === state.filter;
      if (state.filter === "all" && entry.kind === "reference") return false;
      if (!filterMatch) return false;
      if (state.roundFilter !== "all" && latestRoundState(entry) !== state.roundFilter) return false;
      if (!query) return true;
      return [entry.displayName, entry.description, entry.alias].some((value) => text(value).toLocaleLowerCase(state.language).includes(query));
    });
  }

  function emptyListState(entries = filteredEntries()) {
    if (entries.length) return null;
    if (state.stale && !state.entries.length) return { messageKey: "loadFailed" };
    if (state.query || state.filter !== "all" || state.roundFilter !== "all") return { messageKey: "noMatches", actionKey: "clearFilters", target: "all" };
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
    box.append(window.DashboardIcons.icon(kind === "exploration" ? "search" : kind === "legacy" ? "file-text" : "panels-top-left")); return box;
  }

  function entryIcon(entry) {
    const href = safeAssetURL(entry.iconUrl);
    if (!href) return fallbackIcon(entry.kind);
    const box = element("span", "product-icon");
    const image = element("img"); image.src = href; image.alt = ""; image.width = image.height = 42;
    image.addEventListener("error", () => box.replaceChildren(fallbackIcon(entry.kind).firstChild), { once: true });
    box.append(image); return box;
  }

  function entryThumbnail(entry) {
    const box = element("span", "product-thumbnail");
    const href = safeAssetURL(entry.thumbnailUrl);
    const missing = () => { box.classList.add("thumbnail-missing"); box.replaceChildren(entryIcon(entry)); box.title = message("productLogo", { name: entry.displayName || message("fieldMissing") }); box.setAttribute("aria-label", box.title); };
    if (!href) { missing(); return box; }
    const image = element("img"); image.src = href; image.alt = message("productPreview", { name: entry.displayName });
    image.loading = "lazy"; image.decoding = "async";
    box.title = message(entry.thumbnailStale ? "previewPrevious" : "productPreview", { name: entry.displayName });
    image.addEventListener("error", missing, { once: true });
    box.append(image); return box;
  }

  function statusSymbol(value) {
    const normalized = ["pending", "not_started"].includes(value) ? "queued"
      : ["interrupted", "completed_with_timeout"].includes(value) ? "paused" : value;
    const visual = window.DashboardStatus.visual(normalized);
    const node = element("span", `status-symbol ${visual === "pending" ? "queued" : visual}`);
    node.setAttribute("aria-hidden", "true");
    node.append(window.DashboardIcons.status(visual));
    return node;
  }

  function detailURL(entry) { return `/products/${encodeURIComponent(entry.entryId)}`; }
  function sortedEntries(entries = filteredEntries()) {
    const statusOrder = ["running", "starting", "stopping", "queued", "blocked", "attention", "failed", "paused", "idle", "ended", "canceled", "preparing", "read_only", "archived", "unknown"];
    const value = entry => state.sort === "name" ? text(entry.displayName) : state.sort === "work" ? text(entry.latestTitle)
      : state.sort === "status" ? statusOrder.indexOf(entryState(entry))
      : state.sort === "round" ? knownNumber(entry.cycleNumber) ? entry.cycleNumber : null
      : Number.isFinite(Date.parse(entry.lastActivityAt)) ? Date.parse(entry.lastActivityAt) : null;
    return [...entries].sort((left, right) => {
      const a = value(left), b = value(right);
      if (a === null || a === "") return b === null || b === "" ? 0 : 1;
      if (b === null || b === "") return -1;
      const comparison = typeof a === "string" ? a.localeCompare(b, state.language) : a - b;
      return comparison * (state.sortDirection === "desc" ? -1 : 1);
    });
  }
  function columnHeader(label, field, groupKey) {
    const cell = element("th", "column-heading"); cell.setAttribute("role", "columnheader");
    cell.setAttribute("aria-sort", state.sort === field ? state.sortDirection === "asc" ? "ascending" : "descending" : "none");
    cell.dataset.column = field;
    if (field === "preview") {
      cell.removeAttribute("aria-sort");
      const select = focusKey(element("select", "column-select preview-select"), `column:${groupKey}:preview`);
      select.setAttribute("aria-label", message("exampleDisplay"));
      for (const mode of ["logo", "screenshot", "none"]) select.append(new Option(message(`example_${mode}`), mode));
      select.value = state.previewMode;
      select.addEventListener("change", () => { state.previewMode = select.value; saveView(); renderPage(); restoreFocus(`column:${groupKey}:preview`); });
      const headingLabel = element("label", "example-heading", message(label));
      select.id = `preview-${groupKey}`; headingLabel.htmlFor = select.id;
      cell.append(headingLabel, select);
    } else if (["status", "round"].includes(field)) {
      const select = focusKey(element("select", "column-select"), `column:${groupKey}:${field}`);
      select.setAttribute("aria-label", message("columnControl", { column: message(label) }));
      select.append(new Option(message(label), "filter:all"));
      const sortGroup = element("optgroup"); sortGroup.label = message("sortProducts");
      for (const direction of ["asc", "desc"]) sortGroup.append(new Option(message(field === "round" ? direction === "asc" ? "roundAscending" : "roundDescending" : direction === "asc" ? "statusRunningFirst" : "statusUnknownFirst"), `sort:${direction}`));
      select.append(sortGroup);
      const filterGroup = element("optgroup"); filterGroup.label = message("filterProducts");
      const values = field === "status" ? ["running", "queued", "attention", "paused", "ended", "idle", "unknown", "failed", "blocked", "canceled", "preparing", "starting", "stopping", "archived"] : ["completed", "running", "failed", "pending", "not_started", "startup_unconfirmed", "interrupted", "completed_with_timeout", "paused", "unknown"];
      for (const value of values) filterGroup.append(new Option(field === "status" ? filterLabel(value) : roundLabel(value), `filter:${value}`));
      select.append(filterGroup);
      const current = field === "status" ? state.filter : state.roundFilter;
      select.value = values.includes(current) ? `filter:${current}` : state.sort === field ? `sort:${state.sortDirection}` : "filter:all";
      select.addEventListener("change", () => {
        const [kind, value] = select.value.split(":");
        if (kind === "sort") { state.sort = field; state.sortDirection = value; }
        else if (field === "status") state.filter = value;
        else state.roundFilter = value;
        saveView(); renderPage(); restoreFocus(`column:${groupKey}:${field}`);
      });
      cell.append(select);
    } else {
      const button = focusKey(element("button", "column-sort-button", message(label)), `column:${groupKey}:${field}`); button.type = "button";
      const indicator = element("span", "sort-indicator"); indicator.setAttribute("aria-hidden", "true");
      indicator.append(window.DashboardIcons.icon(state.sort === field ? state.sortDirection === "asc" ? "arrow-up" : "arrow-down" : "arrow-up-down")); button.append(indicator);
      button.setAttribute("aria-label", message("sortColumn", { column: message(label) }));
      button.onclick = () => { state.sortDirection = state.sort === field && state.sortDirection === "asc" ? "desc" : "asc"; state.sort = field; saveView(); renderPage(); restoreFocus(`column:${groupKey}:${field}`); };
      cell.append(button);
    }
    return cell;
  }

  function latestRoundState(entry) {
    const recorded = text(entry.latestCycleStatus) || "unknown";
    return readonlyObservationState(entry) === "ended" && ["running", "startup_unconfirmed", "pending"].includes(recorded) ? "interrupted" : recorded;
  }

  function latestRound(entry) {
    const cell = element("td", "latest-round"); cell.setAttribute("role", "cell");
    fieldLabel(cell, "latestRound");
    cell.append(element("span", "round-number", knownNumber(entry.cycleNumber) ? `#${String(entry.cycleNumber).padStart(2, "0")}` : "—"));
    if (!knownNumber(entry.cycleNumber)) {
      cell.append(element("span", "round-label", message("noRounds")));
      return cell;
    }
    const value = latestRoundState(entry);
    const label = roundLabel(value);
    const mark = statusSymbol(value);
    cell.append(mark, element("span", "round-label", label));
    return cell;
  }

  function renderRow(entry) {
    const row = element("tr", "product-row"); row.setAttribute("role", "row"); row.dataset.entryId = entry.entryId;
    const identity = element("td", "product-identity"); identity.setAttribute("role", "cell");
    const copy = element("div");
    const name = element("h3", "product-name");
    const nameText = text(entry.displayName) || message("fieldMissing"); name.title = nameText;
    if (entry.kind !== "reference") {
      const link = focusKey(element("a", "product-link", nameText), `entry:${entry.entryId}:view`); link.href = detailURL(entry); name.append(link);
    } else name.textContent = nameText;
    const description = element("p", "product-description", text(entry.description) || message("purposeMissing"));
    copy.append(name, description); identity.append(copy);
    const preview = element("td", "product-example"); preview.setAttribute("role", "cell");
    if (state.previewMode !== "none") preview.append(state.previewMode === "logo" ? entryIcon(entry) : entryThumbnail(entry));
    if (entry.kind !== "reference") {
      row.classList.add("product-row-link");
      row.addEventListener("click", event => {
        if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
          || event.target.closest("a, button, input, select, textarea, [role=menuitem]") || window.getSelection()?.toString()) return;
        saveView(); name.querySelector("a").click();
      });
    }

    const recent = element("td", "recent-work"); recent.setAttribute("role", "cell");
    fieldLabel(recent, "recentWork");
    const title = element("p", `work-title${text(entry.latestTitle) ? "" : " work-missing"}`, text(entry.latestTitle) || message("workMissing")); title.title = title.textContent;
    if (text(entry.reportedPhase)) recent.title = message("phaseRecorded", { phase: phaseLabel(entry.reportedPhase) });
    recent.append(title);


    const value = entryState(entry);
    const status = element("td", "status-cell"); status.setAttribute("role", "cell");
    fieldLabel(status, "runtimeStatus");
    const statusCopy = element("div"); statusCopy.append(element("strong", "", statusLabel(value)));
    if (value === "queued" && knownNumber(execution(entry).queuePosition)) {
      statusCopy.append(element("small", "queue-position", message("queuePosition", { position: execution(entry).queuePosition })));
    }
    status.append(statusSymbol(value), statusCopy);

    const activity = element("time", "activity-time");
    if (entry.lastActivityAt && Number.isFinite(Date.parse(entry.lastActivityAt))) {
      const stamp = window.DashboardDate.parts(entry.lastActivityAt, state.language);
      activity.dateTime = entry.lastActivityAt; activity.title = fullTime(entry.lastActivityAt); activity.setAttribute("aria-label", fullTime(entry.lastActivityAt)); activity.tabIndex = 0;
      activity.append(element("span", "activity-date", stamp.date), element("span", "activity-clock", stamp.time));
    } else activity.textContent = message("unknownTime");

    const actions = element("div", "row-actions");
    const execute = capability(entry, "execute");
    const items = [];
    if (["product", "exploration"].includes(entry.kind) && !entry.archived) {
      items.push({ label: message("continue"), disabled: !execute.enabled,
        reason: execute.reason ? message("unavailableReason", { reason: capabilityReason(execute.reason) }) : message("capabilityUnavailable"),
        focusKey: `entry:${entry.entryId}:continue-menu`, action: () => openContinue(entry) });
    }
    items.push({ label: message("manageSources"), focusKey: `entry:${entry.entryId}:manage`, action: () => openSourceManager(entry) },
      { label: message(entry.archived ? "restore" : "archive"), focusKey: `entry:${entry.entryId}:visibility`, action: () => confirmEntryVisibility(entry) });
    if (entry.kind === "reference" && !entry.archived) items.push({ label: message("detachReference"), danger: true,
      focusKey: `entry:${entry.entryId}:detach`, action: () => confirmReferenceDetach(entry) });
    actions.append(window.DashboardUI.menu({ id: entry.entryId, label: message("moreActions"), items }));
    const updated = element("td", "updated-cell"); updated.setAttribute("role", "cell");
    fieldLabel(updated, "updatedTime");
    activity.removeAttribute("role"); updated.append(activity, actions);
    row.append(preview, identity, status, latestRound(entry), recent, updated);
    return row;
  }

  function renderEntries() {
    const container = clear($("productRows"));
    const listState = clear($("listState"));
    if (state.loading && !state.entries.length) { if (performance.now() - state.loadStarted >= 300) window.DashboardUI.loading(listState, message("loading")); return; }
    const entries = sortedEntries();
    announce(message("searchResultCount", { count: entries.length }));
    window.DashboardUI?.retainMenus(entries.map(entry => entry.entryId));
    // The API returns activity order; recent products are independent of execution state.
    const groups = [["recentProducts", entries.slice(0, 4)], ["otherProducts", entries.slice(4)]];
    for (const [groupIndex, [key, items]] of groups.entries()) {
      if (!items.length) continue;
      const group = element("section", "product-group");
      const heading = element("h2", "product-group-title", message(key).startsWith("filter") ? message("productList") : message(key));
      heading.append(element("span", "count-badge", formatNumber(items.length)));
      const table = element("table", "product-table"); table.setAttribute("aria-label", heading.textContent);
      const head = element("tr", "product-head"); head.setAttribute("role", "row");
      for (const [label, field] of [["example", "preview"], ["productName", "name"], ["runtimeStatus", "status"], ["latestRound", "round"], ["recentWork", "work"], ["updatedTime", "activity"]]) head.append(columnHeader(label, field, groupIndex === 0 ? "primary" : "remaining"));
      const shown = groupIndex === 1 ? items.slice(0, 4) : items;
      const header = element("thead"), body = element("tbody"); header.append(head); body.append(...shown.map(renderRow)); table.append(header, body); group.append(heading, table);
      if (groupIndex === 1 && items.length > 4) {
        const disclosure = element("details", "other-products-disclosure"); disclosure.open = state.otherExpanded;
        const label = () => message(state.otherExpanded ? "collapseProducts" : "expandProducts", { count: items.length });
        const trigger = focusKey(element("summary", "text-button", label()), "other-products:toggle");
        if (!state.otherExpanded) trigger.append(element("span", "count-badge", formatNumber(items.length)));
        const remaining = element("table", "product-table"); remaining.setAttribute("aria-label", heading.textContent);
        const remainingBody = element("tbody"); remainingBody.append(...items.slice(4).map(renderRow)); remaining.append(remainingBody);
        disclosure.append(trigger, remaining);
        disclosure.addEventListener("toggle", () => {
          if (!disclosure.isConnected) return;
          state.otherExpanded = disclosure.open;
          const button = disclosure.querySelector(".disclosure-trigger"); button.textContent = label();
          if (!state.otherExpanded) button.append(element("span", "count-badge", formatNumber(items.length)));
        });
        group.append(disclosure);
      }
      container.append(group);
    }
    if (!entries.length) {
      const emptyState = emptyListState(entries);
      listState.append(element("span", "", emptyState.messageKey === "noMatches" ? `${message("noMatchesConditions", { query: state.query || message("anyQuery"), filter: filterLabel(state.filter) })}${state.roundFilter !== "all" ? ` ${message("latestRound")}: ${roundLabel(state.roundFilter)}` : ""}` : message(emptyState.messageKey)));
      if (emptyState.actionKey) {
        const action = element("button", "text-button", message(emptyState.actionKey)); action.type = "button";
        action.addEventListener("click", () => { state.query = ""; $("productSearch").value = ""; state.filter = emptyState.target; state.roundFilter = "all"; saveView(); renderPage(); $("productSearch").focus(); });
        listState.append(action);
      }
      if (!["noMatches", "loadFailed"].includes(emptyState.messageKey)) {
        for (const [key, trigger] of [["newWork", "newWorkButton"], ["importProduct", "importButton"]]) {
          const action = element("button", key === "newWork" ? "button primary" : "button secondary", message(key)); action.type = "button"; action.disabled = $(trigger).disabled;
          action.onclick = () => $(trigger).click(); listState.append(action);
        }
      }
    }
  }

  function renderActivity() {
    const counts = normalizeCounts();
    const active = state.summary?.currentRequests || [state.summary?.currentRequest].filter(Boolean);
    const unconfirmed = !state.summary || state.stale || active.some((request) => !requestIsFresh(request)) || state.summary.occupiedCount > active.length;
    const summary = clear($("capacitySummary"));
    if (state.loading || unconfirmed) summary.textContent = message(state.loading ? "loading" : "runtimeUnconfirmed");
    else for (const [key, value] of [["capacityRunning", counts.running], ["capacityWaiting", state.summary?.queuedCount ?? counts.queued], ["capacityLimit", state.summary?.maxConcurrentProjects === null ? message("unlimited") : state.summary?.maxConcurrentProjects ?? "—"]]) {
      const row = element("span", "capacity-line", message(key));
      row.append(element("span", "count-badge", String(value))); summary.append(row);
    }
  }

  function renderCounts() {
    const counts = normalizeCounts();
    for (const key of ["All", "Running", "Queued", "Attention", "Archived"]) {
      const value = counts[key.toLowerCase()], existing = $(`count${key}`);
      if (!value) { existing?.remove?.(); continue; }
      const count = existing || element("span", "filter-count count-badge"); count.id = `count${key}`; count.textContent = formatNumber(value);
      if (!existing) $("filters").querySelector(`[data-filter="${key.toLowerCase()}"]`).append(count);
    }
    const current = state.summary?.currentRequest;
    const queueCount = (state.summary?.queuedCount || 0) + (state.summary?.attentionCount || 0) + (state.summary?.preparationCount || 0) + (state.summary?.currentRequests ? state.summary.currentRequests.filter((item) => item.state !== "attention").length : current && current.state !== "attention" ? 1 : 0);
    $("queueNavCount").hidden = !queueCount; clear($("queueNavCount")).append(element("span", "count-badge", formatNumber(queueCount)));
  }

  function applyLanguage() {
    window.DashboardUI.selectFilter?.(state.filter);
    document.documentElement.lang = state.language;
    document.title = `Auto Company · ${message("products")}`;
    document.querySelectorAll("[data-i18n]").forEach((node) => { if (node.closest("button")?.dataset.idleText || node.closest('button[aria-busy="true"]')) return; node.textContent = message(node.dataset.i18n); });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => { node.placeholder = message(node.dataset.i18nPlaceholder); });
    document.querySelectorAll("[data-i18n-aria]").forEach((node) => { node.setAttribute("aria-label", message(node.dataset.i18nAria)); });
  }

  function renderPage() {
    const focused = rememberFocus();
    applyLanguage(); renderActivity(); renderCounts(); renderEntries(); renderQueue();
    if ($("newWorkDialog").open) updateGroupButtons();
    const executionAvailable = state.summary?.executionAvailable !== false;
    $("newWorkButton").disabled = state.stale || !executionAvailable;
    $("newWorkButton").title = !executionAvailable ? message("executionUnavailable") : "";
    $("newWorkUnavailable").hidden = executionAvailable && !state.stale;
    $("newWorkUnavailable").textContent = state.stale ? message("staleActionsDisabled") : !executionAvailable ? message("executionUnavailable") : "";
    $("connectionNotice").hidden = !state.stale;
    if (state.stale) {
      clear($("connectionNotice")).append(window.DashboardUI.alertMessage(message(state.entries.length ? "staleData" : "loadFailed") + (state.lastSuccessAt ? ` ${message("observedStale", { time: fullTime(state.lastSuccessAt) })}` : "")));
      const retry = element("button", "text-button", message("retry")); retry.type = "button"; retry.onclick = refresh; $("connectionNotice").querySelector("[data-slot=alert-description]").append(retry);
    }
    $("observedAt").textContent = state.lastSuccessAt ? message(state.stale ? "observedStale" : "refreshedAt", { time: fullTime(state.lastSuccessAt) }) : "";
    $("observedAt").title = fullTime(state.lastSuccessAt); $("observedAt").setAttribute("aria-label", fullTime(state.lastSuccessAt));
    document.querySelectorAll(".filter-button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.filter === state.filter)));
    window.DashboardIcons.hydrate();
    state.projectionSignature = runtimeProjectionSignature();
    window.DashboardUI?.mountControls();
    restoreFocus(focused);
  }

  function runtimeProjectionSignature(currentTime = Date.now()) {
    return JSON.stringify({
      stale: state.stale, day: window.DashboardDate.day(),
      current: requestDisplayState(state.summary?.currentRequest, currentTime),
      entries: state.entries.map((entry) => [entry.entryId, entryState(entry, currentTime), readonlyObservationState(entry, currentTime)]),
      requests: state.requests.map((request) => [request.requestId, requestDisplayState(request, currentTime)]),
    });
  }

  function refreshRuntimeProjection(currentTime = Date.now()) {
    const signature = runtimeProjectionSignature(currentTime);
    if (signature === state.projectionSignature) return;
    const focused = rememberFocus();
    renderActivity(); renderCounts(); renderEntries(); renderQueue();
    state.projectionSignature = signature;
    window.DashboardUI?.mountControls();
    restoreFocus(focused);
  }

  function queueGroups() {
    const groups = { running: [], queued: [], attention: [], history: [], preparing: [], operationAttention: [], operationHistory: [] };
    for (const request of state.requests) {
      const value = requestState(request);
      if (["running", "starting", "stopping"].includes(value)) groups.running.push(request);
      else if (value === "queued") groups.queued.push(request);
      else if (value === "attention") groups.attention.push(request);
      else if (TERMINAL_STATES.has(value)) groups.history.push(request);
      else if (value === "preparing") groups.attention.push(request);
    }
    for (const operation of state.operations) {
      if (operation.state === "preparing") groups.preparing.push(operation);
      else if (["failed", "attention"].includes(operation.state)) groups.operationAttention.push(operation);
      else if (operation.state === "succeeded") groups.operationHistory.push(operation);
    }
    groups.queued.sort((a, b) => (a.queuePosition ?? a.position ?? Infinity) - (b.queuePosition ?? b.position ?? Infinity));
    return groups;
  }

  function requestOwnsDispatch(request) {
    return Boolean(text(request?.dispatchId)) && ["starting", "running", "stopping", "attention"].includes(requestState(request));
  }

  function queueItem(request, index, group, queued) {
    const item = element("article", "queue-item");
    item.append(element("span", "queue-number", group === "queued" ? String(index + 1).padStart(2, "0") : ""));
    const body = element("div"); body.append(element("h4", "", text(request.displayName) || message(`kind_${request.kind}`)));
    const value = requestState(request);
    const displayValue = requestDisplayState(request);
    const activeCycle = ["starting", "running", "stopping"].includes(value) && request.cycleNumber;
    body.append(element("p", "", `${statusLabel(displayValue)}${activeCycle ? ` · ${message("cycleNumber", { number: String(activeCycle).padStart(2, "0") })}` : ""}`));
    const config = request.config || {};
    if (config.model || config.effort) body.append(element("p", "", message("plannedConfig", { model: config.model || message("notRecorded"), effort: config.effort || message("notRecorded") })));
    if (config.productLanguage) body.append(element("p", "", message("languageConfig", { language: languageLabel(config.productLanguage) })));
    const reason = executionBlockReason(request) || request.reasonDetail || request.attentionReason || request.terminalReason;
    if (reason) body.append(element("p", "", message("attentionReason", { reason: requestReason(reason) })));
    if (group === "queued") body.append(element("p", "", queueWaitReason()));
    if (displayValue === "unknown") body.append(element("p", "", `${message("evidenceMissing")} ${message("lastEvidence", { time: fullTime(request.liveConfirmedAt) })}`));
    const actions = element("div", "queue-actions");
    if (["running", "starting", "stopping"].includes(value)) {
      const stop = focusKey(element("button", "text-button danger", message("stopItem")), `request:${request.requestId}:stop`); stop.type = "button"; stop.disabled = value === "stopping" || state.stale; stop.addEventListener("click", () => confirmRequestAction(request, "stop")); actions.append(stop);
    } else if (group === "queued") {
      const up = focusKey(element("button", "text-button", message("moveUp")), `request:${request.requestId}:up`); up.type = "button"; up.disabled = index === 0 || state.stale; up.addEventListener("click", () => moveRequest(index, -1, queued));
      const down = focusKey(element("button", "text-button", message("moveDown")), `request:${request.requestId}:down`); down.type = "button"; down.disabled = index === queued.length - 1 || state.stale; down.addEventListener("click", () => moveRequest(index, 1, queued));
      const cancel = focusKey(element("button", "text-button danger", message("cancelItem")), `request:${request.requestId}:cancel`); cancel.type = "button"; cancel.disabled = state.stale; cancel.addEventListener("click", () => confirmRequestAction(request, "cancel"));
      actions.append(up, down, cancel);
      if (state.stale) actions.append(element("small", "disabled-reason", message("staleActionsDisabled")));
      else if (index === 0 || index === queued.length - 1) actions.append(element("small", "disabled-reason", [index === 0 ? message("firstQueueItem") : "", index === queued.length - 1 ? message("lastQueueItem") : ""].filter(Boolean).join(" ")));
    } else if (group === "attention") {
      if (requestOwnsDispatch(request)) {
        const stop = focusKey(element("button", "text-button danger", message("stopItem")), `request:${request.requestId}:stop`); stop.type = "button"; stop.disabled = state.stale; stop.addEventListener("click", () => confirmRequestAction(request, "stop")); actions.append(stop);
      }
      const reconcile = focusKey(element("button", "text-button", message("reconcile")), `request:${request.requestId}:reconcile`); reconcile.type = "button"; reconcile.disabled = state.stale; reconcile.addEventListener("click", () => runRequestAction(request, "reconcile")); actions.append(reconcile);
    }
    item.append(body, actions); return item;
  }

  function operationItem(operation) {
    const item = element("article", "queue-item");
    item.append(element("span", "queue-number", ""));
    const body = element("div");
    body.append(element("h4", "", message("preparationItem")));
    body.append(element("p", "", message(operation.state === "succeeded" ? "preparationSucceeded" : operation.state === "preparing" ? "state_preparing" : operation.state === "attention" ? "state_attention" : "state_failed")));
    if (operation.reason) body.append(element("p", "", message("attentionReason", { reason: requestReason(operation.reason) })));
    if (operation.createdAt) body.append(element("p", "", message("createdAt", { time: formatTime(operation.createdAt) })));
    const actions = element("div", "queue-actions");
    if (operation.state !== "succeeded") {
      const check = focusKey(element("button", "text-button", message("recheckPreparation")), `operation:${operation.operationId}:recheck`);
      check.type = "button"; check.disabled = state.stale; check.addEventListener("click", refresh); actions.append(check);
    }
    item.append(body, actions); return item;
  }

  function operationSection(titleKey, items) {
    const section = element("section", "queue-section");
    const heading = element("h3", "count-heading", message(titleKey));
    heading.append(element("span", "count-badge", formatNumber(items.length))); section.append(heading);
    items.forEach((operation) => section.append(operationItem(operation)));
    return section;
  }

  function queueSection(titleKey, items, group, queued) {
    const section = element("section", "queue-section");
    const heading = element("h3", "count-heading", message(titleKey));
    heading.append(element("span", "count-badge", formatNumber(items.length))); section.append(heading);
    items.forEach((request, index) => section.append(queueItem(request, index, group, queued)));
    return section;
  }

  function renderQueueSidebar(groups) {
    const content = clear($("queueSidebarContent"));
    const requests = groups.queued;
    clear($("queueSidebarCount")).append(element("span", "count-badge", formatNumber(requests.length)));
    for (const request of requests) {
      const item = element("article", "queue-preview");
      item.append(element("span", "queue-preview-number", requestState(request) === "queued" ? String(groups.queued.indexOf(request) + 1) : "!"));
      const body = element("div", "queue-preview-body");
      const name = element(request.entryId ? "a" : "strong", "queue-preview-name", text(request.displayName) || message(`kind_${request.kind}`));
      if (request.entryId) { name.href = `/products/${encodeURIComponent(request.entryId)}`; focusKey(name, `queue-preview:${request.requestId}:view`); }
      const entry = state.entries.find((entry) => entry.entryId === request.entryId);
      body.append(name);
      if (entry?.description) body.append(element("p", "", entry.description));
      body.append(element("p", "", `${statusLabel(requestDisplayState(request))}${request.createdAt ? ` · ${formatTime(request.createdAt)}` : ""}`));
      body.append(element("p", "", queueWaitReason()));
      const more = focusKey(element("button", "more-button"), `queue-preview:${request.requestId}`); more.type = "button"; more.append(window.DashboardIcons.icon("ellipsis-vertical"));
      more.setAttribute("aria-label", `${message("queueControls")} · ${name.textContent}`); more.addEventListener("click", openQueue);
      item.append(body, more); content.append(item);
    }
  }

  function renderQueue() {
    const capacity = $("capacityForm");
    if (capacity && !capacity.dataset.dirty) {
      capacity.elements.unlimited.checked = state.summary?.maxConcurrentProjects === null;
      capacity.elements.capacity.value = state.summary?.maxConcurrentProjects ?? 4;
      capacity.elements.capacity.disabled = capacity.elements.unlimited.checked;
    }
    const enabled = state.summary?.dispatchEnabled === true;
    $("dispatchLabel").textContent = message(enabled ? "dispatchOn" : "dispatchOff");
    $("dispatchHint").textContent = message(enabled ? "dispatchOnHint" : "dispatchOffHint");
    $("dispatchButton").textContent = message(enabled ? "pauseQueue" : "resumeQueue");
    $("dispatchButton").disabled = state.stale || state.actionLocks.has("dispatch") || (!enabled && state.summary?.executionAvailable === false);
    $("dispatchButton").title = !enabled && state.summary?.executionAvailable === false ? message("executionUnavailable") : "";
    if ($("dispatchButton").disabled) $("dispatchHint").textContent += ` ${message(state.stale ? "staleActionsDisabled" : "executionUnavailable")}`;
    const content = clear($("queueContent"));
    const groups = queueGroups();
    renderQueueSidebar(groups);
    if (groups.running.length) content.append(queueSection("runningSection", groups.running, "running", groups.queued));
    if (groups.preparing.length) content.append(operationSection("preparingSection", groups.preparing));
    if (groups.queued.length) content.append(queueSection("queuedSection", groups.queued, "queued", groups.queued));
    if (groups.attention.length) content.append(queueSection("attentionSection", groups.attention, "attention", groups.queued));
    if (groups.operationAttention.length) content.append(operationSection("preparationAttentionSection", groups.operationAttention));
    if (state.historyVisible && groups.history.length) content.append(queueSection("historySection", groups.history, "history", groups.queued));
    if (state.historyVisible && groups.operationHistory.length) content.append(operationSection("preparationHistorySection", groups.operationHistory));
    if (!groups.running.length && !groups.preparing.length && !groups.queued.length && !groups.attention.length && !groups.operationAttention.length && !(state.historyVisible && (groups.history.length || groups.operationHistory.length))) content.append(element("p", "list-state", message("queueEmpty")));
    $("queueHistoryButton").textContent = message(state.historyVisible ? "hideHistory" : "showHistory");
    const ownedAttention = groups.attention.some(requestOwnsDispatch);
    $("stopAllButton").disabled = state.stale || (!groups.running.length && !groups.preparing.length && !groups.queued.length && !ownedAttention);
    $("stopAllReason").textContent = $("stopAllButton").disabled ? message(state.stale ? "staleActionsDisabled" : "noActiveWork") : "";
  }

  async function refresh() {
    if (state.refreshing) return state.refreshing;
    const token = ++state.refreshToken;
    const promise = (async () => {
      try {
        const [summary, entries, requests, operations, preferences] = await Promise.all([
          api("/summary"), allEntries(), api("/requests?limit=100"), api("/operations"), api("/preferences"),
        ]);
        if (token !== state.refreshToken) return;
        if (!summary || !Array.isArray(entries?.items) || !Array.isArray(requests?.items) || !Array.isArray(operations?.items)) throw new APIError({ code: "INVALID_RESPONSE" }, 200);
        state.summary = summary; state.entries = entries.items; state.requests = requests.items; state.operations = operations.items; state.preferences = preferences; state.loading = false; state.stale = false;
        state.lastSuccessAt = state.observedAt || new Date().toISOString();
        const language = summary.language || state.preferences?.language;
        if (["en", "zh-CN"].includes(language)) state.language = language;
        renderPage();
        if (state.restoreScroll !== null) { window.scrollTo(0, state.restoreScroll); state.restoreScroll = null; }
      } catch (_) {
        if (token !== state.refreshToken) return;
        state.loading = false; state.stale = true; renderPage();
      } finally {
        state.refreshing = null; clearTimeout(state.timer); if (state.autoRefresh) state.timer = setTimeout(refresh, state.stale ? 15000 : 5000);
      }
    })();
    state.refreshing = promise; return promise;
  }

  function showStatus(key, values = {}, isError = false) {
    if (!isError) window.DashboardUI.notify(message(key, values));
    if (isError) { $("actionError").hidden = false; $("actionError").replaceChildren(window.DashboardUI.alertMessage(message(key, values))); }
    else { $("actionError").hidden = true; $("actionError").textContent = ""; }

  }

  function setFormStatus(form, value, isError = false) {
    const node = form.querySelector(".form-status"); node.textContent = value; node.classList.toggle("error", isError);
  }
  function beginSubmission(form, key = "actionPending", button = form.querySelector('[type="submit"]')) {
    if (form.dataset.submitting === "true") return false;
    form.dataset.submitting = "true"; form.setAttribute("aria-busy", "true");
    if (button) { button.dataset.idleText = button.textContent; button.disabled = true; button.textContent = message(key); }
    setFormStatus(form, `${message(key)} ${message("pendingCloseHint")}`); return true;
  }
  function reserveSubmissionWidth(button) {
    if (!button) return;
    const context = document.createElement("canvas").getContext("2d"), style = getComputedStyle(button);
    if (!context) return;
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const formId = button.closest("form")?.id;
    const keys = button.id === "centerRefreshButton" ? ["loading"] : button.id === "commitImportButton" ? ["actionPending"]
      : ["newWorkForm", "continueForm"].includes(formId) ? ["submittingQueue", "submittingStart"] : ["settingsForm", "capacityForm"].includes(formId) ? ["saving"] : formId === "importForm" ? ["probing"] : ["actionPending"];
    const labels = [button.textContent, ...keys.map(key => message(key))];
    const width = Math.ceil(Math.max(...labels.map(label => context.measureText(label).width)) + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth));
    button.style.minWidth = `min(${width}px, 100%)`;
  }
  function endSubmission(form, button = form.querySelector('[type="submit"]')) {
    delete form.dataset.submitting; form.removeAttribute("aria-busy");
    if (button) { button.disabled = false; button.textContent = button.dataset.idleText || button.textContent; delete button.dataset.idleText; }
  }
  function clearFieldError(field) {
    if (!field.dataset.errorId) return;
    $(field.dataset.errorId)?.remove(); field.removeAttribute("aria-invalid");
    const ids = (field.getAttribute("aria-describedby") || "").split(/\s+/).filter(id => id && id !== field.dataset.errorId);
    if (ids.length) field.setAttribute("aria-describedby", ids.join(" ")); else field.removeAttribute("aria-describedby");
    delete field.dataset.errorId;
  }
  function markFieldError(field, key) {
    clearFieldError(field);
    const id = `${field.closest("form")?.id || "field"}-${field.closest(".work-group")?.id || ""}-${field.name}-error`;
    const validity = field.validity;
    const error = element("small", "field-error", message(key || (validity.valueMissing ? "fieldRequired" : validity.rangeUnderflow || validity.rangeOverflow ? "fieldRange" : "fieldInvalid"), { min: field.min || "1", max: field.max || "∞" }));
    error.id = id; error.setAttribute("role", "alert"); field.after(error); field.dataset.errorId = id;
    field.setAttribute("aria-invalid", "true"); field.setAttribute("aria-describedby", `${field.getAttribute("aria-describedby") || ""} ${id}`.trim());
  }

  function fillDefaults(form, productLanguage) {
    const defaults = state.preferences?.defaults || state.preferences || state.summary?.defaults || {};
    for (const name of ["engine", "model", "effort", "productLanguage"]) {
      const field = form.querySelector(`[name="${name}"]`); if (!field) continue;
      field.value = name === "productLanguage" && productLanguage ? productLanguage : defaults[name] || (name === "effort" ? "high" : name === "productLanguage" ? "zh-CN" : "");
    }
  }

  function openDialog(dialog) {
    window.DashboardUI?.mountControls();
    dialog.querySelectorAll("[data-error-id]").forEach(clearFieldError); dialog.showModal();
    dialog.querySelectorAll('[type="submit"], #commitImportButton, #centerRefreshButton').forEach(reserveSubmissionWidth);
    if (!window.DashboardUI) dialog.querySelector("input:not([type=radio]), textarea, select")?.focus();
  }
  function closeDialog(dialog) { if (dialog.open) dialog.close(); }

  function openContinue(entry) {
    state.menuEntryId = null; state.activeEntry = entry;
    const form = $("continueForm"); form.reset(); fillDefaults(form, entry.productLanguage || entry.language); renderTemplateControls(form);
    $("continueProduct").textContent = `${text(entry.displayName) || message("fieldMissing")} · ${text(entry.description) || message("purposeMissing")}`;
    const cap = capability(entry, "execute");
    $("continueCapability").hidden = cap.enabled && !state.stale; $("continueCapability").textContent = state.stale ? message("staleActionsDisabled") : cap.reason ? message("unavailableReason", { reason: capabilityReason(cap.reason) }) : message("capabilityUnavailable");
    form.querySelector('[type="submit"]').disabled = !cap.enabled || state.stale;
    setFormStatus(form, ""); openDialog($("continueDialog"));
  }

  function formConfig(form) {
    return Object.fromEntries(["engine", "model", "effort", "productLanguage"].map((name) => [name, text(form.querySelector(`[name="${name}"]`)?.value)]));
  }

  function setupGroup(group) {
    group.querySelectorAll(".field-error").forEach(node => node.remove());
    group.querySelectorAll("[data-error-id]").forEach(field => { field.removeAttribute("aria-invalid"); field.removeAttribute("aria-describedby"); delete field.dataset.errorId; });

    group.id = `work-group-${++state.nextWorkGroupId}`;
    group.setAttribute("aria-labelledby", `${group.id}-tab`);
    state.activeWorkGroupId = group.id;
    fillDefaults(group);
    group.querySelector('[name="count"]').value = "1";
    group.querySelector('[name="direction"]').value = "";
    renderTemplateControls(group);
    group.querySelector(".remove-group").onclick = () => {
      if ($("workGroups").children.length <= 1) return;
      const next = group.nextElementSibling || group.previousElementSibling;
      group.remove(); state.activeWorkGroupId = next.id;
      updateGroupButtons();
      $(`${next.id}-tab`).focus();
    };
    group.oninput = updateGroupButtons;
    group.onchange = updateGroupButtons;
    group.querySelectorAll("[data-count-step]").forEach((button) => {
      button.onclick = () => {
        const count = group.querySelector('[name="count"]');
        count.value = Math.min(100, Math.max(1, (Number(count.value) || 1) + Number(button.dataset.countStep)));
        updateGroupButtons();
      };
    });
    group.querySelector(".save-work-template").onclick = () => {
      group.querySelector(".template-editor").open = true;
      group.querySelector(".template-name").focus();
    };
    window.DashboardUI?.mountControls(group);
    updateGroupButtons();
  }

  function selectWorkGroup(group) {
    state.activeWorkGroupId = group.id;
    updateGroupButtons();
  }

  function updateGroupButtons() {
    const groups = [...$("workGroups").children], tabs = $("workGroupTabs");
    let total = 0;
    const options = [];
    groups.forEach((group, index) => {
      const count = Math.max(0, Number(group.querySelector('[name="count"]').value) || 0);
      total += count;
      const templateId = group.querySelector(".template-select")?.value;
      const template = state.preferences?.templates?.find(item => item.templateId === templateId);
      const title = template?.name || message("workGroupNumber", { number: index + 1 });
      options.push({ id: group.id, title, detail: message("workGroupDetail", { effort: group.querySelector('[name="effort"]').value, count }) });
      const selected = group.id === state.activeWorkGroupId;
      group.hidden = !selected;
      group.querySelector(".remove-group").hidden = groups.length === 1;
      group.querySelectorAll("[data-count-step]").forEach(control => { control.disabled = Number(control.dataset.countStep) < 0 ? count <= 1 : count >= 100; });
    });
    window.DashboardUI.groupTabs(tabs, options, state.activeWorkGroupId, id => selectWorkGroup($(id)));
    $("workBatchSummary").textContent = message("workBatchSummary", { count: total, groups: groups.length });
    const form = $("newWorkForm"), submit = form.querySelector('[type="submit"]');
    if (!state.workSubmitting) { submit.textContent = message("workCreateProjects", { count: total }); reserveSubmissionWidth(submit); }
    submit.disabled = state.stale || state.workSubmitting || total > 100;
    const capacity = state.summary?.maxConcurrentProjects;
    $("workExecutionHint").textContent = state.stale ? message("staleActionsDisabled") : total > 100 ? message("workBatchLimit")
      : form.elements.executionMode.value === "enqueue" ? message("workEnqueueHint")
      : capacity === null ? message("workUnlimitedHint") : message("workCapacityHint", { count: capacity ?? 4 });
  }

  function renderTemplateControls(scope, selectedId = state.preferences?.defaultTemplateId || "") {
    const container = scope.querySelector(".template-controls");
    if (!container) return;
    const workGroup = scope.classList.contains("work-group");
    const loadedRevision = state.preferences?.revision;
    clear(container);
    const label = element("label"); label.append(element("span", "", message("configurationTemplate")));
    const select = element("select"); select.classList.add("template-select");
    select.append(new Option(message("automaticConfiguration"), ""));
    for (const template of state.preferences?.templates || []) {
      select.append(new Option(template.name + (template.templateId === state.preferences.defaultTemplateId ? ` · ${message("defaultTemplate")}` : ""), template.templateId));
    }
    select.value = selectedId;
    label.append(select); container.append(label);
    const editor = element("details", "template-editor");
    editor.append(element("summary", workGroup ? "template-manage-toggle" : "", message(workGroup ? "workManageTemplates" : "manageTemplates")));
    if (workGroup) editor.id = `${scope.id}-templates`;
    const nameLabel = element("label"); nameLabel.append(element("span", "", message("templateName")));
    const name = element("input"); name.maxLength = 80; name.autocomplete = "off"; name.classList.add("template-name");
    name.name = "templateName";
    nameLabel.append(name); editor.append(nameLabel);
    const controls = element("div", "template-actions");
    const status = element("p", "template-status"); status.setAttribute("role", "status");
    const selected = () => (state.preferences?.templates || []).find((item) => item.templateId === select.value);
    name.value = selected()?.name || "";
    const buttons = [];
    const addAction = (key, action) => {
      const button = element("button", "text-button", message(key)); button.type = "button";
      button.addEventListener("click", async () => {
        if (key === "saveTemplate" && !text(name.value)) { markFieldError(name, "fieldRequired"); name.focus(); return; }
        if (scope.dataset.templateSubmitting === "true") return;
        scope.dataset.templateSubmitting = "true";
        buttons.forEach((item) => { item.disabled = true; }); status.textContent = message("actionPending");
        try {
          const mutation = action();
          const result = await write("/templates", { ...mutation, expectedRevision: loadedRevision });
          state.preferences = await api("/preferences");
          for (const other of document.querySelectorAll(".template-controls")) {
            const otherScope = other.closest(".work-group, form");
            if (otherScope && otherScope !== scope) renderTemplateControls(otherScope, other.querySelector("select")?.value || "");
          }
          renderTemplateControls(scope, result.template?.templateId && mutation.action !== "delete" ? result.template.templateId : "");
          scope.querySelector(".template-editor").open = true;
          scope.querySelector(".template-status").textContent = message("templateSaved");
        } catch (error) { status.textContent = errorText(error); }
        finally { delete scope.dataset.templateSubmitting; buttons.forEach((item) => { item.disabled = false; }); updateActions(); }
      });
      controls.append(button); buttons.push(button); return button;
    };
    addAction("saveTemplate", () => ({ action: "save", name: name.value,
      ...(selected()?.name === name.value.trim() ? { templateId: select.value } : {}), config: formConfig(scope) }));
    const makeDefault = addAction("setDefaultTemplate", () => ({ action: "default", templateId: select.value || null }));
    const remove = addAction("deleteTemplate", () => ({ action: "delete", templateId: select.value }));
    const disabledHint = element("small", "disabled-reason"); controls.append(disabledHint);
    const updateActions = () => { makeDefault.disabled = !select.value; remove.disabled = !select.value; disabledHint.textContent = select.value ? "" : message("selectTemplateFirst"); };
    if (scope.id === "settingsForm" && state.preferences?.defaultTemplateId) {
      addAction("clearDefaultTemplate", () => ({ action: "default", templateId: null }));
    }
    editor.append(controls, element("p", "template-hint", message("templateScopeHint")), status); container.append(editor);
    select.addEventListener("change", () => {
      const config = selected()?.config || state.preferences?.defaults || {};
      for (const [key, value] of Object.entries(config)) {
        const field = scope.querySelector(`[name="${key}"]`);
        if (field && !field.readOnly) field.value = value;
      }
      name.value = selected()?.name || ""; updateActions();
      if (workGroup) updateGroupButtons();
    });
    updateActions();
    window.DashboardUI?.mountControls(container);
    if (workGroup) updateGroupButtons();
  }

  async function saveCapacity(event) {
    event.preventDefault(); const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]'); if (!beginSubmission(form, "saving")) return;
    try {
      await write("/queue/capacity", { maxConcurrentProjects: form.elements.unlimited.checked ? null : Number(form.elements.capacity.value), expectedRevision: state.summary?.queueRevision });
      delete form.dataset.dirty; setFormStatus(form, message("capacitySaved")); await refresh();
    } catch (error) { setFormStatus(form, errorText(error), true); }
    finally { endSubmission(form); }
  }

  async function submitContinue(event) {
    event.preventDefault(); const form = event.currentTarget; const entry = state.activeEntry; if (!entry) return;
    if (!beginSubmission(form, form.elements.executionMode.value === "enqueue" ? "submittingQueue" : "submittingStart")) return;
    try {
      await write("/requests", { kind: entry.kind === "exploration" ? "explore" : "continue", entryId: entry.entryId, sourceId: entry.sourceId, runtimeId: entry.runtimeId,
        expectedSourceRevision: entry.sourceRevision, executionMode: form.elements.executionMode.value, config: formConfig(form) });
      closeDialog($("continueDialog")); showStatus("requestCreated"); await refresh(); openQueue();
    } catch (error) { setFormStatus(form, message("requestFailed", { detail: errorText(error) }), true); }
    finally { endSubmission(form); form.querySelector('[type="submit"]').disabled = !capability(entry, "execute").enabled || state.stale; }
  }

  async function submitNewWork(event) {
    event.preventDefault(); const form = event.currentTarget;
    if (!beginSubmission(form, form.elements.executionMode.value === "enqueue" ? "submittingQueue" : "submittingStart")) return;
    state.workSubmitting = true;
    try {
      const groups = [...form.querySelectorAll(".work-group")].map((group) => ({ count: Number(group.querySelector('[name="count"]').value), direction: text(group.querySelector('[name="direction"]').value), config: formConfig(group) }));
      const batch = await write("/explorations/batch", { groups, executionMode: form.elements.executionMode.value }, 60000);
      for (const operation of batch.items || []) state.operations = [operation, ...state.operations.filter((item) => item.operationId !== operation.operationId)];
      closeDialog($("newWorkDialog"));
      const items = batch.items || [], failed = items.filter(item => ["failed", "attention"].includes(item.state)).length;
      if (failed) showStatus("batchPartial", { total: items.length, failed, success: items.filter(item => item.state === "succeeded").length, pending: items.filter(item => item.state === "preparing").length }, true);
      else showStatus("explorationPrepared");
      await refresh(); openQueue();
    } catch (error) { setFormStatus(form, message("requestFailed", { detail: errorText(error) }), true); }
    finally { state.workSubmitting = false; endSubmission(form); updateGroupButtons(); }
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
    event.preventDefault(); const form = event.currentTarget; if (!beginSubmission(form, "probing")) return;
    state.probe = null; $("commitImportButton").hidden = true; $("probeResult").hidden = true;
    try {
      const mode = form.elements.mode.value;
      const candidate = await write("/imports/probe", { root: text(form.elements.root.value), ...(mode === "reference" ? { kindHint: "reference" } : {}) }, 60000);
      if (!candidate?.candidateId || !candidate?.candidateHash) throw new APIError({ code: "INVALID_RESPONSE" }, 200);
      state.probe = candidate; renderProbe(candidate); $("commitImportButton").hidden = false; setFormStatus(form, message("probeReady"));
    } catch (error) { setFormStatus(form, message("requestFailed", { detail: errorText(error) }), true); }
    finally { endSubmission(form); }
  }

  async function commitImport() {
    const form = $("importForm"); if (!state.probe) return;
    if (!beginSubmission(form, "actionPending", $("commitImportButton"))) return;
    $("probeButton").disabled = true;
    try {
      await write("/imports/commit", { candidateId: state.probe.candidateId, candidateHash: state.probe.candidateHash, mode: form.elements.mode.value === "reference" ? "reference" : "readonly", expectedRevision: state.revision }, 60000);
      closeDialog($("importDialog")); showStatus("importComplete"); state.probe = null; await refresh();
    } catch (error) { setFormStatus(form, message("requestFailed", { detail: errorText(error) }), true); }
    finally { endSubmission(form, $("commitImportButton")); $("probeButton").disabled = false; }
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
    if (enabled) button.addEventListener("click", async () => {
      const scope = $("sourceManagerBody"); if (scope.dataset.submitting === "true") return;
      scope.dataset.submitting = "true"; scope.setAttribute("aria-busy", "true");
      const controls = [...scope.querySelectorAll("button, input")].map(node => [node, node.disabled]); controls.forEach(([node]) => { node.disabled = true; });
      const label = button.textContent; button.textContent = message("actionPending");
      try { await action(); }
      finally { delete scope.dataset.submitting; scope.removeAttribute("aria-busy"); controls.forEach(([node, disabled]) => { if (node.isConnected) node.disabled = disabled; }); if (button.isConnected) button.textContent = label; }
    });
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
    const root = element("input"); root.type = "text"; root.autocomplete = "off"; root.spellcheck = false; root.placeholder = message("folderPlaceholder"); reconnect.append(root, element("small", "", message("reconnectHint"))); body.append(reconnect);
    const actions = element("div", "management-actions"); const takeover = capability(entry, "takeover"); const release = capability(entry, "release"); const preview = capability(entry, "preview"); const previewStop = capability(entry, "previewStop"); const capture = capability(entry, "capture");
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
    managementAction(actions, "previewStop", current && previewStop.enabled, !current ? "selectCurrentFirst" : previewStop.reason, () => sourceOperation(`/entries/${encodeURIComponent(entry.entryId)}/preview/stop`, { sourceId: source.sourceId, expectedRevision: sourceRevision }));
    managementAction(actions, "captureMedia", current && capture.enabled, !current ? "selectCurrentFirst" : capture.reason, () => sourceOperation(`/entries/${encodeURIComponent(entry.entryId)}/media/capture`, { sourceId: source.sourceId, expectedRevision: sourceRevision }));
    managementAction(actions, "detachEntry", current && !release.enabled, !current ? "selectCurrentFirst" : release.enabled ? "releaseFirst" : "", () => { closeDialog($("sourceDialog")); confirmReferenceDetach(entry); }, true);
    body.append(actions);
    window.DashboardUI?.mountControls(body);
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
      fillDefaults(form); renderTemplateControls(form); setFormStatus(form, "");
      $("defaultsTemplateHint").hidden = !state.preferences.defaultTemplateId;
    } catch (error) { setFormStatus(form, message("requestFailed", { detail: errorText(error) }), true); }
  }

  async function savePreferences(event) {
    event.preventDefault(); const form = event.currentTarget; if (!beginSubmission(form, "saving")) return;
    try {
      state.preferences = await write("/preferences", { preferences: { language: form.elements.language.value, ...formConfig(form) }, expectedRevision: state.preferences?.revision ?? state.revision });
      state.language = form.elements.language.value; closeDialog($("settingsDialog")); renderPage(); showStatus("preferencesSaved"); await refresh();
    } catch (error) { setFormStatus(form, message("requestFailed", { detail: errorText(error) }), true); }
    finally { endSubmission(form); }
  }

  function confirmAction(titleKey, messageKey, action, danger = false, name = "", actionKey = titleKey) {
    state.confirmAction = action; $("confirmTitle").textContent = message(titleKey); $("confirmMessage").textContent = `${name ? `${message("objectConfirmation", { name })} · ` : ""}${message(messageKey)}`;
    $("confirmActionButton").textContent = message(actionKey); delete $("confirmActionButton").dataset.i18n;
    $("confirmActionButton").classList.toggle("primary", !danger); $("confirmActionButton").classList.toggle("danger", danger);
    $("confirmActionButton").className = element("button", danger ? "button danger" : "button primary").className;
    $("confirmActionButton").dataset.variant = danger ? "destructive" : "default";
    setFormStatus($("confirmForm"), ""); openDialog($("confirmDialog"));
  }

  function confirmEntryVisibility(entry) {
    const action = entry.archived ? "restore" : "archive";
    confirmAction(`${action}Title`, `${action}Message`, async () => {
      await write(`/entries/${encodeURIComponent(entry.entryId)}/${action}`, { expectedRevision: entry.revision ?? state.revision });
      showStatus(entry.archived ? "restoreSuccess" : "archiveSuccess"); await refresh();
    }, false, entry.displayName || message("fieldMissing"), action);
  }

  function confirmReferenceDetach(entry) {
    const reference = entry.kind === "reference";
    confirmAction(reference ? "detachReferenceTitle" : "detachEntryTitle", reference ? "detachReferenceMessage" : "detachEntryMessage", async () => {
      await write(`/entries/${encodeURIComponent(entry.entryId)}/detach`, { expectedRevision: entry.revision ?? state.revision });
      showStatus(reference ? "detachReferenceSuccess" : "detachEntrySuccess"); await refresh();
    }, true, entry.displayName || message("fieldMissing"), reference ? "detachReference" : "detachEntry");
  }

  function confirmRequestAction(request, action) {
    confirmAction(action === "stop" ? "stopTitle" : "cancelTitle", action === "stop" ? "stopMessage" : "cancelMessage", () => runRequestAction(request, action, true), action === "stop", request.displayName || message(`kind_${request.kind}`), action === "stop" ? "stopItem" : "cancelItem");
  }

  async function runRequestAction(request, action, propagate = false) {
    const lock = `request:${request.requestId}`; if (state.actionLocks.has(lock)) return;
    state.actionLocks.add(lock);
    const controls = [...document.querySelectorAll("[data-focus-key]")].filter(node => node.dataset.focusKey.startsWith(`${lock}:`)); controls.forEach(node => { node.disabled = true; });
    try {
      const body = action === "stop" ? { expectedDispatchId: request.dispatchId } : { expectedRevision: request.revision ?? state.revision };
      await write(`/requests/${encodeURIComponent(request.requestId)}/${action}`, body, action === "stop" ? 60000 : 30000);
      showStatus("actionAccepted"); await refresh();
    } catch (error) { if (propagate) throw error; showStatus("requestFailed", { detail: errorText(error) }, true); }
    finally { state.actionLocks.delete(lock); const focused = rememberFocus(); renderQueue(); restoreFocus(focused); }
  }

  async function moveRequest(index, offset, queued) {
    if (state.actionLocks.has("queue-order")) return; state.actionLocks.add("queue-order");
    const reordered = [...queued]; const [item] = reordered.splice(index, 1); reordered.splice(index + offset, 0, item);
    try {
      await write("/queue/order", { requestIds: reordered.map((request) => request.requestId), expectedRevision: state.summary?.queueRevision });
      showStatus("queueChanged"); await refresh();
    } catch (error) { showStatus("requestFailed", { detail: errorText(error) }, true); }
    finally { state.actionLocks.delete("queue-order"); }
  }

  async function toggleDispatch() {
    if (state.actionLocks.has("dispatch")) return; state.actionLocks.add("dispatch");
    const action = state.summary?.dispatchEnabled === true ? "pause" : "resume";
    $("dispatchButton").disabled = true;
    try { await write(`/queue/${action}`, { expectedRevision: state.summary?.queueRevision }); showStatus("actionAccepted"); await refresh(); }
    catch (error) { showStatus("requestFailed", { detail: errorText(error) }, true); }
    finally { state.actionLocks.delete("dispatch"); renderQueue(); }
  }

  function openQueue() {
    state.drawerOpen = true;
    $("queueNavButton").setAttribute("aria-expanded", "true");
    $("queueDrawer").showModal();
    $("capacityForm").querySelectorAll('[type="submit"]').forEach(reserveSubmissionWidth);
  }

  function closeQueue() { $("queueDrawer").close(); }

  function clearFilters() { state.filter = "all"; state.roundFilter = "all"; state.query = ""; $("productSearch").value = ""; renderPage(); }

  function resetImportProbe() {
    state.probe = null; $("probeResult").hidden = true; $("commitImportButton").hidden = true; setFormStatus($("importForm"), "");
  }

  function wire() {
    state.loadStarted = performance.now();
    $("queueNavButton").addEventListener("click", openQueue); $("closeQueueButton").addEventListener("click", closeQueue);
    $("queueDrawer").addEventListener("close", () => { state.drawerOpen = false; $("queueNavButton").setAttribute("aria-expanded", "false"); });
    $("dispatchButton").addEventListener("click", toggleDispatch);
    $("stopAllButton").addEventListener("click", () => {
      const groups = queueGroups();
      const names = [...groups.running, ...groups.queued, ...groups.attention.filter(requestOwnsDispatch)].map(request => text(request.displayName) || message(`kind_${request.kind}`));
      if (groups.preparing.length) names.push(`${message("preparationItem")} × ${groups.preparing.length}`);
      confirmAction("stopAllTitle", "stopAllMessage", async () => { await write("/queue/stop-all", { expectedRevision: state.summary?.queueRevision }, 60000); showStatus("actionAccepted"); await refresh(); }, true, names.join(" · "), "stopAll");
    });
    $("queueHistoryButton").addEventListener("click", () => { state.historyVisible = !state.historyVisible; renderQueue(); });
    $("newWorkButton").addEventListener("click", () => { const form = $("newWorkForm"); form.reset(); while ($("workGroups").children.length > 1) $("workGroups").lastElementChild.remove(); setupGroup($("workGroups").firstElementChild); setFormStatus(form, ""); openDialog($("newWorkDialog")); });
    $("importButton").addEventListener("click", () => { const form = $("importForm"); form.reset(); resetImportProbe(); openDialog($("importDialog")); });
    $("settingsButton").addEventListener("click", () => { openDialog($("settingsDialog")); loadPreferences(); });
    $("centerAutoRefresh").addEventListener("change", event => {
      state.autoRefresh = event.target.checked; clearTimeout(state.timer);
      try { window.localStorage?.setItem("auto-company:center:auto-refresh", state.autoRefresh ? "on" : "off"); } catch (_) {}
      if (state.autoRefresh) refresh();
    });
    $("centerRefreshButton").addEventListener("click", async event => { const button = event.currentTarget; if (button.disabled) return; button.disabled = true; button.setAttribute("aria-busy", "true"); button.textContent = message("loading"); try { await refresh(); } finally { button.disabled = false; button.removeAttribute("aria-busy"); button.textContent = message("retryRead"); } });
    $("addWorkGroup").addEventListener("click", () => {
      const group = $("workGroups").firstElementChild.cloneNode(true);
      $("workGroups").append(group); setupGroup(group);
      group.querySelector("input, select")?.focus();
    });
    $("newWorkForm").addEventListener("invalid", (event) => {
      const group = event.target.closest(".work-group"); if (group) selectWorkGroup(group);
    }, true);
    $("newWorkForm").addEventListener("change", (event) => { if (event.target.name === "executionMode") updateGroupButtons(); });
    $("capacityForm").addEventListener("change", (event) => {
      const form = event.currentTarget; form.dataset.dirty = "true";
      form.elements.capacity.disabled = form.elements.unlimited.checked;
    });
    $("capacityForm").addEventListener("submit", saveCapacity);
    $("newWorkForm").addEventListener("submit", submitNewWork); $("continueForm").addEventListener("submit", submitContinue); $("importForm").addEventListener("submit", submitProbe); $("commitImportButton").addEventListener("click", commitImport); $("settingsForm").addEventListener("submit", savePreferences);
    Array.from($("importForm").elements.mode).forEach((control) => control.addEventListener("change", resetImportProbe));
    $("importForm").elements.root.addEventListener("input", resetImportProbe);
    $("confirmForm").addEventListener("submit", async (event) => {
      event.preventDefault(); const action = state.confirmAction; if (!action || !beginSubmission($("confirmForm"))) return; const button = $("confirmActionButton");
      try { await action(); state.confirmAction = null; closeDialog($("confirmDialog")); }
      catch (error) { setFormStatus($("confirmForm"), message("requestFailed", { detail: errorText(error) }), true); }
      finally { endSubmission($("confirmForm")); }
    });
    document.querySelectorAll(".dialog-close").forEach((button) => button.addEventListener("click", () => closeDialog(button.closest("[data-dialog-id]"))));
    document.querySelectorAll("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => { if (event.target !== dialog) return; const box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeDialog(dialog); }));
    document.querySelectorAll(".filter-button").forEach((button) => button.addEventListener("click", () => { state.filter = button.dataset.filter; saveView(); renderPage(); }));
    document.querySelectorAll("[data-filter-target]").forEach((button) => button.addEventListener("click", () => { state.filter = button.dataset.filterTarget; saveView(); renderPage(); $("catalogHeading").scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }));
    let searchTimer; $("productSearch").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.query = $("productSearch").value.trim(); saveView(); renderEntries(); }, 120); });
    document.addEventListener("invalid", event => { if (event.target.closest("form")) markFieldError(event.target); }, true);
    document.addEventListener("input", event => { if (event.target.dataset.errorId && event.target.validity.valid) clearFieldError(event.target); });
    document.addEventListener("click", event => { if (event.target.closest('a[href^="/products/"]')) saveView(); });
    window.addEventListener("pagehide", saveView);

    document.addEventListener("visibilitychange", () => { clearTimeout(state.timer); if (!document.hidden && state.autoRefresh) refresh(); });
    loadView();
  }

  applyLanguage(); wire(); renderPage(); refresh();
  setTimeout(() => { if (state.loading) renderEntries(); }, 300);
  state.projectionTimer = setInterval(refreshRuntimeProjection, 1000);
})();
