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
  const binding = app.lastIndexOf("\n  applyLanguage(); wire(); renderPage(); refresh();");
  assert.ok(binding > 0, "Center event wiring must follow helper declarations");
  vm.runInContext(app.slice(0, binding) + "\n globalThis.center = { state, message, entryState, capability, normalizeCounts, filteredEntries, emptyListState, requestState, statusLabel, write };\n})();", context);
  context.center.state.language = "en";
  return { ...context.center, messages: context.window.CENTER_MESSAGES, context };
}

function journalHelpers() {
  const context = vm.createContext({
    window: {}, location: { pathname: "/products/entry-a", origin: "http://127.0.0.1:8843" },
    document: {}, URL, Intl, Date, Number, Object, Set, Map, String, Math, AbortController, setTimeout, clearTimeout,
  });
  vm.runInContext(fs.readFileSync(path.join(dashboard, "i18n.js"), "utf8"), context);
  const binding = journalApp.indexOf("\n  document.querySelectorAll('[data-tab]')");
  assert.ok(binding > 0, "Journal event wiring must follow helper declarations");
  vm.runInContext(journalApp.slice(0, binding) + "\n globalThis.journal = { state, scope, freshCenterRequest, scopedCenterRuntimeState, scopedRecordedRuntimeState, runtimeStateValue, runtimeStatusLabel, runtimeLabel, requestContextLabel, centerRuntimeContextValue, historyGroups, explorationScope, explorationPageMatches, resetExploration, explorationRequestMatches };\n})();", context);
  context.journal.state.language = "en";
  return context.journal;
}

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

test("entry state preserves unknown and keeps archive separate from execution", () => {
  const { entryState, statusLabel, messages } = helpers();
  assert.equal(entryState({ archived: true, executionSummary: { state: "running" } }), "archived");
  assert.equal(entryState({ executionSummary: { state: "running" } }), "running");
  assert.equal(entryState({ executionSummary: { state: "queued" } }), "queued");
  assert.equal(entryState({ executionSummary: { state: "ended" } }), "ended");
  assert.equal(entryState({ executionSummary: { state: "unknown" } }), "unknown");
  assert.equal(entryState({ availability: { state: "conflict" }, capabilities: { execute: false }, executionSummary: { state: "idle" } }), "unknown");
  assert.equal(entryState({ availability: "read_only", capabilities: { execute: false }, executionSummary: { state: "idle" } }), "read_only");
  assert.equal(entryState({ availability: "available", executionSummary: {} }), "idle");
  assert.equal(statusLabel("future-state"), messages.en.state_unknown);
});

test("capability reasons remain visible independently of the boolean", () => {
  const { capability } = helpers();
  assert.deepEqual({ ...capability({ capabilities: { execute: true } }, "execute") }, { enabled: true, reason: "" });
  assert.deepEqual({ ...capability({ capabilities: { execute: false }, capabilityReasons: { execute: "READ_ONLY_SOURCE" } }, "execute") }, { enabled: false, reason: "READ_ONLY_SOURCE" });
  assert.deepEqual({ ...capability({ capabilities: { execute: { enabled: false, reason: "SOURCE_CONFLICT" } } }, "execute") }, { enabled: false, reason: "SOURCE_CONFLICT" });
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
  assert.equal(runtimeLabel(), "Unknown");
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
  assert.equal(runtimeLabel(), "Unknown");
  assert.equal(centerRuntimeContextValue(state.centerSummary, now), "");
  state.statusFailed = false; state.centerSummary.currentRequest.liveConfirmedAt = new Date(now - 15001).toISOString();
  assert.equal(freshCenterRequest(state.centerSummary, now), null);
  assert.equal(scopedCenterRuntimeState(state.data, state.centerSummary, now), null);
  assert.equal(runtimeStateValue(), "unknown");
  assert.equal(runtimeLabel(), "Unknown");
  assert.equal(centerRuntimeContextValue(state.centerSummary, now), "");
});

test("product detail labels recorded request states without claiming product completion", () => {
  const { state, scopedRecordedRuntimeState, runtimeStateValue, runtimeStatusLabel } = journalHelpers();
  state.statusFailed = false; state.centerSummary = { currentRequest: null };
  const labels = { ended: "Last work ended", canceled: "Work canceled", failed: "Work failed", queued: "Work queued", attention: "Work needs review" };
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
  assert.equal(centerRuntimeContextValue(state.centerSummary, now), "Other work · Starting…: Auto Company · gpt-5.6-luna · high");
  state.centerSummary.currentRequest.state = "stopping";
  assert.equal(centerRuntimeContextValue(state.centerSummary, now), "Other work · Stopping…: Auto Company · gpt-5.6-luna · high");
});

test("linked exploration pages stay separate and match the product source snapshot", () => {
  const { state, historyGroups, explorationScope, explorationPageMatches, resetExploration, explorationRequestMatches } = journalHelpers();
  const product = {
    ok: true, entryId: "entry-a", sourceId: "source-a", sourceRevision: 7, explorationAvailable: true,
    entry: { entryId: "entry-a", sourceId: "source-a", kind: "product" },
    cycles: [{ id: "product-2", identityKind: "product" }, { id: "product-1", identityKind: "product" }],
  };
  const expected = explorationScope(product);
  assert.deepEqual({ ...expected }, { entryId: "entry-a", sourceId: "source-a", sourceRevision: 7, key: '["entry-a","source-a",7]' });
  assert.deepEqual(Array.from(historyGroups(product, product.cycles[0]).main, (cycle) => cycle.id), ["product-1"]);
  assert.equal(historyGroups(product, product.cycles[0]).exploration.length, 0);
  const page = { entryId: "entry-a", sourceId: "source-a", sourceRevision: 7, entry: { entryId: "entry-a", sourceId: "source-a" }, cycles: [{ id: "exp-1", identityKind: "exploration" }] };
  assert.equal(explorationPageMatches(page, expected), true);
  assert.equal(explorationPageMatches({ ...page, sourceId: "source-b" }, expected), false);
  assert.equal(explorationPageMatches({ ...page, sourceRevision: 8 }, expected), false);
  assert.equal(explorationPageMatches({ ...page, cycles: [{ id: "product-1", identityKind: "product" }] }, expected), false);
  state.exploration.key = expected.key; state.exploration.token = 4; state.exploration.loaded = true; state.exploration.cycles = page.cycles;
  state.data = product;
  assert.equal(explorationRequestMatches(4, expected), true);
  resetExploration({ ...expected, key: '["entry-a","source-b",1]' });
  assert.equal(explorationRequestMatches(4, expected), false);
  assert.equal(state.exploration.token, 5);
  assert.equal(state.exploration.loaded, false);
  assert.equal(state.exploration.cycles.length, 0);
});

test("standalone exploration keeps its own cycles in the main journal", () => {
  const { historyGroups, explorationScope } = journalHelpers();
  const data = {
    entryId: "entry-exp", sourceId: "source-exp", sourceRevision: 3, explorationAvailable: true,
    entry: { entryId: "entry-exp", sourceId: "source-exp", kind: "exploration" },
    cycles: [{ id: "exp-2", identityKind: "exploration" }, { id: "exp-1", identityKind: "exploration" }],
  };
  const groups = historyGroups(data, data.cycles[0]);
  assert.deepEqual(Array.from(groups.main, (cycle) => cycle.id), ["exp-1"]);
  assert.equal(groups.exploration.length, 0);
  assert.equal(explorationScope(data), null);
  assert.match(journalApp, /section=exploration&sourceId=\$\{encodeURIComponent\(expected\.sourceId\)\}&limit=100/);
  assert.match(journalApp, /nextBefore/);
  assert.match(journalApp, /state\.exploration\.failed && !retry/);
  assert.match(journalApp, /loadLinkedExploration\(true\)/);
});

test("center actions use the versioned envelope routes and explicit write preconditions", () => {
  for (const route of ["/summary", "/entries?filter=all&sort=activity&limit=100", "/requests?limit=100", "/imports/probe", "/imports/commit", "/explorations", "/queue/order", "/queue/stop-all", "/preferences"]) {
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
  assert.match(journalApp, /fetchCenter\(scopedJournalPath\('\/journal'\)\)/);
  assert.match(journalApp, /fetchScopedText\(id === 'runtime' \? state\.data\.runtimeLogUrl : cycle\?\.logUrl/);
  assert.match(journalApp, /else await fetchJSON\('\/api\/product-media\/capture'/);
  assert.ok(journalApp.includes("else await fetchJSON('/api/product-media/capture'"));
  assert.ok(journalApp.includes("scope.center ? await Promise.all([fetchCenter(scopedJournalPath('/journal')), fetchCenter('/summary')]) : null"));
  assert.match(journalApp, /fetchAllCenterEntries\(\)/);
  assert.match(journalApp, /engine: recordedCycle\?\.engine \|\| 'unknown'/);
  assert.match(journalApp, /reasoning: recordedCycle\?\.observedConfig\?\.reasoning \|\| 'unknown'/);
  assert.match(journalApp, /state\.data\?\.entry\?\.sourceRecordRevision/);
});

test("center markup uses native dialogs and keeps the queue drawer initially off-canvas", () => {
  for (const id of ["newWorkDialog", "continueDialog", "importDialog", "sourceDialog", "settingsDialog", "confirmDialog"]) assert.match(html, new RegExp(`<dialog id="${id}"`));
  assert.match(html, /id="queueDrawer"[^>]+aria-hidden="true"/);
  const css = fs.readFileSync(path.join(dashboard, "center.css"), "utf8");
  assert.match(css, /\.queue-drawer[\s\S]*transform:\s*translateX\(102%\)/);
  assert.match(css, /@media \(max-width: 640px\)/);
});
