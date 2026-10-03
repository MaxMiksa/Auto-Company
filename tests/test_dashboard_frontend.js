// Fast semantic checks for the actual journal helpers. Browser tests exercise
// the real DOM, HTTP routes, controls, escaping and language persistence.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const dashboard = path.resolve(__dirname, "../dashboard");
const html = fs.readFileSync(path.join(dashboard, "index.html"), "utf8");
const app = fs.readFileSync(path.join(dashboard, "app.js"), "utf8");
const i18n = fs.readFileSync(path.join(dashboard, "i18n.js"), "utf8");

function helpers() {
  const fields = new Map(["usagePeriod", "usageDate", "usageDateLabel", "usageRange"].map((id) => [id, {}]));
  const context = vm.createContext({ window: {}, document: {
    getElementById: (id) => { assert.ok(fields.has(id), `Unexpected DOM dependency: ${id}`); return fields.get(id); },
  } });
  vm.runInContext(fs.readFileSync(path.join(dashboard, "icons.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(dashboard, "date-time.js"), "utf8"), context);
  vm.runInContext(i18n, context);
  vm.runInContext(fs.readFileSync(path.join(dashboard, "date-time.js"), "utf8"), context);
  // Expose existing closures before event wiring. There is no simulated DOM,
  // copied application logic, network request or production testing hook.
  const binding = app.indexOf("\n  document.querySelectorAll('[data-tab]').forEach");
  assert.ok(binding > 0, "Journal event wiring must follow its helper declarations");
  vm.runInContext(app.slice(0, binding) + "\n globalThis.journal = { state, message, aggregate, usageGroups, duration, cycleTitle, statusLabel, formatTime, fullTime, filterUsage, reportRows, liveDuration, checkCounts, checkPresentation, progressState, latestCycle, historyGroups, paddedCycleNumber, unavailableArtifact, mediaURL, mediaRetryError, iconPublicationWarning, publishedRefinement, readableLog };\n})();", context);
  context.journal.state.language = "en";
  return { ...context.journal, messages: context.window.JOURNAL_MESSAGES, vocabulary: context.window.DashboardStatus, fields };
}

test("both languages cover rendered keys and preserve interpolation fields", () => {
  const { messages } = helpers();
  assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages["zh-CN"]).sort());
  const placeholders = (value) => [...value.matchAll(/\{([a-zA-Z]+)\}/g)].map((match) => match[1]).sort();
  for (const key of Object.keys(messages.en)) {
    assert.equal(typeof messages.en[key], "string");
    assert.ok(messages.en[key] && messages["zh-CN"][key], `Empty translation: ${key}`);
    assert.deepEqual(placeholders(messages.en[key]), placeholders(messages["zh-CN"][key]), key);
  }
  const keys = [...html.matchAll(/data-i18n="([^"]+)"/g), ...app.matchAll(/message\('([^']+)'/g)];
  for (const [, key] of keys) assert.ok(messages.en[key], `Missing rendered translation: ${key}`);
});

test('usage separates different engines and unknown model identities', () => {
  const { usageGroups, formatTime, fullTime } = helpers();
  const cycles = [{id: 'a', engine: 'codex', model: 'm1'}, {id: 'b', engine: 'codex', model: 'm1'}, {id: 'c', engine: 'other', model: 'm1'}, {id: 'd', engine: 'codex', model: 'unknown'}, {id: 'e', engine: 'codex', model: 'unknown'}];
  const groups = usageGroups(cycles);
  assert.deepEqual(Array.from(groups, group => group.cycles.length), [2, 1, 1, 1]);
  assert.match(formatTime('2020-01-01T12:00:00Z', true), /2020/);
  assert.match(fullTime('2020-01-01T12:00:00Z'), /2020/);
  assert.equal(fullTime('2020-01-01T12:00:00Z'), formatTime('2020-01-01T12:00:00Z', true));
  assert.match(fullTime('2020-01-01T12:00:00Z'), /^2020-01-01 \d{2}:\d{2}$/);
});

test("media links must belong to the exact managed product", () => {
  const { mediaURL } = helpers();
  const id = 'a'.repeat(32);
  const url = `/api/product-media/${id}/${'b'.repeat(64)}.png`;
  assert.equal(mediaURL(url, id), url);
  for (const value of [url.replace(id, 'c'.repeat(32)), 'https://example.com/image.png', 'javascript:alert(1)', `/api/product-media/${id}/../private.svg`, `${url}?path=private`]) assert.equal(mediaURL(value, id), null);
});

test("published refinements require a matching read-only display language", () => {
  const { state, publishedRefinement } = helpers();
  const refinement = {language: 'en', source: 'examples/example'};
  const media = {publishedRefinement: refinement};
  state.data = {readOnly: true};
  assert.equal(publishedRefinement(media), refinement);
  state.language = 'zh-CN';
  assert.equal(publishedRefinement(media), null);
  state.language = 'en'; state.data.readOnly = false;
  assert.equal(publishedRefinement(media), null);
});

test("unconfirmed starts never become completed cycles", () => {
  const { cycleTitle, progressState, messages } = helpers();
  assert.equal(cycleTitle({status: 'startup_unconfirmed'}), messages.en.startup_unconfirmed);
  assert.equal(progressState('startup_unconfirmed'), 'unknown');
  assert.equal(progressState('not_started'), 'pending');
});

test("media retry errors expire after a new success or product change", () => {
  const { state, mediaRetryError } = helpers();
  state.mediaError = {productId: 'a', previousSuccess: 'old'};
  assert.equal(mediaRetryError({productId: 'a', screenshot: {state: 'failed'}}), true);
  assert.equal(mediaRetryError({productId: 'a', screenshot: {state: 'success', latestSuccess: {capturedAt: 'new'}}}), false);
  assert.equal(state.mediaError, null);
  state.mediaError = {productId: 'a', previousSuccess: null};
  assert.equal(mediaRetryError({productId: 'b', screenshot: {state: 'failed'}}), false);
});

test("canonical icon publication failures stay visible independently of source", () => {
  const { iconPublicationWarning } = helpers();
  assert.equal(iconPublicationWarning({source: 'default', publicationStatus: 'published'}), null);
  assert.equal(iconPublicationWarning({source: 'product', publicationStatus: 'existing_valid'}), null);
  assert.equal(iconPublicationWarning({source: 'product', publicationStatus: 'conflict'}), 'iconPublicationConflict');
  assert.equal(iconPublicationWarning({source: 'default', publicationStatus: 'failed'}), 'iconPublicationFailed');
  for (const publicationStatus of ['stale', 'unavailable']) assert.equal(iconPublicationWarning({source: 'product', publicationStatus}), 'iconPublicationChanged');
  assert.equal(iconPublicationWarning({reference: {state: 'preserved'}}), 'iconReferencePreserved');
  for (const state of ['missing', 'unsupported', 'unconfirmed', 'conflict', 'failed']) assert.equal(iconPublicationWarning({reference: {state}}), 'iconReferenceUnconfirmed');
  for (const state of ['inserted', 'linked', 'not_applicable']) assert.equal(iconPublicationWarning({reference: {state}}), null);
});

test("usage totals keep unknown values and coverage separate from measured zero", () => {
  const { aggregate } = helpers();
  const totals = aggregate([
    { usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100 } },
    { usage: { inputTokens: null, outputTokens: null, totalTokens: null } },
    { usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
  ]);
  assert.equal(totals.totalTokens, 100);
  assert.equal(totals.known, 2);
  assert.equal(totals.count, 3);
  assert.equal(totals.partial, true);
  const unknown = aggregate([{ usage: {} }, { usage: { totalTokens: -1 } }]);
  assert.equal(unknown.totalTokens, null);
  assert.equal(unknown.known, 0);
  assert.equal(aggregate([{ usage: { totalTokens: 10, status: "partial" } }]).partial, true);
  assert.equal(aggregate([]).totalTokens, null);
});

test("cycle summaries distinguish active, failed and unknown work without inventing reports", () => {
  const { cycleTitle, messages } = helpers();
  assert.equal(cycleTitle({ status: "running", active: true }), messages.en.runningSummary);
  assert.equal(cycleTitle({ status: "failed" }), messages.en.failedSummary);
  assert.equal(cycleTitle({ status: "interrupted" }), messages.en.interruptedSummary);
  assert.equal(cycleTitle({ status: "unknown" }), messages.en.unknownSummary);
  assert.equal(cycleTitle({ status: "failed", report: '{"private":"raw structure"}' }), messages.en.failedSummary);
  assert.equal(cycleTitle({ summary: "**Verified browser fixture**" }), "Verified browser fixture");
});

test("full report tables retain rows that the summary intentionally abbreviates", () => {
  const { reportRows } = helpers();
  const report = ["| Item | Result |", "| --- | --- |", ...Array.from({ length: 6 }, (_, index) => `| Check ${index + 1} | Passed ${index + 1} |`)].join("\n");
  assert.equal(reportRows({ report }).length, 4);
  const complete = reportRows({ report }, Infinity);
  assert.equal(complete.length, 6);
  assert.equal(complete[5].label, "Check 6");
  assert.equal(complete[5].text, "Passed 6");
});

test("structured task titles preserve meaning while interruption remains a runtime fact", () => {
  const { cycleTitle, statusLabel, messages } = helpers();
  const cycle = { status: "interrupted", events: [{}], summary: "Unrelated legacy sentence",
    workReport: { title: "修复重复键匹配，补齐验证" } };
  assert.equal(cycleTitle(cycle), "修复重复键匹配，补齐验证");
  assert.equal(statusLabel(cycle.status), messages.en.interrupted);
});

test("duration and timestamps never imply a reliable end to interrupted work", () => {
  const { duration, formatTime, messages } = helpers();
  const cycle = { startedAt: "2026-09-18T12:00:00Z", endedAt: "2026-09-18T12:01:30Z", status: "completed" };
  assert.equal(duration(cycle), "1m 30s");
  assert.equal(duration({ ...cycle, durationReliable: false }), "");
  assert.equal(duration({ ...cycle, status: "interrupted" }), "");
  assert.equal(duration({ ...cycle, endedAt: null, status: "running" }), "");
  assert.equal(duration({ ...cycle, endedAt: "2026-09-18T11:59:59Z" }), "");
  assert.equal(formatTime("invalid"), messages.en.unknownTime);
});

test("runtime status labels distinguish unavailable services from unrecorded usage", () => {
  const { state, statusLabel, messages, vocabulary } = helpers();
  const states = ["active", "activating", "configured", "deactivating", "failed", "inactive", "idle", "mismatched", "paused", "waiting_limit", "circuit_break", "not_configured", "not_installed", "reloading", "running", "stopped", "unavailable", "unknown", "unsupported"];
  for (const language of ["en", "zh-CN"]) {
    state.language = language;
    for (const value of states) {
      assert.equal(statusLabel(value), vocabulary.label(value, language) || messages[language][value === "unavailable" ? "statusUnavailable" : value]);
    }
    assert.equal(statusLabel("future_unknown_state"), messages[language].unknown);
    assert.notEqual(statusLabel("unavailable"), messages[language].unavailable);
  }
});

test("day and week usage filters use ledger end dates and exclude active work", () => {
  const { state, filterUsage, fields } = helpers();
  state.data = { cycles: ["2026-09-13", "2026-09-14", "2026-09-18", "2026-09-20", "2026-09-21"].map((date) => ({ startedAt: `${date}T12:00:00Z`, endedAt: `${date}T12:00:30Z` })) };
  state.data.cycles.push({ startedAt: "2026-09-17T23:59:30Z", endedAt: "2026-09-18T00:00:30Z" });
  state.data.cycles.push({ startedAt: "2026-09-20T23:59:30Z", endedAt: "2026-09-21T00:00:30Z" });
  state.data.cycles.push({ startedAt: "2026-09-18T13:00:00Z", endedAt: null, active: true, usage: {} });
  fields.get("usageDate").value = "2026-09-18";
  fields.get("usagePeriod").value = "day";
  assert.equal(filterUsage().length, 2);
  fields.get("usagePeriod").value = "week";
  assert.deepEqual(Array.from(filterUsage(), (cycle) => cycle.endedAt.slice(0, 10)), ["2026-09-14", "2026-09-18", "2026-09-20", "2026-09-18"]);
  assert.equal(fields.get("usageRange").textContent, new Date().getFullYear() === 2026 ? "09-14 – 09-20" : "2026-09-14 – 2026-09-20");
  fields.get("usagePeriod").value = "all";
  assert.equal(filterUsage().length, 7);
  assert.equal(filterUsage().some((cycle) => cycle.active), false);
  assert.equal(fields.get("usageDate").hidden, true);
});


test("live elapsed time advances only with fresh verified runtime identity", () => {
  const { state, liveDuration } = helpers();
  state.statusFailed = false;
  state.receivedAt = 1000;
  state.data = { runtime: { processState: "running", elapsedReliable: true, elapsedSeconds: 60 } };
  const cycle = { active: true, status: "running" };
  assert.equal(liveDuration(cycle, 4000), "Running for 1m 3s");
  assert.equal(liveDuration(cycle, 17000), "Elapsed time unconfirmed");
  assert.equal(liveDuration(cycle, 999), "Elapsed time unconfirmed");
  state.action = "stop";
  assert.equal(liveDuration(cycle, 4000), "Elapsed time unconfirmed");
  state.action = "";
  state.statusFailed = true;
  assert.equal(liveDuration(cycle, 4000), "Elapsed time unconfirmed");
  state.statusFailed = false;
  state.data.runtime.elapsedReliable = false;
  assert.equal(liveDuration(cycle, 4000), "Elapsed time unconfirmed");
});

test("check pass counts require a complete internally consistent machine summary", () => {
  const { checkCounts } = helpers();
  assert.equal(checkCounts({ tests: 12, failures: 2, errors: 1, skipped: 3 }).passed, 6);
  assert.equal(checkCounts({ tests: 0, failures: 0, errors: 0, skipped: 0 }).passed, 0);
  assert.equal(checkCounts({ tests: 12, failures: 0 }).passed, undefined);
  assert.equal(checkCounts({ tests: 1, failures: 2, errors: 0, skipped: 0 }).passed, undefined);
  assert.equal(checkCounts(null).passed, undefined);
});


test("project selection never promotes unrelated or unknown history into current work", () => {
  const { latestCycle } = helpers();
  const old = { id: "old", projectStatus: "other", active: false };
  const unknown = { id: "unknown", projectStatus: "unknown", active: false };
  const current = { id: "current", projectStatus: "current", active: false };
  const project = { id: "projects/current" };
  assert.equal(latestCycle({ project, cycles: [old, unknown], latestProjectCycleId: null }), undefined);
  assert.equal(latestCycle({ project, cycles: [old, unknown, current], latestProjectCycleId: "current" }), current);
  assert.equal(latestCycle({ project: { id: null }, cycles: [unknown], latestProjectCycleId: null }), unknown);
  assert.equal(latestCycle({ cycles: [old] }), old);
});

test("product timelines include exploration alongside product, legacy and unknown records", () => {
  const { historyGroups } = helpers();
  const current = { id: "product-5", identityKind: "product" };
  const product = { id: "product-4", identityKind: "product" };
  const exploration = { id: "explore-3", identityKind: "exploration", status: "failed" };
  const legacy = { id: "legacy", numbering: "legacy", status: "unknown" };
  const grouped = historyGroups({ cycles: [current, product, exploration, legacy] }, current);
  assert.deepEqual(Array.from(grouped.main, (cycle) => cycle.id), ["product-4", "explore-3", "legacy"]);

  const explorationCurrent = { id: "explore-4", identityKind: "exploration" };
  const explorationOnly = historyGroups({ cycles: [explorationCurrent, exploration] }, explorationCurrent);
  assert.deepEqual(Array.from(explorationOnly.main, (cycle) => cycle.id), ["explore-3"]);

  const currentExplorationWithProduct = historyGroups({ cycles: [explorationCurrent, product, exploration] }, explorationCurrent);
  assert.deepEqual(Array.from(currentExplorationWithProduct.main, (cycle) => cycle.id), ["product-4", "explore-3"]);
});


test("compact checks never promote stale, incomplete or failed evidence to success", () => {
  const { checkPresentation } = helpers();
  const check = { state: "completed", evidenceStatus: "completed", exitCode: 0, tests: { tests: 7, failures: 0, errors: 0, skipped: 0 } };
  const show = (changes) => checkPresentation({ latestCheck: { ...check, ...changes } });
  assert.equal(show({}).status, "completed");
  assert.equal(show({}).detail, "7 passed");
  for (const changes of [{ evidenceStatus: "missing" }, { freshness: "stale" }, { tests: null }, { exitCode: null }, { evidenceStatus: "unknown" }]) {
    assert.equal(show(changes).status, "unknown");
  }
  assert.equal(show({ exitCode: 1 }).status, "failed");
  assert.match(show({ exitCode: 1 }).detail, /failed/i);
  assert.equal(show({ tests: { tests: 7, failures: 1, errors: 0, skipped: 0 } }).status, "failed");
  assert.equal(show({ state: "interrupted" }).status, "interrupted");
  assert.equal(show({ tests: { tests: 7, failures: 0, errors: 0, skipped: 7 } }).status, "unknown");
  assert.equal(checkPresentation({}).status, "unknown");
});

test("cycle progress distinguishes execution completion, pauses and unknown states", () => {
  const { progressState } = helpers();
  assert.equal(progressState("completed"), "completed");
  assert.equal(progressState("running"), "running");
  assert.equal(progressState("pending"), "pending");
  for (const status of ["interrupted", "paused", "completed_with_timeout"]) assert.equal(progressState(status), "paused");
  for (const status of ["attention", "blocked", "waiting_limit", "circuit_break"]) assert.equal(progressState(status), "attention");
  assert.equal(progressState("failed"), "failed");
  assert.equal(progressState("unexpected"), "unknown");
  assert.equal(progressState(undefined), "unknown");
});

test("unavailable previews use lifecycle labels while documents keep file evidence labels", () => {
  const { state, unavailableArtifact, messages } = helpers();
  for (const language of ["en", "zh-CN"]) {
    state.language = language;
    for (const [status, label] of [["stopped", "previewEnded"], ["interrupted", "previewInterrupted"], ["running", "previewUnavailable"], ["launch_failed", "previewUnavailable"]]) {
      assert.equal(unavailableArtifact({ kind: "preview", state: status, evidenceStatus: "stale" }), messages[language][label]);
    }
    assert.equal(unavailableArtifact({ kind: "document", evidenceStatus: "stale" }), messages[language].artifactStale);
  }
});

function scopedUsageHarness() {
  const fields = new Map(['usagePeriod', 'usageDate', 'refreshButton', 'refreshStatus', 'autoRefresh', 'connectionError', 'loadingState'].map((id) => [id, {}]));
  fields.get('usagePeriod').value = 'all';
  fields.get('usageDate').value = '2026-10-01';
  const requests = [];
  const renders = [];
  const context = vm.createContext({ window: { scrollY: 0, scrollTo() {} }, location: { pathname: '/products/entry-a' },
    document: { getElementById(id) { assert.ok(fields.has(id), id); return fields.get(id); } },
    clearTimeout() {}, performance: { now: () => 0 }, requestAnimationFrame: (callback) => callback(),
    request: (url) => new Promise((resolve, reject) => requests.push({ url, resolve, reject })),
    recordUsage: (usage) => renders.push(usage),
  });
  vm.runInContext(i18n, context);
  vm.runInContext(fs.readFileSync(path.join(dashboard, "date-time.js"), "utf8"), context);
  const binding = app.indexOf("\n  document.querySelectorAll('[data-tab]').forEach");
  // Keep the real refresh, pagination, usage validation and response guards.
  // Replace only I/O, rendering and the background timer for deterministic races.
  vm.runInContext(app.slice(0, binding) + `
    fetchCenter = globalThis.request;
    render = renderRuntime = refreshCenterContext = scheduleRefresh = connectionNotice = () => {};
    renderUsage = () => globalThis.recordUsage(state.scopedUsage);
    globalThis.journal = { state, refresh, refreshScopedUsage };
  })();`, context);
  const snapshot = { ok: true, entryId: 'entry-a', sourceId: 'source-a', sourceRevision: 1, cycles: [], total: 0, generatedAt: '2026-10-01T00:00:00Z' };
  context.journal.state.data = snapshot;
  const usage = { entryId: 'entry-a', sourceId: 'source-a', sourceRevision: 1, period: 'all', startDate: null, endDate: null, usage: { totalTokens: 42 }, recorded: 1, unknown: 0 };
  return { ...context.journal, fields, requests, renders, snapshot, usage };
}

for (const outcome of ['failure', 'success']) {
  test(`late usage ${outcome} cannot replace a completed journal refresh`, async () => {
    const h = scopedUsageHarness();
    const old = h.refreshScopedUsage();
    const fresh = h.refresh();
    assert.equal(h.requests.length, 3);
    h.requests[1].resolve({ ...h.snapshot, generatedAt: '2026-10-01T00:00:05Z' });
    h.requests[2].resolve({ language: 'en' });
    // Wait for the real journal refresh to request its scoped ledger.
    for (let turn = 0; h.requests.length < 4 && turn < 10; turn++) await Promise.resolve();
    assert.equal(h.requests.length, 4);
    h.requests[3].resolve(h.usage);
    await fresh;
    assert.equal(h.state.statusFailed, false);
    const installed = h.state.scopedUsage;
    assert.equal(installed.data.usage.totalTokens, 42);
    const rendered = h.renders.length;
    if (outcome === 'failure') h.requests[0].reject(new Error('old request failed'));
    else h.requests[0].resolve({ ...h.usage, usage: { totalTokens: 7 } });
    await old;
    assert.equal(h.state.scopedUsage, installed);
    assert.equal(h.renders.length, rendered);
  });
}

test('current usage failure still clears the unavailable scoped ledger', async () => {
  const h = scopedUsageHarness();
  h.state.scopedUsage = { key: 'previous', data: h.usage };
  const pending = h.refreshScopedUsage();
  h.requests[0].reject(new Error('current request failed'));
  await pending;
  assert.equal(h.state.scopedUsage, null);
  assert.equal(h.renders.length, 1);
});

for (const change of ['new request', 'selection']) {
  test(`late usage failure respects a newer ${change}`, async () => {
    const h = scopedUsageHarness();
    const old = h.refreshScopedUsage();
    h.fields.get('usagePeriod').value = 'day';
    const retained = { key: 'newer selection', data: h.usage };
    if (change === 'new request') {
      const current = h.refreshScopedUsage();
      h.requests[1].resolve({ ...h.usage, period: 'day', startDate: '2026-10-01', endDate: '2026-10-01' });
      await current;
    } else h.state.scopedUsage = retained;
    const installed = h.state.scopedUsage;
    const rendered = h.renders.length;
    h.requests[0].reject(new Error('old filter failed'));
    await old;
    assert.equal(h.state.scopedUsage, installed);
    assert.equal(h.renders.length, rendered);
  });
}

function logSourceHarness(center = true) {
  const fields = new Map(['logText', 'copyLogButton', 'refreshLogButton', 'logStatus', 'newLogButton', 'followLog'].map((id) => [id, {}]));
  const reads = [];
  const context = vm.createContext({ window: {}, location: { pathname: center ? '/products/entry-a' : '/journal' },
    document: { getElementById(id) { assert.ok(fields.has(id), id); return fields.get(id); } },
    read: (url) => new Promise((resolve, reject) => reads.push({ url, resolve, reject })),
  });
  vm.runInContext(i18n, context);
  vm.runInContext(fs.readFileSync(path.join(dashboard, "date-time.js"), "utf8"), context);
  const binding = app.indexOf("\n  document.querySelectorAll('[data-tab]').forEach");
  vm.runInContext(app.slice(0, binding) + '\n fetchScopedText = fetchJSON = globalThis.read; globalThis.journal = {state, loadLog};\n})();', context);
  const snapshot = (source, revision = 1, resource = 'log-same-cycle') => ({ entryId: 'entry-a', sourceId: source, sourceRevision: revision,
    cycles: [{ id: 'same-cycle', logUrl: `/api/center/v1/entries/entry-a/resources/${resource}?sourceId=${source}` }] });
  context.journal.state.data = snapshot('source-a');
  context.journal.state.selectedLog = 'same-cycle';
  return { ...context.journal, fields, reads, snapshot };
}

for (const outcome of ['success', 'failure']) {
  test(`source change ignores old log ${outcome} and reads the current source`, async () => {
    const h = logSourceHarness();
    const old = h.loadLog();
    h.state.data = h.snapshot('source-b');
    const current = h.loadLog();
    assert.equal(h.reads.length, 1, 'reads remain serialized');
    if (outcome === 'success') h.reads[0].resolve('SOURCE A');
    else h.reads[0].reject(new Error('A unavailable'));
    await old;
    for (let turn = 0; h.reads.length < 2 && turn < 10; turn++) await Promise.resolve();
    assert.equal(h.reads.length, 2, 'same cycle in B needs its own read');
    assert.match(h.reads[1].url, /sourceId=source-b$/);
    assert.notEqual(h.fields.get('logText').textContent, 'SOURCE A');
    assert.ok(h.state.logPending, 'old cleanup must not remove B pending');
    assert.equal(h.fields.get('copyLogButton').disabled, true);
    h.reads[1].resolve('SOURCE B');
    await current;
    assert.equal(h.fields.get('logText').textContent, 'SOURCE B');
    assert.equal(h.state.logText, 'SOURCE B');
    assert.equal(h.state.logPending, null);
  });
}

for (const change of ['source', 'revision', 'resource']) {
  test(`loaded log cache is not reused after a ${change} change`, async () => {
    const h = logSourceHarness();
    const initial = h.loadLog(); h.reads[0].resolve('SOURCE A'); await initial;
    h.state.data = h.snapshot(change === 'source' ? 'source-b' : 'source-a', change === 'revision' ? 2 : 1, change === 'resource' ? 'log-new-resource' : 'log-same-cycle');
    const pending = h.loadLog();
    assert.equal(h.fields.get('logText').textContent, '');
    h.reads[1].reject(new Error('new context unavailable'));
    await pending;
    assert.equal(h.state.logText, '');
    assert.equal(h.fields.get('logText').textContent, '');
  });
}

test('same log context deduplicates reads and retains its own text on failure', async () => {
  const h = logSourceHarness();
  const first = h.loadLog(); const duplicate = h.loadLog();
  assert.equal(h.reads.length, 1);
  h.reads[0].resolve('CURRENT'); await Promise.all([first, duplicate]);
  h.state.data = h.snapshot('source-a'); // Normal poll replaces the object, not its identity fields.
  const retry = h.loadLog();
  assert.equal(h.fields.get('logText').textContent, 'CURRENT');
  assert.equal(h.fields.get('copyLogButton').disabled, false);
  assert.ok(h.state.logLoadedAt);
  h.reads[1].reject(new Error('current failure')); await retry;
  assert.match(h.fields.get('logStatus').textContent, /Last successful read|最后成功读取/);
  assert.equal(h.state.logText, 'CURRENT');
  assert.equal(h.fields.get('logText').textContent, 'CURRENT');
});

test('source change clears already displayed old text while waiting for the old read', async () => {
  const h = logSourceHarness();
  const initial = h.loadLog(); h.reads[0].resolve('SOURCE A'); await initial;
  const old = h.loadLog();
  h.state.data = h.snapshot('source-b');
  const current = h.loadLog();
  assert.equal(h.fields.get('logText').textContent, '');
  assert.equal(h.state.logText, '');
  assert.equal(h.fields.get('copyLogButton').disabled, true);
  h.reads[1].resolve('OLD A REFRESH'); await old;
  for (let turn = 0; h.reads.length < 3 && turn < 10; turn++) await Promise.resolve();
  assert.equal(h.reads.length, 3);
  h.reads[2].resolve('SOURCE B'); await current;
  assert.equal(h.state.logText, 'SOURCE B');
});

for (const id of ['runtime', 'same-cycle']) {
  test(`standalone ${id} log keeps its existing read and cache behavior`, async () => {
    const h = logSourceHarness(false); h.state.selectedLog = id;
    const first = h.loadLog(); const duplicate = h.loadLog();
    assert.equal(h.reads.length, 1);
    assert.equal(h.reads[0].url, id === 'runtime' ? '/api/log-tail?lines=180' : '/api/journal/log?id=same-cycle');
    h.reads[0].resolve({ available: true, logTail: 'LOCAL', text: 'LOCAL' });
    await Promise.all([first, duplicate]);
    assert.equal(h.state.logText, 'LOCAL');
    const retry = h.loadLog(); h.reads[1].reject(new Error('local failed')); await retry;
    assert.equal(h.state.logText, 'LOCAL');
    assert.equal(h.fields.get('logText').textContent, 'LOCAL');
  });
}


test("cycle labels use authoritative continuous numbers and retain legacy fallback", () => {
  const { paddedCycleNumber } = helpers();
  assert.equal(paddedCycleNumber({ sequenceNumber: 7, number: 4 }), "07");
  assert.equal(paddedCycleNumber({ sequenceNumber: null, number: 4 }), "04");
  assert.equal(paddedCycleNumber({ number: 1 }), "01");
});

test('structured logs read as cycle text, commands and failures without transport JSON', () => {
  const { readableLog } = helpers();
  const events = [
    { type: 'thread.started', thread_id: 'private-id' },
    { type: 'item.started', item: { id: 'cmd', type: 'command_execution', command: 'check products' } },
    { type: 'item.completed', item: { id: 'cmd', type: 'command_execution', command: 'check products', aggregated_output: '2 checks failed', exit_code: 1 } },
    { type: 'item.completed', item: { type: 'agent_message', text: '<script>plain report text</script>' } },
    { type: 'turn.failed', error: { message: 'connection lost' } },
  ];
  const text = readableLog('Reading additional input from stdin...\n' + events.map(event => JSON.stringify(event)).join('\n'), { number: 5, startedAt: '2026-09-27T01:32:16Z' });
  assert.match(text, /#05/);
  assert.equal(text.split('$ check products').length, 2);
  assert.match(text, /2 checks failed/);
  assert.match(text, /Exit code: 1/);
  assert.match(text, /<script>plain report text<\/script>/);
  assert.match(text, /connection lost/);
  assert.doesNotMatch(text, /thread_id|aggregated_output|stdin/);
  assert.equal(readableLog('Cycle #1\nnormal text'), 'Cycle #1\nnormal text');
});
