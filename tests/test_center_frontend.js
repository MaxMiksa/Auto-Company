const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const dashboard = path.resolve(__dirname, "../dashboard");
const html = fs.readFileSync(path.join(dashboard, "center.html"), "utf8");
const app = fs.readFileSync(path.join(dashboard, "center.js"), "utf8");
const i18n = fs.readFileSync(path.join(dashboard, "center-i18n.js"), "utf8");
const journalHTML = fs.readFileSync(path.join(dashboard, "index.html"), "utf8");
const journalApp = fs.readFileSync(path.join(dashboard, "app.js"), "utf8");

function helpers() {
  const context = vm.createContext({
    window: {}, location: { pathname: "/center", origin: "http://127.0.0.1:8842" },
    document: {}, URL, Intl, Date, Number, Object, Set, Map, String, Math, AbortController, setTimeout, clearTimeout,
    crypto: { randomUUID: (() => { let value = 0; return () => `intent-${++value}`; })() },
  });
  vm.runInContext(i18n, context);
  vm.runInContext(fs.readFileSync(path.join(dashboard, "icons.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(dashboard, "date-time.js"), "utf8"), context);
  const binding = app.lastIndexOf("\n  applyLanguage(); wire(); renderPage(); refresh();");
  assert.ok(binding > 0, "Center event wiring must follow helper declarations");
  vm.runInContext(app.slice(0, binding) + "\n globalThis.center = { state, message, entryState, capability, capabilityReason, errorText, requestReason, requestIsFresh, executionBlockReason, requestDisplayState, requestOwnsDispatch, normalizeCounts, renderCounts, filteredEntries, sortedEntries, latestWorkSource, readonlyObservationState, emptyListState, requestState, statusLabel, write };\n})();", context);
  context.center.state.language = "en";
  return { ...context.center, messages: context.window.CENTER_MESSAGES, context };
}

function journalHelpers() {
  const context = vm.createContext({
    window: {}, location: { pathname: "/products/entry-a", origin: "http://127.0.0.1:8843" },
    document: {}, URL, Intl, Date, Number, Object, Set, Map, String, Math, AbortController, setTimeout, clearTimeout,
  });
  vm.runInContext(fs.readFileSync(path.join(dashboard, "i18n.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(dashboard, "icons.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(dashboard, "date-time.js"), "utf8"), context);
  const binding = journalApp.indexOf("\n  document.querySelectorAll('[data-tab]')");
  assert.ok(binding > 0, "Journal event wiring must follow helper declarations");
  vm.runInContext(journalApp.slice(0, binding) + "\n globalThis.journal = { state, scope, freshCenterRequest, centerRequestDisplayState, scopedCenterRuntimeState, scopedRecordedRuntimeState, runtimeStateValue, runtimeStatusLabel, runtimeLabel, requestContextLabel, centerRuntimeContextValue, historyGroups, fetchFullScopedJournal, journalPageMatches, safePreviewURL };\n})();", context);
  context.journal.state.language = "en";
  return { ...context.journal, context };
}

test("queue badge counts requests without treating read-only unknown products as queued work", () => {
  const { state, context, renderCounts } = helpers();
  const elements = {};
  context.document.getElementById = id => elements[id] ||= { replaceChildren() { this.textContent = ""; }, append(node) { this.textContent += node.textContent; } };
  context.window.DashboardUI = { element: (tag, className, text) => ({ textContent: text }) };
  state.entries = [1, 2, 3].map(id => ({ entryId: `archive-${id}`, kind: "product", executionSummary: { state: "unknown" } }));
  state.summary = { currentRequest: { requestId: "active", state: "running" }, queuedCount: 0, attentionCount: 0 };
  renderCounts();
  assert.equal(elements.countAttention.textContent, "3");
  assert.equal(elements.queueNavCount.textContent, "1");
  state.summary = { currentRequest: { requestId: "active", state: "attention" }, queuedCount: 0, attentionCount: 1 };
  renderCounts();
  assert.equal(elements.queueNavCount.textContent, "1");
  state.summary = { currentRequest: null, queuedCount: 0, attentionCount: 0 };
  renderCounts();
  assert.equal(elements.queueNavCount.hidden, true);
});

test("center fixed labels are complete and bilingual", () => {
  const { messages } = helpers();
  assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages["zh-CN"]).sort());
  const placeholders = (value) => [...value.matchAll(/\{([a-zA-Z]+)\}/g)].map((match) => match[1]).sort();
  for (const key of Object.keys(messages.en)) {
    assert.ok(messages.en[key] && messages["zh-CN"][key], `Empty translation: ${key}`);
    assert.deepEqual(placeholders(messages.en[key]), placeholders(messages["zh-CN"][key]), key);
  }
  const rendered = [...html.matchAll(/data-i18n(?:-placeholder|-aria)?="([^"]+)"/g), ...app.matchAll(/message\("([^"]+)"/g)];
  for (const [, key] of rendered) assert.ok(messages.en[key], `Missing rendered translation: ${key}`);
});

test("column ordering uses the whole filtered result before grouping and preserves unavailable values", () => {
  const { state, sortedEntries, filteredEntries } = helpers();
  state.entries = [
    { entryId: "a", kind: "product", displayName: "Zeta", cycleNumber: 9, latestCycleStatus: "completed", lastActivityAt: "2026-10-01T00:00:00Z" },
    { entryId: "b", kind: "product", displayName: "Alpha", cycleNumber: 2, latestCycleStatus: "failed", lastActivityAt: null },
    { entryId: "c", kind: "product", displayName: "Beta", latestCycleStatus: "completed", lastActivityAt: "2026-10-02T00:00:00Z" },
  ];
  state.sort = "name"; state.sortDirection = "asc";
  assert.deepEqual(Array.from(sortedEntries(), row => row.entryId), ["b", "c", "a"]);
  state.sort = "round"; state.sortDirection = "desc";
  assert.deepEqual(Array.from(sortedEntries(), row => row.entryId), ["a", "b", "c"]);
  state.roundFilter = "completed";
  assert.deepEqual(Array.from(filteredEntries(), row => row.entryId), ["a", "c"]);
  state.sort = "activity"; state.sortDirection = "asc"; state.roundFilter = "all";
  assert.deepEqual(Array.from(sortedEntries(), row => row.entryId), ["a", "c", "b"]);
});

test("runtime filters use fresh source observations while preserving read-only access", () => {
  const { state, entryState, filteredEntries, normalizeCounts, readonlyObservationState, latestWorkSource } = helpers();
  const states = ["read_only", "paused", "ended", "idle", "unknown", "failed", "canceled", "preparing"];
  state.entries = states.map(value => ({ entryId: value, kind: "product", executionSummary: { state: value } }));
  for (const value of states) { state.filter = value; assert.deepEqual(Array.from(filteredEntries(), entry => entry.entryId), value === "unknown" ? ["read_only", "unknown"] : [value]); }
  state.filter = "invalid-filter"; assert.equal(filteredEntries().length, 0);
  const now = Date.now(), source = { readonlyObservation: { state: "running", readOnly: true, scoped: true, liveConfirmedAt: new Date(now - 1000).toISOString() } };
  Object.assign(state.entries[0], source);
  assert.equal(readonlyObservationState(state.entries[0], now), "running");
  assert.equal(entryState(state.entries[0], now), "running");
  assert.equal(entryState(state.entries[0], now + 15000), "unknown");
  assert.equal(normalizeCounts().running, 1);
  assert.equal(readonlyObservationState(state.entries[0], now + 15000), "");
  assert.equal(readonlyObservationState({ readonlyObservation: { ...source.readonlyObservation, scoped: false } }, now), "");
  assert.equal(readonlyObservationState({ readonlyObservation: { state: "ended", readOnly: true, scoped: true, processState: "stopped", observedAt: new Date(now).toISOString() } }, now), "ended");
  assert.equal(latestWorkSource({ latestWork: { scope: "exploration", cycleNumber: 5, isLatestCycle: false } }), "Exploration record · Cycle 05");
  assert.equal(latestWorkSource({ latestWork: { scope: "product", cycleNumber: 7, isLatestCycle: true } }), "");
  assert.equal(latestWorkSource({ latestWork: { scope: "product", cycleNumber: 6, isLatestCycle: false } }), "Earlier work record · Cycle 06");
});

test("round filters match startup reservations without changing their raw status", () => {
  const { state, filteredEntries, sortedEntries } = helpers();
  state.entries = ["not_started", "startup_unconfirmed", "unknown", "pending"].map(value => ({ entryId: value, kind: "product", latestCycleStatus: value, lastActivityAt: "2026-10-03T00:00:00Z" }));
  for (const value of ["not_started", "startup_unconfirmed", "unknown", "pending"]) { state.roundFilter = value; assert.deepEqual(Array.from(filteredEntries(), entry => entry.entryId), [value]); }
  state.roundFilter = "all";
  assert.deepEqual(Array.from(sortedEntries(), entry => entry.entryId), ["not_started", "startup_unconfirmed", "unknown", "pending"], "Equal activity timestamps retain API order");
  state.entries[1].readonlyObservation = { readOnly: true, scoped: true, state: "ended", processState: "stopped", observedAt: new Date().toISOString() };
  state.roundFilter = "interrupted";
  assert.deepEqual(Array.from(filteredEntries(), entry => entry.entryId), ["startup_unconfirmed"]);
  assert.equal(state.entries[1].latestCycleStatus, "startup_unconfirmed", "Display projection must preserve the ledger status");
});

test("parallel projects use their own live request and include active exploration", () => {
  const { state, entryState, filteredEntries, normalizeCounts, renderCounts, context } = helpers();
  const fresh = new Date().toISOString();
  const requests = ["a", "b"].map(id => ({ requestId: `request-${id}`, entryId: `entry-${id}`, state: "running", liveConfirmedAt: fresh }));
  state.requests = requests;
  state.summary = { currentRequest: requests[0], currentRequests: requests, queuedCount: 1, attentionCount: 1 };
  state.entries = requests.map((request, index) => ({ entryId: request.entryId, kind: index ? "exploration" : "product", executionSummary: request }));
  state.entries.push({ entryId: "historical-exploration", kind: "exploration" });
  assert.equal(entryState(state.entries[1]), "running");
  assert.equal(filteredEntries().length, 2);
  assert.equal(normalizeCounts().running, 2);
  const elements = {};
  context.document.getElementById = id => elements[id] ||= { replaceChildren() { this.textContent = ""; }, append(node) { this.textContent += node.textContent; } };
  context.window.DashboardUI = { element: (tag, className, text) => ({ textContent: text }) };
  renderCounts();
  assert.equal(elements.queueNavCount.textContent, "4");
  requests[1].liveConfirmedAt = "2000-01-01T00:00:00Z";
  assert.equal(entryState(state.entries[1]), "unknown");
});

test("a product journal finds its own request among simultaneous owners", () => {
  const { state, freshCenterRequest } = journalHelpers();
  state.statusFailed = false;
  state.data = { entry: { entryId: "entry-a" } };
  const first = { entryId: "other-entry", state: "running", liveConfirmedAt: new Date().toISOString() };
  const own = { ...first, entryId: "entry-a" };
  state.centerSummary = { currentRequest: first, currentRequests: [first, own] };
  assert.equal(freshCenterRequest(), own);
});

test("entry state preserves unknown and keeps archive separate from execution", () => {
  const { state, entryState, statusLabel, messages } = helpers();
  const now = Date.now();
  state.summary = { currentRequest: { requestId: "request-a", entryId: "entry-a", state: "running", liveConfirmedAt: new Date(now - 1000).toISOString() } };
  assert.equal(entryState({ archived: true, executionSummary: { state: "running" } }), "archived");
  assert.equal(entryState({ entryId: "entry-a", executionSummary: { requestId: "request-a", state: "running" } }, now), "running");
  assert.equal(entryState({ entryId: "entry-b", executionSummary: { requestId: "request-b", state: "running" } }, now), "unknown");
  assert.equal(entryState({ executionSummary: { state: "queued" } }), "queued");
  assert.equal(entryState({ executionSummary: { state: "ended" } }), "ended");
  assert.equal(entryState({ executionSummary: { state: "unknown" } }), "unknown");
  assert.equal(entryState({ availability: { state: "conflict" }, capabilities: { execute: false }, executionSummary: { state: "idle" } }), "unknown");
  assert.equal(entryState({ availability: "read_only", capabilities: { execute: false }, executionSummary: { state: "idle" } }), "unknown");
  assert.equal(entryState({ availability: "available", executionSummary: {} }), "idle");
  assert.equal(statusLabel("future-state"), messages.en.state_unknown);
});

test("capability reasons remain visible independently of the boolean", () => {
  const { capability } = helpers();
  assert.deepEqual({ ...capability({ capabilities: { execute: true } }, "execute") }, { enabled: true, reason: "" });
  assert.deepEqual({ ...capability({ capabilities: { execute: false }, capabilityReasons: { execute: "READ_ONLY_SOURCE" } }, "execute") }, { enabled: false, reason: "READ_ONLY_SOURCE" });
  assert.deepEqual({ ...capability({ capabilities: { execute: { enabled: false, reason: "SOURCE_CONFLICT" } } }, "execute") }, { enabled: false, reason: "SOURCE_CONFLICT" });
});

test("execution preflight failures use fixed bilingual guidance instead of internal codes", () => {
  const { state, capabilityReason, errorText, requestReason } = helpers();
  const english = {
    registration: "The product registration does not match the current source. Restore or reconnect the registration before continuing.",
    context: "The product identity or run records required to continue cannot be verified. Restore the source state first.",
  };
  assert.equal(capabilityReason("product_registration_invalid"), english.registration);
  assert.equal(errorText({ code: "PRODUCT_REGISTRATION_INVALID", message: "technical fallback" }), english.registration);
  assert.equal(capabilityReason("context_unavailable"), english.context);
  assert.equal(errorText({ code: "CONTEXT_UNAVAILABLE" }), english.context);
  assert.equal(requestReason("PRODUCT_REGISTRATION_INVALID"), english.registration);
  assert.equal(requestReason("CONTEXT_UNAVAILABLE"), english.context);
  assert.equal(capabilityReason("governance_pause"), "Governance protection paused execution");
  assert.equal(capabilityReason("budget_pause"), "Budget protection paused execution");
  assert.equal(capabilityReason("stop_unconfirmed"), "Stop is not confirmed");
  assert.equal(requestReason("user_stop"), "Stopped as requested");
  assert.equal(requestReason("user_cancel"), "Queued request canceled");
  state.language = "zh-CN";
  assert.equal(capabilityReason("product_registration_invalid"), "产品登记与当前源码不一致。请恢复或重新连接登记后再继续。");
  assert.equal(requestReason("CONTEXT_UNAVAILABLE"), "无法核对继续工作所需的产品身份或运行记录。请先恢复来源状态。");
  assert.doesNotMatch(capabilityReason("product_registration_invalid"), /product_registration_invalid/i);
  assert.match(app, /const previewStop = capability\(entry, "previewStop"\)/);
  assert.match(app, /"previewStop", current && previewStop\.enabled/);
});

test("live unresolved P1 projects as blocked while preserving the raw running request", () => {
  const { state, requestState, executionBlockReason, requestDisplayState, entryState, capabilityReason, errorText, requestReason, statusLabel, filteredEntries, normalizeCounts } = helpers();
  const now = Date.now();
  const request = { requestId: "request-blocked", entryId: "blocked", state: "running", liveConfirmedAt: new Date(now - 1000).toISOString(), executionBlockedReason: "unresolved_p1", executionBlockedAt: new Date(now - 2000).toISOString() };
  state.stale = false;
  state.summary = { currentRequest: request, attentionCount: 0, counts: { attention: 0 } };
  assert.equal(requestState(request), "running", "Queue controls must retain the raw slot-owning state");
  assert.equal(executionBlockReason(request, now), "unresolved_p1");
  assert.equal(requestDisplayState(request, now), "blocked");
  assert.equal(statusLabel("blocked"), "Protection paused");
  const blockedEntry = { entryId: "blocked", kind: "product", archived: false, executionSummary: { requestId: "request-blocked", state: "blocked", reason: "unresolved_p1" } };
  assert.equal(entryState(blockedEntry, now), "blocked");
  assert.equal(capabilityReason("unresolved_p1"), "An unresolved P1 issue is waiting for a human decision before work can continue.");
  assert.equal(errorText({ code: "UNRESOLVED_P1" }), "An unresolved P1 issue is waiting for a human decision before work can continue.");
  assert.equal(requestReason("UNRESOLVED_P1"), "An unresolved P1 issue is waiting for a human decision before work can continue.");
  state.entries = [blockedEntry]; state.filter = "attention";
  assert.deepEqual(Array.from(filteredEntries(), entry => entry.entryId), ["blocked"]);
  assert.equal(normalizeCounts().attention, 1, "Product filter counts must not be overwritten by raw request summary counts");
  state.stale = true;
  assert.equal(executionBlockReason(request, now), "");
  assert.equal(requestDisplayState(request, now), "unknown");
  assert.equal(entryState(blockedEntry, now), "unknown");
  state.stale = false;
  const expired = { ...request, liveConfirmedAt: new Date(now - 15001).toISOString() };
  assert.equal(requestDisplayState(expired, now), "unknown");
  assert.equal(requestDisplayState({ ...expired, executionBlockedReason: null, executionBlockedAt: null }, now), "unknown", "An expired backend projection that cleared the block marker must not revert to Running");
  state.summary.currentRequest = expired;
  assert.equal(entryState(blockedEntry, now), "unknown");
  state.summary.currentRequest = { ...request, requestId: "request-other", entryId: "other" };
  assert.equal(entryState(blockedEntry, now), "unknown");
  state.summary.currentRequest = request;
  assert.equal(requestDisplayState({ ...request, executionBlockedAt: null }, now), "unknown");
  assert.match(app, /const value = requestState\(request\);\s+const displayValue = requestDisplayState\(request\)/);
  assert.match(app, /if \(\["running", "starting", "stopping"\]\.includes\(value\)\) \{\s+const stop =/);
  assert.match(app, /state\.projectionTimer = setInterval\(refreshRuntimeProjection, 1000\)/, "The visible projection must expire even while a refresh request is pending");
});

test("catalog filters use recorded state and never search report bodies", () => {
  const { state, filteredEntries } = helpers();
  state.entries = [
    { entryId: "a", displayName: "Alpha", description: "Decision tool", archived: false, kind: "product", executionSummary: { state: "idle" }, hiddenReport: "needle" },
    { entryId: "b", displayName: "Beta", description: "Text tool", archived: false, kind: "product", executionSummary: { state: "queued" } },
    { entryId: "c", displayName: "Archive", archived: true, kind: "product", executionSummary: { state: "ended" } },
    { entryId: "d", displayName: "Explore", archived: false, kind: "exploration", executionSummary: { state: "unknown" } },
    { entryId: "e", displayName: "Reference", archived: false, kind: "reference", executionSummary: { state: "idle" }, capabilities: { execute: false } },
  ];
  state.filter = "all"; state.query = "needle";
  assert.equal(filteredEntries().length, 0);
  state.query = ""; assert.deepEqual(Array.from(filteredEntries(), (entry) => entry.entryId), ["a", "b"]);
  state.filter = "queued"; assert.deepEqual(Array.from(filteredEntries(), (entry) => entry.entryId), ["b"]);
  state.filter = "attention"; assert.deepEqual(Array.from(filteredEntries(), (entry) => entry.entryId), []);
  state.filter = "archived"; assert.deepEqual(Array.from(filteredEntries(), (entry) => entry.entryId), ["c"]);
  state.filter = "exploration"; assert.deepEqual(Array.from(filteredEntries(), (entry) => entry.entryId), ["d"]);
  state.filter = "reference"; assert.deepEqual(Array.from(filteredEntries(), (entry) => entry.entryId), ["e"]);
});

test("unfiltered catalog without formed products points to explorations", () => {
  const { state, emptyListState } = helpers();
  state.entries = [{ entryId: "explore", kind: "exploration", archived: false }]; state.filter = "all"; state.query = "";
  assert.deepEqual({ ...emptyListState([]) }, { messageKey: "noFormedProducts", actionKey: "viewExplorations", target: "exploration" });
  state.query = "missing";
  assert.deepEqual({ ...emptyListState([]) }, { messageKey: "noMatches", actionKey: "clearFilters", target: "all" });
});

test("product detail trusts only the confirmed matching center request", () => {
  const { state, scopedCenterRuntimeState, runtimeStateValue, runtimeLabel, centerRuntimeContextValue } = journalHelpers();
  const now = Date.now();
  const request = { requestId: "request-a", entryId: "entry-a", state: "running", liveConfirmedAt: new Date(now - 1000).toISOString() };
  state.data = { entry: { entryId: "entry-a", executionSummary: { requestId: "request-a", state: "running" } }, cycles: [{ status: "completed", active: false }] };
  state.centerSummary = { currentRequest: request };
  state.statusFailed = false;
  assert.equal(scopedCenterRuntimeState(state.data, state.centerSummary, now), "running");
  assert.equal(runtimeStateValue(), "running");
  assert.equal(runtimeLabel(), "Running");
  assert.equal(centerRuntimeContextValue(state.centerSummary, now), "Current work · Running");
  state.centerSummary = { currentRequest: { ...request, entryId: "entry-b" } };
  assert.equal(scopedCenterRuntimeState(state.data, state.centerSummary, now), null);
  assert.equal(runtimeStateValue(), "unknown");
  assert.equal(runtimeLabel(), "Status unconfirmed");
  state.centerSummary = { currentRequest: { ...request, liveConfirmedAt: null } };
  assert.equal(scopedCenterRuntimeState(state.data, state.centerSummary, now), null);
});

test("product detail drops stale or disconnected running evidence", () => {
  const { state, freshCenterRequest, scopedCenterRuntimeState, runtimeStateValue, runtimeLabel, centerRuntimeContextValue } = journalHelpers();
  const now = Date.now();
  const entry = { entryId: "entry-a", executionSummary: { requestId: "request-a", state: "running" } };
  const currentRequest = { requestId: "request-a", entryId: "entry-a", state: "running", liveConfirmedAt: new Date(now - 1000).toISOString() };
  state.data = { entry, runtime: { state: "running" } }; state.centerSummary = { currentRequest }; state.statusFailed = true;
  assert.equal(scopedCenterRuntimeState(state.data, state.centerSummary, now), null);
  assert.equal(runtimeStateValue(), "unknown");
  assert.equal(runtimeLabel(), "Status unconfirmed");
  assert.equal(centerRuntimeContextValue(state.centerSummary, now), "");
  state.statusFailed = false; state.centerSummary.currentRequest.liveConfirmedAt = new Date(now - 15001).toISOString();
  assert.equal(freshCenterRequest(state.centerSummary, now), null);
  assert.equal(scopedCenterRuntimeState(state.data, state.centerSummary, now), null);
  assert.equal(runtimeStateValue(), "unknown");
  assert.equal(runtimeLabel(), "Status unconfirmed");
  assert.equal(centerRuntimeContextValue(state.centerSummary, now), "");
});

test("product detail labels recorded request states without claiming product completion", () => {
  const { state, scopedRecordedRuntimeState, runtimeStateValue, runtimeStatusLabel } = journalHelpers();
  state.statusFailed = false; state.centerSummary = { currentRequest: null };
  const labels = { ended: "Ended", canceled: "Work canceled", failed: "Work failed", queued: "Work queued", attention: "Work needs review" };
  for (const [value, label] of Object.entries(labels)) {
    state.data = { entry: { entryId: "entry-a", executionSummary: { requestId: `request-${value}`, state: value } } };
    assert.equal(scopedRecordedRuntimeState(), value);
    assert.equal(runtimeStateValue(), value);
    assert.equal(runtimeStatusLabel(value), label);
    assert.doesNotMatch(label, /product|complete/i);
  }
  state.data = { entry: { entryId: "entry-a", executionSummary: { state: "ended" } } };
  assert.equal(scopedRecordedRuntimeState(), null);
  assert.equal(runtimeStateValue(), "unknown");
});

test("cross-product running context includes the queued-plan identity", () => {
  const { state, requestContextLabel, centerRuntimeContextValue } = journalHelpers();
  assert.equal(requestContextLabel({ displayName: "Auto Company", config: { model: "gpt-5.6-luna", effort: "high" } }), "Auto Company · gpt-5.6-luna · high");
  assert.equal(requestContextLabel({ displayName: "Auto Company", sourceId: "source_1234567890" }), "Auto Company · …34567890");
  const now = Date.now(); state.statusFailed = false;
  state.centerSummary = { currentRequest: { requestId: "other", entryId: "entry-b", state: "starting", liveConfirmedAt: new Date(now - 1000).toISOString(), displayName: "Auto Company", config: { model: "gpt-5.6-luna", effort: "high" } } };
  assert.equal(centerRuntimeContextValue(state.centerSummary, now), "Other work · Starting: Auto Company · gpt-5.6-luna · high");
  state.centerSummary.currentRequest.state = "stopping";
  assert.equal(centerRuntimeContextValue(state.centerSummary, now), "Other work · Stopping: Auto Company · gpt-5.6-luna · high");
});

test("product detail shows only fresh matching unresolved-P1 protection", () => {
  const { state, centerRequestDisplayState, scopedCenterRuntimeState, runtimeStateValue, runtimeLabel, centerRuntimeContextValue } = journalHelpers();
  const now = Date.now();
  const request = { requestId: "request-p1", entryId: "entry-a", state: "running", liveConfirmedAt: new Date(now - 1000).toISOString(), executionBlockedReason: "unresolved_p1", executionBlockedAt: new Date(now - 2000).toISOString(), displayName: "Guarded product", config: { model: "gpt-6-sol", effort: "high" } };
  state.statusFailed = false;
  state.data = { entry: { entryId: "entry-a", executionSummary: { requestId: "request-p1", state: "blocked", reason: "unresolved_p1" } } };
  state.centerSummary = { currentRequest: request };
  assert.equal(centerRequestDisplayState(request, now), "blocked");
  assert.equal(scopedCenterRuntimeState(state.data, state.centerSummary, now), "blocked");
  assert.equal(runtimeStateValue(), "blocked");
  assert.equal(runtimeLabel(), "Protection paused · Waiting for human review");
  assert.equal(centerRuntimeContextValue(state.centerSummary, now), "Current work · Needs attention");
  state.centerSummary = { currentRequest: { ...request, entryId: "entry-b" } };
  assert.equal(centerRuntimeContextValue(state.centerSummary, now), "Other work · Needs attention: Guarded product · gpt-6-sol · high");
  state.centerSummary = { currentRequest: { ...request, liveConfirmedAt: new Date(now - 15001).toISOString() } };
  assert.equal(scopedCenterRuntimeState(state.data, state.centerSummary, now), null);
  assert.equal(centerRuntimeContextValue(state.centerSummary, now), "");
  state.centerSummary = { currentRequest: request }; state.statusFailed = true;
  assert.equal(runtimeStateValue(), "unknown");
  assert.equal(centerRuntimeContextValue(state.centerSummary, now), "");
});

test("linked exploration and product cycles stay in one default paginated history", async () => {
  const { context, fetchFullScopedJournal, historyGroups } = journalHelpers();
  const product = { id: "product-1", identityKind: "product", number: 1, sequenceNumber: 3, status: "completed" };
  const explorations = [2, 1].map(number => ({ id: `exp-${number}`, identityKind: "exploration", number, sequenceNumber: number, status: "completed" }));
  const envelope = { entryId: "entry-a", sourceId: "source-a", sourceRevision: 7, total: 3 };
  const pages = [{ ...envelope, cycles: [product], nextBefore: "cursor-a" }, { ...envelope, cycles: explorations, nextBefore: null }];
  const requests = [];
  context.fetch = async url => { requests.push(url); return { ok: true, json: async () => ({ schemaVersion: 1, data: pages.shift() }) }; };
  const result = await fetchFullScopedJournal();
  assert.deepEqual(Array.from(result.cycles, cycle => cycle.id), ["product-1", "exp-2", "exp-1"]);
  assert.deepEqual(Array.from(result.cycles, cycle => cycle.sequenceNumber), [3, 2, 1]);
  assert.deepEqual(Array.from(historyGroups(result, product).main, cycle => cycle.id), ["exp-2", "exp-1"]);
  assert.equal(result.cycles[0].number, 1, "Display numbering must not replace the product cycle number");
  assert.match(requests[1], /before=cursor-a&sourceId=source-a/);
  assert.ok(requests.every(url => !url.includes("section=")), "The default API supplies the full linked history");
});

test("continuous history rejects switched sources, revisions, duplicate cycles and incomplete pages", async () => {
  const envelope = { entryId: "entry-a", sourceId: "source-a", sourceRevision: 7, total: 2 };
  const first = { ...envelope, cycles: [{ id: "product-1" }], nextBefore: "cursor-a" };
  const second = { ...envelope, cycles: [{ id: "exp-1" }], nextBefore: null };
  for (const [change, error] of [
    [{ entryId: "entry-b" }, /Journal source changed/],
    [{ sourceId: "source-b" }, /Journal source changed/],
    [{ sourceRevision: 8 }, /Journal source changed/],
    [{ cycles: [{ id: "product-1" }] }, /Repeated journal cycle/],
    [{ cycles: [] }, /Incomplete journal history/],
    [{ nextBefore: "cursor-a" }, /Repeated journal cursor/],
  ]) {
    const { context, fetchFullScopedJournal } = journalHelpers();
    const pages = [first, { ...second, ...change }];
    context.fetch = async () => ({ ok: true, json: async () => ({ schemaVersion: 1, data: pages.shift() }) });
    await assert.rejects(fetchFullScopedJournal(), error);
  }
});

test("standalone exploration keeps its own cycles in the main journal", () => {
  const { historyGroups } = journalHelpers();
  const data = { entry: { kind: "exploration" }, cycles: [{ id: "exp-2", identityKind: "exploration" }, { id: "exp-1", identityKind: "exploration" }] };
  assert.deepEqual(Array.from(historyGroups(data, data.cycles[0]).main, cycle => cycle.id), ["exp-1"]);
});

test("shared idle label describes a live loop waiting for its next cycle", () => {
  const { context, state, runtimeStatusLabel } = journalHelpers();
  state.language = "zh-CN";
  assert.equal(runtimeStatusLabel("idle"), "等待下一轮");
  state.language = "en";
  assert.equal(runtimeStatusLabel("idle"), "Waiting for next cycle");
  assert.equal(context.window.DashboardStatus.visual("idle"), "pending");
});

test("center actions use the versioned envelope routes and explicit write preconditions", () => {
  for (const route of ["/summary", "/entries?filter=all&sort=activity&limit=100", "/requests?limit=100", "/operations", "/imports/probe", "/imports/commit", "/explorations", "/queue/order", "/queue/stop-all", "/preferences"]) {
    assert.ok(app.includes(route), `Missing route ${route}`);
  }
  assert.match(app, /expectedSourceRevision: entry\.sourceRevision/);
  assert.match(app, /expectedDispatchId: request\.dispatchId/);
  assert.match(app, /expectedRevision: state\.summary\?\.queueRevision/);
  assert.match(app, /kindHint: "reference"/);
  assert.match(app, /mode: form\.elements\.mode\.value === "reference" \? "reference" : "readonly"/);
  assert.match(app, /entry\.kind !== "reference"/);
  assert.match(app, /\/entries\/\$\{encodeURIComponent\(entry\.entryId\)\}\/detach/);
  assert.match(app, /source\.displayName \|\| source\.rootName/);
  assert.match(app, /source\.displayPath/);
  assert.match(app, /X-Idempotency-Key/);
});

test("uncertain transport retries reuse an intent key until success", async () => {
  const { write, context } = helpers(); const requests = []; let call = 0;
  context.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body)); call += 1;
    if (call <= 2) throw new TypeError("transport lost");
    return { ok: true, status: 200, json: async () => ({ schemaVersion: 1, data: { accepted: true } }) };
  };
  await assert.rejects(write("/explorations", { direction: "A" }));
  await assert.rejects(write("/explorations", { direction: "B" }));
  await write("/explorations", { direction: "A" });
  await write("/explorations", { direction: "A" });
  assert.equal(requests[0].idempotencyKey, requests[2].idempotencyKey);
  assert.notEqual(requests[0].idempotencyKey, requests[1].idempotencyKey);
  assert.notEqual(requests[2].idempotencyKey, requests[3].idempotencyKey);
});

test("product detail routes are entry scoped while the legacy journal stays unchanged", () => {
  assert.match(journalHTML, /id="productSwitcherDialog"/);
  assert.match(journalApp, /\^\\\/products\\\/\(\[\^\/\]\+\)/);
  assert.match(journalApp, /fetchFullScopedJournal\(\)/);
  assert.match(journalApp, /scopedJournalPath\('\/journal'\).*limit=100/);
  assert.match(journalApp, /scopedJournalPath\('\/usage'\).*period=/);
  assert.match(journalApp, /fetchScopedText\(id === 'runtime' \? state\.data\.runtimeLogUrl : cycle\?\.logUrl/);
  assert.match(journalApp, /else await fetchJSON\('\/api\/product-media\/capture'/);
  assert.ok(journalApp.includes("else await fetchJSON('/api/product-media/capture'"));
  assert.ok(journalApp.includes("scope.center ? await Promise.all([fetchFullScopedJournal(), fetchCenter('/summary')]) : null"));
  assert.match(journalApp, /fetchAllCenterEntries\(\)/);
  assert.match(journalApp, /engine: recordedCycle\?\.engine \|\| 'unknown'/);
  assert.match(journalApp, /reasoning: recordedCycle\?\.observedConfig\?\.reasoning \|\| 'unknown'/);
  assert.match(journalApp, /state\.data\?\.entry\?\.sourceRecordRevision/);
});

test("blank exploration direction stays a string and preparations survive refresh", () => {
  assert.match(app, /direction: text\(group\.querySelector/);
  assert.doesNotMatch(app, /direction: text\([^\n]+\|\| null/);
  assert.match(app, /state\.operations = operations\.items/);
  assert.match(app, /groups\.operationAttention/);
  assert.match(app, /preparationAttentionSection/);
});

test("owned attention dispatches retain stop controls", () => {
  const { requestOwnsDispatch } = helpers();
  assert.equal(requestOwnsDispatch({ state: "attention", dispatchId: "dispatch-a" }), true);
  assert.equal(requestOwnsDispatch({ state: "attention", dispatchId: null }), false);
  assert.equal(requestOwnsDispatch({ state: "queued", dispatchId: "dispatch-a" }), false);
  assert.match(app, /groups\.attention\.some\(requestOwnsDispatch\)/);
});

test("refreshable product and queue controls have stable focus identities", () => {
  for (const value of ["entry:${entry.entryId}:view", "entry:${entry.entryId}:continue-menu", "request:${request.requestId}:cancel", "request:${request.requestId}:stop", "queue-preview:${request.requestId}"]) {
    assert.ok(app.includes(value), `Missing stable focus key ${value}`);
  }
  assert.match(app, /const focused = rememberFocus\(\);[\s\S]*restoreFocus\(focused\)/);
});

test("preview links require exact product ownership and a separate loopback origin", () => {
  const { state, safePreviewURL } = journalHelpers();
  const id = "a".repeat(32);
  state.data = { project: { stableId: id } };
  const artifact = { kind: "preview", available: true, productId: id, url: "http://127.0.0.1:8765/" };
  assert.equal(safePreviewURL(artifact), artifact.url);
  for (const invalid of [
    { ...artifact, productId: "b".repeat(32) },
    { ...artifact, available: false },
    { ...artifact, url: "http://127.0.0.1:8843/" },
    { ...artifact, url: "https://127.0.0.1:8765/" },
    { ...artifact, url: "http://localhost:8765/" },
  ]) assert.equal(safePreviewURL(invalid), null);
});

test("journal page identity includes source revision and cycle list", () => {
  const { journalPageMatches } = journalHelpers();
  const expected = { entryId: "entry-a", sourceId: "source-a", sourceRevision: 7 };
  assert.equal(journalPageMatches({ ...expected, cycles: [] }, expected), true);
  assert.equal(journalPageMatches({ ...expected, sourceRevision: 8, cycles: [] }, expected), false);
  assert.equal(journalPageMatches({ ...expected, cycles: null }, expected), false);
});

test("limited journal rows load detail within the same source snapshot", () => {
  assert.match(journalApp, /detailStatus === 'limited'/);
  assert.match(journalApp, /scopedJournalPath\(`\/records\/\$\{encodeURIComponent\(cycleId\)\}`\)/);
  assert.match(journalApp, /expected\.token !== state\.detailToken/);
  assert.match(journalApp, /detail\?\.entryId !== expected\.entryId/);
  assert.match(journalApp, /detail\?\.sourceRevision !== expected\.sourceRevision/);
});

test("center markup uses native dialogs and keeps the queue drawer initially off-canvas", () => {
  for (const id of ["newWorkDialog", "continueDialog", "importDialog", "sourceDialog", "settingsDialog", "confirmDialog"]) assert.match(html, new RegExp(`<dialog id="${id}"`));
  assert.match(html, /id="queueDrawer"[^>]+aria-hidden="true"/);
  const css = fs.readFileSync(path.join(dashboard, "center.css"), "utf8");
  assert.match(css, /\.queue-drawer[\s\S]*transform:\s*translateX\(102%\)/);
  assert.match(css, /@media \(max-width: 640px\)/);
});
