(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const productMatch = (globalThis.location?.pathname || '/journal').match(/^\/products\/([^/]+)\/?$/);
  const scope = { center: Boolean(productMatch), entryId: productMatch ? decodeURIComponent(productMatch[1]) : null, token: 0, contextToken: 0, entries: [] };
  const state = { data: null, language: 'zh-CN', tab: 'work', expanded: new Set(), selectedLog: scope.center ? '' : 'runtime', logText: '', logLoadedKey: '', logRequest: 0, logPending: null, refreshPending: null, signature: '', statusFailed: true, action: '', languageState: null, languageSaving: false, languageLoading: false, languageRevision: 0, languageError: '', languageSaved: false, timer: null, autoChanged: false, currentCycle: null, receivedAt: 0, elapsedTimer: null, centerSummary: null, scopedUsage: null, usageToken: 0, detailToken: 0, detailLoads: new Map(), mediaIntent: null };
  const message = (key, values = {}) => {
    const dictionary = window.JOURNAL_MESSAGES[state.language] || window.JOURNAL_MESSAGES.en;
    return Object.entries(values).reduce((result, [name, value]) => result.replaceAll(`{${name}}`, String(value)), dictionary[key] || key);
  };
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function clear(node) { node.replaceChildren(); return node; }
  function clean(value) {
    return String(value || '').replace(/!?\[([^\[\]\r\n]*)\]\([^()\r\n]*\)/g, '$1').replace(/^\s*#{1,6}\s+/gm, '').replace(/\*\*|__|`/g, '').replace(/^\s*[-*]\s+/gm, '').trim();
  }
  function shortText(value, length = 86) {
    const text = clean(value).replace(/\s+/g, ' ');
    return text.length > length ? `${text.slice(0, length).trim()}…` : text;
  }
  function statusLabel(status) {
    const shared = window.DashboardStatus.label(status, state.language);
    if (shared) return shared;
    if (['not_started', 'startup_unconfirmed'].includes(status)) return message(status);
    return ['starting', 'stopping', 'stop_failed', 'completed', 'completed_with_timeout', 'failed', 'interrupted', 'stopped_status', 'running', 'blocked', 'idle', 'paused', 'waiting_limit', 'circuit_break', 'stopped', 'active', 'inactive', 'configured', 'not_configured', 'not_installed', 'mismatched', 'activating', 'deactivating', 'reloading', 'unsupported'].includes(status) ? message(status) : status === 'unavailable' ? message('statusUnavailable') : message('unknown');
  }
  function readOnly() { return state.data?.readOnly !== false; }
  function centerModeKey() { return state.data?.entry?.runtimeId ? 'centerManaged' : 'centerArchive'; }
  function liveProcess() { return !readOnly() && !state.statusFailed && state.data?.runtime?.processState === 'running'; }
  function freshCenterRequest(summary = state.centerSummary, currentTime = Date.now()) {
    if (!scope.center || state.statusFailed) return null;
    const request = summary?.currentRequest;
    if (!request?.liveConfirmedAt || !['starting', 'running', 'stopping'].includes(request.state)) return null;
    const confirmationAge = currentTime - Date.parse(request.liveConfirmedAt);
    if (!Number.isFinite(confirmationAge) || confirmationAge < 0 || confirmationAge > 15000) return null;
    return request;
  }
  function centerRequestDisplayState(request, currentTime = Date.now()) {
    if (request?.state !== 'running' || request?.executionBlockedReason !== 'unresolved_p1') return request?.state;
    const blockedAt = Date.parse(request.executionBlockedAt);
    return Number.isFinite(blockedAt) && blockedAt <= currentTime ? 'blocked' : 'unknown';
  }
  function scopedCenterRuntimeState(data = state.data, summary = state.centerSummary, currentTime = Date.now()) {
    const entry = data?.entry; const execution = entry?.executionSummary; const request = freshCenterRequest(summary, currentTime);
    if (!entry?.entryId || !request || request.entryId !== entry.entryId) return null;
    const displayState = centerRequestDisplayState(request, currentTime);
    if (!execution?.requestId || execution.requestId !== request.requestId || execution.state !== displayState) return null;
    if (displayState === 'blocked' && execution.reason !== request.executionBlockedReason) return null;
    return displayState;
  }
  function scopedRecordedRuntimeState(data = state.data) {
    if (!scope.center) return null;
    const execution = data?.entry?.executionSummary;
    if (!execution?.requestId) return null;
    if (execution.state === 'ended' && execution.terminalReason === 'delivery_complete') return 'delivery_complete';
    return ['ended', 'canceled', 'failed', 'queued', 'attention'].includes(execution.state) ? execution.state : null;
  }
  function runtimeStateValue() {
    const centerState = scopedCenterRuntimeState();
    return centerState || scopedRecordedRuntimeState() || (scope.center ? 'unknown' : state.action === 'stop' ? 'stopping' : state.data?.control?.stopUnconfirmed ? (state.data?.control?.action === 'stop' ? 'stopping' : 'stop_failed') : state.statusFailed ? 'unavailable' : state.data?.runtime?.state);
  }
  function runtimeStatusLabel(value) {
    const keys = { blocked: 'workBlocked', ended: 'lastWorkEnded', canceled: 'workCanceled', failed: 'workFailed', queued: 'workQueued', attention: 'workAttention' };
    return keys[value] ? message(keys[value]) : statusLabel(value);
  }
  function runtimeLabel() { return runtimeStatusLabel(runtimeStateValue()); }
  function requestContextLabel(request) {
    const name = request?.displayName || message('unknown');
    const plan = [request?.config?.model, request?.config?.effort].filter(Boolean).join(' · ');
    return plan ? `${name} · ${plan}` : request?.sourceId ? `${name} · …${String(request.sourceId).slice(-8)}` : name;
  }
  function centerRuntimeContextValue(summary = state.centerSummary, currentTime = Date.now()) {
    const active = freshCenterRequest(summary, currentTime);
    if (!active) return '';
    if (active.entryId === scope.entryId) {
      const scopedState = scopedCenterRuntimeState(state.data, summary, currentTime);
      return scopedState ? message('currentWorkState', { state: statusLabel(scopedState) }) : '';
    }
    return message('otherWorkState', { state: statusLabel(centerRequestDisplayState(active, currentTime)), name: requestContextLabel(active) });
  }
  function renderCenterRuntimeContext(summary = state.centerSummary) {
    const value = centerRuntimeContextValue(summary);
    $('centerRuntimeContext').textContent = value;
    $('centerRuntimeContext').title = value;
  }
  function pauseLabel(value) { return message(`pause_${value}`) === `pause_${value}` ? String(value || '') : message(`pause_${value}`); }
  async function fetchJSON(url, options = {}, timeout = 100000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { cache: 'no-store', ...options, signal: controller.signal });
      const result = await response.json();
      if (!response.ok || result.ok === false) throw new Error(result.error || result.output || `HTTP ${response.status}`);
      return result;
    } finally { clearTimeout(timer); }
  }
  async function fetchCenter(path, options = {}, timeout = 100000) {
    const result = await fetchJSON(`/api/center/v1${path}`, options, timeout);
    if (result?.schemaVersion !== 1 || !Object.hasOwn(result, 'data')) throw new Error('Invalid product center response');
    return result.data;
  }
  async function fetchAllCenterEntries() {
    const items = []; let cursor = null; let total = null; const seen = new Set();
    do {
      const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const page = await fetchCenter(`/entries?filter=all&sort=activity&limit=100${suffix}`);
      if (!page || !Array.isArray(page.items)) throw new Error('Invalid product center entries');
      items.push(...page.items); total = page.total; cursor = page.nextCursor || null;
      if (cursor && seen.has(cursor)) throw new Error('Repeated product center cursor');
      if (cursor) seen.add(cursor);
    } while (cursor);
    if (Number.isFinite(total) && items.length !== total) throw new Error('Incomplete product center entries');
    return items;
  }
  function scopedJournalPath(suffix = '') { return `/entries/${encodeURIComponent(scope.entryId)}${suffix}`; }
  function safeScopedResource(value) {
    if (!scope.center || typeof value !== 'string') return null;
    const prefix = `/api/center/v1/entries/${encodeURIComponent(scope.entryId)}/resources/`;
    try { const url = new URL(value, location.origin); return url.origin === location.origin && url.pathname.startsWith(prefix) ? `${url.pathname}${url.search}` : null; }
    catch (_) { return null; }
  }
  function safePreviewURL(artifact, data = state.data) {
    if (!scope.center || artifact?.kind !== 'preview' || artifact.available !== true || typeof artifact.url !== 'string') return null;
    const productId = data?.project?.stableId || data?.entry?.productId;
    if (!productId || artifact.productId !== productId) return null;
    try {
      const url = new URL(artifact.url);
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.origin === location.origin) return null;
      return url.href;
    } catch (_) { return null; }
  }
  function journalPageMatches(page, expected) {
    return Boolean(expected?.entryId && expected?.sourceId && Number.isFinite(expected.sourceRevision)) && page?.entryId === expected.entryId && page?.sourceId === expected.sourceId && page?.sourceRevision === expected.sourceRevision && Array.isArray(page.cycles);
  }
  async function fetchFullScopedJournal() {
    const first = await fetchCenter(`${scopedJournalPath('/journal')}?limit=100`);
    const expected = { entryId: scope.entryId, sourceId: first?.sourceId, sourceRevision: first?.sourceRevision };
    if (!journalPageMatches(first, expected)) throw new Error('Invalid scoped journal page');
    const cycles = [...first.cycles]; const seenCursors = new Set(); const seenCycles = new Set(cycles.map((cycle) => cycle.id));
    let cursor = first.nextBefore;
    while (cursor) {
      if (seenCursors.has(cursor)) throw new Error('Repeated journal cursor');
      seenCursors.add(cursor);
      const page = await fetchCenter(`${scopedJournalPath('/journal')}?limit=100&before=${encodeURIComponent(cursor)}&sourceId=${encodeURIComponent(expected.sourceId)}`);
      if (!journalPageMatches(page, expected)) throw new Error('Journal source changed');
      for (const cycle of page.cycles) {
        if (seenCycles.has(cycle.id)) throw new Error('Repeated journal cycle');
        seenCycles.add(cycle.id); cycles.push(cycle);
      }
      cursor = page.nextBefore;
    }
    if (Number.isFinite(first.total) && cycles.length !== first.total) throw new Error('Incomplete journal history');
    return { ...first, cycles, nextBefore: null };
  }
  function usageSelection() {
    const period = $('usagePeriod').value;
    return { period, date: period === 'all' ? '' : $('usageDate').value };
  }
  function usageKey(selection, data = state.data) { return JSON.stringify([data?.entryId, data?.sourceId, data?.sourceRevision, selection.period, selection.date]); }
  function expectedUsageRange(selection) {
    if (selection.period === 'all') return { startDate: null, endDate: null };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(selection.date)) return null;
    if (selection.period === 'day') return { startDate: selection.date, endDate: selection.date };
    if (selection.period !== 'week') return null;
    const start = new Date(`${selection.date}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
    const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
    return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
  }
  async function fetchScopedUsage(selection, data) {
    const expectedRange = expectedUsageRange(selection);
    if (!expectedRange) throw new Error('Invalid usage selection');
    const date = selection.date ? `&date=${encodeURIComponent(selection.date)}` : '';
    const result = await fetchCenter(`${scopedJournalPath('/usage')}?period=${encodeURIComponent(selection.period)}${date}&sourceId=${encodeURIComponent(data.sourceId)}`);
    if (result?.entryId !== data.entryId || result?.sourceId !== data.sourceId || result?.sourceRevision !== data.sourceRevision || result?.period !== selection.period || result?.startDate !== expectedRange.startDate || result?.endDate !== expectedRange.endDate) throw new Error('Out-of-scope usage response');
    return { key: usageKey(selection, data), data: result };
  }
  async function refreshScopedUsage() {
    if (!scope.center || !state.data) return;
    const token = ++state.usageToken; const data = state.data; const selection = usageSelection();
    try {
      const usage = await fetchScopedUsage(selection, data);
      if (token !== state.usageToken || data !== state.data || usage.key !== usageKey(usageSelection(), state.data)) return;
      state.scopedUsage = usage; renderUsage();
    } catch (_) {
      if (token === state.usageToken && data === state.data && usageKey(selection, data) === usageKey(usageSelection(), state.data)) { state.scopedUsage = null; renderUsage(); }
    }
  }
  async function fetchScopedText(value, timeout = 15000) {
    const url = safeScopedResource(value);
    if (!url) throw new Error('Invalid scoped resource');
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout);
    try { const response = await fetch(url, { cache: 'no-store', signal: controller.signal }); if (!response.ok) throw new Error(`HTTP ${response.status}`); return await response.text(); }
    finally { clearTimeout(timer); }
  }
  function formatTime(value, withDate = false) {
    if (!value || !Number.isFinite(Date.parse(value))) return message('unknownTime');
    const date = new Date(value);
    return new Intl.DateTimeFormat(state.language, { ...(withDate ? { month: '2-digit', day: '2-digit' } : {}), hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  }
  function formatDate(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return message('unknownTime');
    return new Intl.DateTimeFormat(state.language, { month: 'long', day: 'numeric' }).format(new Date(value));
  }
  function datePart(value) { return /^\d{4}-\d{2}-\d{2}/.test(value || '') ? value.slice(0, 10) : ''; }
  function localDatePart(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function knownNumber(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
  function number(value) { return knownNumber(value) ? new Intl.NumberFormat(state.language).format(value) : '—'; }
  function compactNumber(value) { return knownNumber(value) ? new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value) : message('unknown'); }
  function duration(cycle) {
    if (cycle.durationReliable === false || cycle.status === 'interrupted') return '';
    const seconds = Math.round((Date.parse(cycle.endedAt) - Date.parse(cycle.startedAt)) / 1000);
    if (!Number.isFinite(seconds) || seconds < 0) return '';
    return seconds < 60 ? message('seconds', { seconds }) : message('minutes', { minutes: Math.floor(seconds / 60), seconds: seconds % 60 });
  }
  function liveDuration(cycle, now = performance.now()) {
    const runtime = state.data?.runtime;
    const age = now - state.receivedAt;
    if (!cycle.active || cycle.status !== 'running' || state.statusFailed || state.action === 'stop' || state.data?.control?.stopUnconfirmed || runtime?.processState !== 'running' || (runtime?.currentCycleId && runtime.currentCycleId !== cycle.id) || runtime?.elapsedReliable !== true || !knownNumber(runtime.elapsedSeconds) || !Number.isFinite(age) || age < 0 || age > 15000) return message('elapsedUnconfirmed');
    const seconds = Math.floor(runtime.elapsedSeconds + age / 1000);
    return message('runningElapsed', { time: seconds < 60 ? message('seconds', { seconds }) : message('minutes', { minutes: Math.floor(seconds / 60), seconds: seconds % 60 }) });
  }
  function updateElapsed() {
    document.querySelectorAll('.live-elapsed').forEach((node) => { if (node.dataset.cycleId === state.currentCycle?.id) node.textContent = liveDuration(state.currentCycle); });
    if (scope.center) renderCenterLiveState();
  }
  function cycleTitle(cycle) {
    if (cycle.workReport) return cycle.workReport.title;
    if (['not_started', 'startup_unconfirmed'].includes(cycle.status)) return statusLabel(cycle.status);
    if (cycle.status === 'interrupted' && cycle.events?.length) return message('interruptedSummary');
    if (cycle.synthetic && cycle.status !== 'running') return statusLabel(cycle.status);
    let title = clean(cycle.summary || cycle.report || '').split('\n').find((line) => line.trim()) || '';
    if (/^[\[{]/.test(title)) title = '';
    title = title.replace(/^Cycle\s*\d+\s*(?:完成)?\s*[:：·—-]?\s*/i, '').replace(/^[，,：:\s]+/, '');
    const firstClause = title.split(/[，,。\n]/)[0];
    title = firstClause && firstClause.length >= 7 ? firstClause : title;
    if (!title) return message(cycle.active ? 'runningSummary' : cycle.status === 'failed' ? 'failedSummary' : cycle.status === 'interrupted' ? 'interruptedSummary' : cycle.status === 'unknown' ? 'unknownSummary' : 'finishedSummary');
    return shortText(title, 68);
  }
  function metadata(cycle) {
    const row = element('div', 'cycle-meta');
    if (cycle.numbering === 'legacy') row.append(element('span', '', message('legacyCycles')));
    if (cycle.identityKind === 'exploration') row.append(element('span', '', message('explorationCycles')));
    if (cycle.workReport?.phase) row.append(element('span', 'reported-phase', message(`workPhase_${cycle.workReport.phase}`)));
    if (['failed', 'interrupted', 'unknown', 'completed_with_timeout'].includes(cycle.status)) row.append(element('span', cycle.status === 'failed' ? 'status-failed' : '', statusLabel(cycle.status)));
    row.append(element('span', '', message(cycle.reservedAt && !cycle.startedAt ? 'reservedAt' : 'startAt', { time: formatTime(cycle.startedAt || cycle.reservedAt) })));
    const elapsed = duration(cycle);
    if (elapsed) row.append(element('span', '', elapsed));
    if (cycle.active && cycle.status === 'running') {
      const live = element('span', 'live-elapsed'); live.dataset.cycleId = cycle.id;
      live.textContent = liveDuration(cycle); row.append(live);
    }
    if ((!cycle.active && cycle.durationReliable === false) || cycle.status === 'interrupted') { row.title = message('recoveredEnd'); row.append(element('span', '', message('durationUnknown'))); }
    return row;
  }
  function bindDisclosure(details, key) {
    details.dataset.disclosureKey = key;
    details.open = state.expanded.has(key);
    details.addEventListener('toggle', () => {
      if (details.open) state.expanded.add(key);
      else state.expanded.delete(key);
    });
    return details;
  }
  function paddedCycleNumber(cycle) { return String(cycle.sequenceNumber ?? cycle.number ?? '—').padStart(2, '0'); }
  function historyGroups(data, current) {
    const cycles = Array.isArray(data?.cycles) ? data.cycles : [];
    return { main: cycles.filter((cycle) => cycle.id !== current?.id) };
  }
  function logCycles() { return state.data?.cycles || []; }
  function logButton(cycle) {
    if (cycle.synthetic) {
      const button = element('button', 'text-button cycle-log-link', message('viewRuntimeLog'));
      button.type = 'button';
      button.addEventListener('click', () => { state.selectedLog = 'runtime'; $('logSelect').value = 'runtime'; selectTab('logs', true); loadLog(); });
      return button;
    }
    if (!cycle.logAvailable) return element('p', 'sidebar-note cycle-log-link', message('noLog'));
    const button = element('button', 'text-button cycle-log-link', message('viewLog'));
    button.type = 'button';
    button.dataset.focusKey = `log:${cycle.id}`;
    button.addEventListener('click', () => {
      state.selectedLog = cycle.id;
      $('logSelect').value = cycle.id;
      selectTab('logs', true);
      loadLog();
    });
    return button;
  }
  function reportRows(cycle, limit = 4) {
    const rows = [];
    for (const line of String(cycle.report || '').split('\n')) {
      if (!line.trim().startsWith('|')) continue;
      const parts = line.trim().split('|').slice(1, -1).map(clean);
      if (parts.length < 2 || parts.every((part) => /^[-: ]+$/.test(part)) || /^(项目|item|aspect|category)$/i.test(parts[0])) continue;
      if (parts[0] && parts[1]) rows.push({ label: parts[0], text: parts.slice(1).join(' · ') });
    }
    return rows.slice(0, limit);
  }
  function resultList(rows) {
    const list = element('ul', 'result-list');
    for (const row of rows) {
      const item = element('li', 'result-item');
      item.append(element('span', 'result-label', row.label), element('p', 'result-text', row.text));
      list.append(item);
    }
    return list;
  }
  function checkCounts(tests) {
    if (!tests) return {};
    const result = { ...tests };
    const keys = ['tests', 'failures', 'errors', 'skipped'];
    if (keys.every((key) => Number.isInteger(tests[key]) && tests[key] >= 0) && tests.failures + tests.errors + tests.skipped <= tests.tests) result.passed = tests.tests - tests.failures - tests.errors - tests.skipped;
    return result;
  }
  function progressState(status) {
    if (status === 'completed') return 'completed';
    if (status === 'running') return 'running';
    if (['paused', 'waiting_limit', 'circuit_break', 'interrupted', 'completed_with_timeout', 'stopped'].includes(status)) return 'paused';
    if (status === 'failed') return 'failed';
    if (['pending', 'not_started'].includes(status)) return 'pending';
    return 'unknown';
  }
  function progressIcon(status, label = statusLabel(status)) {
    const state = progressState(status);
    const node = element('span', `progress-node progress-${state}`);
    if (state === 'pending') label = message('pendingCycle');
    node.setAttribute('role', 'img'); node.setAttribute('aria-label', label); node.title = label;
    node.append(window.DashboardIcons.status(state));
    return node;
  }
  function checkPresentation(cycle) {
    const check = cycle.latestCheck;
    if (!check) return { status: 'unknown', detail: message(cycle.checkStatus === 'invalid' ? 'check_invalid' : 'noRegisteredCheck') };
    const stale = cycle.checkStatus === 'stale' || check.freshness === 'stale' || ['changed', 'missing', 'stale'].includes(check.evidenceStatus);
    if (stale) return { status: 'unknown', detail: message('check_stale') };
    const status = cycle.checkStatus || check.state;
    if (status === 'running') return { status, detail: message('check_running') };
    if (status === 'interrupted') return { status, detail: message('check_interrupted') };
    if (status === 'invalid') return { status: 'unknown', detail: message('check_invalid') };
    const counts = checkCounts(check.tests);
    const valid = Number.isInteger(counts.passed);
    const failed = check.exitCode > 0 || counts.failures > 0 || counts.errors > 0;
    const completed = check.evidenceStatus === 'completed' && status === 'completed';
    const result = completed && failed ? 'failed' : completed && check.exitCode === 0 && valid && counts.passed > 0 ? 'completed' : 'unknown';
    const parts = [];
    if (valid && completed) {
      for (const [key, label] of [['passed', 'countPassed'], ['failures', 'countFailed'], ['errors', 'countErrors'], ['skipped', 'countSkipped']]) {
        if (counts[key] > 0 || key === 'passed') parts.push(message(label, { count: number(counts[key]) }));
      }
    }
    if (result === 'failed' && !(counts.failures > 0 || counts.errors > 0)) parts.push(message('checkFailedRun'));
    if (!valid) parts.push(message('checkCountsUnknown'));
    else if (!completed || result === 'unknown') parts.push(message('checkUnconfirmed'));
    return { status: result, detail: parts.join(' · ') };
  }
  function cycleRecords(cycle) {
    const section = element('section', 'cycle-records');
    section.append(element('h3', 'content-heading', message('cycleRecords')));
    if (cycle.projectStatus === 'other' || cycle.projectStatus === 'unknown') {
      section.append(element('p', 'sidebar-note', message(cycle.projectStatus === 'other' ? 'otherProjectCycle' : 'unknownProjectCycle')));
      return section;
    }
    const rows = [];
    const check = cycle.latestCheck;
    const presentation = checkPresentation(cycle);
    rows.push({ kind: 'check', title: message('latestCheckRecord'), status: presentation.status, detail: presentation.detail,
      time: check?.endedAt || check?.recordedAt || check?.startedAt,
      path: check?.available === true && !scope.center ? check.path : null,
      url: check?.available === true && scope.center ? safeScopedResource(check.url) : null });
    for (const artifact of cycle.artifacts || []) {
      if (artifact.kind !== 'document') continue;
      rows.push({ kind: 'document', time: artifact.recordedAt, title: message(artifact.available === true ? 'documentRecorded' : 'documentUnavailable'),
        detail: artifact.displayLabel || String(artifact.path || artifact.label || '').split(/[\\/]/).pop(), url: scope.center ? safeScopedResource(artifact.url) : null });
    }
    if (cycle.workReport && cycle.workReportStatus === 'valid') rows.push({ kind: 'report', time: cycle.workReport.recorded_at, title: message('workRecorded') });
    // Missing timestamps remain unknown, rather than borrowing a cycle or consensus time.
    rows.sort((a, b) => (Date.parse(a.time) || Infinity) - (Date.parse(b.time) || Infinity));
    const list = element('ol', 'record-list');
    for (const record of rows) {
      const row = element('li', `record-row record-${record.kind}`);
      const time = element('time', '', record.time ? formatTime(record.time) : '—');
      if (record.time) { time.dateTime = record.time; time.title = formatTime(record.time, true); }
      const body = element('div', 'record-body');
      const title = element('div', 'record-title', record.title);
      if (record.status) title.append(progressIcon(record.status, record.detail));
      body.append(title);
      if (record.detail || record.path || record.url) {
        const detail = element('div', `record-detail${record.status === 'failed' ? ' status-failed' : ''}`);
        if (record.detail) detail.append(element('span', 'record-counts', record.detail));
        if (record.path || record.url) {
          const link = element('a', 'check-report', message(record.kind === 'document' ? 'document' : 'checkReport'));
          link.href = record.url || `/api/journal/document?path=${encodeURIComponent(record.path)}`; link.target = '_blank'; link.rel = 'noopener';
          link.append(icon('external-link')); detail.append(link);
        }
        body.append(detail);
      }
      row.append(time, body); list.append(row);
    }
    section.append(list);
    return section;
  }
  function workReportDetails(cycle) {
    const work = cycle.workReport;
    if (!work && !['invalid', 'missing'].includes(cycle.workReportStatus)) return null;
    const section = element('div', 'work-report-details');
    if (!work) {
      section.append(element('p', 'sidebar-note', message(cycle.workReportStatus === 'invalid' ? 'invalidWorkReport' : 'missingWorkReport')));
      return section;
    }
    if (work.blocker) section.append(element('p', 'work-blocker', `${message('workBlocker')}：${work.blocker}`));
    if (!cycle.active && !work.final) section.append(element('p', 'sidebar-note', message('unfinishedWorkReport')));
    return section;
  }
  function renderCurrent(cycle) {
    const container = clear($('currentCycle'));
    if (!cycle) {
      const empty = element('div', 'empty-state');
      empty.append(element('h2', '', message('noCycles')), element('p', '', message(readOnly() ? 'noCyclesBody' : 'noCyclesLive')));
      container.append(empty);
      return;
    }
    const article = element('article', 'current-cycle');
    article.setAttribute('aria-current', 'step');
    article.setAttribute('aria-labelledby', 'cycleTitle');
    const gutter = element('div', 'cycle-gutter');
    const cycleNumber = element('span', 'cycle-number', paddedCycleNumber(cycle));
    cycleNumber.id = 'cycleNumber';
    gutter.append(cycleNumber);
    const body = element('div', 'cycle-body');
    const title = element('h2', 'cycle-title', cycleTitle(cycle));
    title.id = 'cycleTitle';
    body.append(title, metadata(cycle));
    const report = element('section', 'report-section');
    const heading = element('div', 'section-heading-row');
    heading.append(element('h3', '', message('latestReport')));
    const timestamp = cycle.workReport?.recorded_at || cycle.reportObservedAt || (cycle.durationReliable !== false && cycle.endedAtKind !== 'recovered' && cycle.status !== 'interrupted' ? cycle.endedAt : null);
    if (timestamp) {
      const time = element('time', '', message('recordedAt', { time: formatTime(timestamp) }));
      time.dateTime = timestamp;
      heading.append(time);
    }
    const liveReport = cycle.active ? [...(cycle.events || [])].reverse().find((event) => event.kind === 'report') : null;
    let intro = cycle.workReport?.summary || clean(cycle.summary || liveReport?.text || '');
    if (/^[\[{]/.test(intro)) intro = cycleTitle(cycle);
    if (!intro) intro = message(cycle.active ? 'runningNoReport' : 'noReport');
    report.append(heading, element('p', 'report-intro', intro));
    const workDetails = workReportDetails(cycle);
    if (workDetails) report.append(workDetails);
    body.append(report);
    body.append(cycleRecords(cycle));
    const rows = cycle.workReport ? [] : reportRows(cycle);
    if (rows.length) {
      const results = element('section', 'results-section');
      const resultHeading = element('div', 'section-heading-row');
      resultHeading.append(element('h3', '', message('cycleResults')));
      results.append(resultHeading, resultList(rows));
      body.append(results);
    }
    if (cycle.report && !cycle.workReport) body.append(element('p', 'report-source', message('reportSource')));
    body.append(logButton(cycle));
    article.append(gutter, progressIcon(cycle.status), body);
    container.append(article);
  }
  function historyRow(cycle) {
    const row = bindDisclosure(element('details', 'history-row'), `cycle:${cycle.id}`);
    row.dataset.cycleId = cycle.id;
    const summary = element('summary');
    const association = cycle.projectStatus === 'other' ? message('otherProjectCycle') : cycle.projectStatus === 'unknown' ? message('unknownProjectCycle') : cycle.identityKind === 'exploration' ? message('explorationCycles') : '';
    const timing = `${statusLabel(cycle.status)} · ${formatTime(cycle.startedAt)}${association ? ` · ${association}` : ''}`;
    const cycleNumber = paddedCycleNumber(cycle);
    summary.append(element('span', 'history-number', cycleNumber), progressIcon(cycle.status), element('span', 'history-title', cycleTitle(cycle)), element('span', `history-meta${cycle.status === 'failed' ? ' status-failed' : ''}`, timing));
    const arrow = icon('chevron-right'); arrow.classList.add('history-chevron');
    arrow.setAttribute('aria-hidden', 'true');
    summary.append(arrow);
    const content = element('div', 'history-content');
    content.append(metadata(cycle));
    let report = cycle.workReport?.summary || clean(cycle.summary || '');
    if (/^[\[{]/.test(report)) report = cycleTitle(cycle);
    content.append(element('p', '', report || message('noSummary')));
    const workDetails = workReportDetails(cycle);
    if (workDetails) content.append(workDetails);
    const results = cycle.workReport ? [] : reportRows(cycle);
    if (results.length) content.append(resultList(results));
    content.append(cycleRecords(cycle));
    content.append(logButton(cycle));
    row.append(summary, content);
    if (scope.center && cycle.detailStatus === 'limited') row.addEventListener('toggle', () => { if (row.open) loadCycleDetail(cycle.id); });
    return row;
  }
  async function loadCycleDetail(cycleId) {
    if (!scope.center || !state.data || state.detailLoads.has(cycleId)) return;
    const expected = { token: state.detailToken, entryId: state.data.entryId, sourceId: state.data.sourceId, sourceRevision: state.data.sourceRevision };
    const collection = state.data.cycles;
    const index = collection.findIndex((cycle) => cycle.id === cycleId && cycle.detailStatus === 'limited');
    if (!collection || index < 0) return;
    const limited = collection[index];
    const promise = (async () => {
      try {
        const detail = await fetchCenter(`${scopedJournalPath(`/records/${encodeURIComponent(cycleId)}`)}?sourceId=${encodeURIComponent(expected.sourceId)}`);
        if (expected.token !== state.detailToken || state.data?.entryId !== expected.entryId || state.data?.sourceId !== expected.sourceId || state.data?.sourceRevision !== expected.sourceRevision || detail?.entryId !== expected.entryId || detail?.sourceId !== expected.sourceId || detail?.sourceRevision !== expected.sourceRevision || detail?.id !== cycleId || detail.detailStatus !== 'recorded') return;
        const currentIndex = collection.findIndex((cycle) => cycle.id === cycleId && cycle.detailStatus === 'limited');
        if (currentIndex < 0) return;
        collection[currentIndex] = { ...limited, ...detail };
        renderHistory();
      } catch (_) { /* The limited row remains retryable on its next open. */ }
      finally { state.detailLoads.delete(cycleId); }
    })();
    state.detailLoads.set(cycleId, promise);
    return promise;
  }
  function renderHistory() {
    const history = clear($('historyList'));
    const groups = historyGroups(state.data, state.currentCycle);
    const older = groups.main;
    older.sort((a, b) => Number(a.numbering === 'legacy') - Number(b.numbering === 'legacy'));
    const visible = older;
    $('historyNote').textContent = message(state.data.cycleNumbering?.mode === 'persistent' ? (state.data.cycleNumbering.hasLegacy || state.data.cycleNumbering.hasUnsequenced ? 'mixedHistoryNote' : 'persistentHistoryNote') : state.data.cycleNumbering?.mode === 'unavailable' ? 'numberingUnavailable' : 'historyNote');
    let group = null;
    for (const cycle of visible) {
      const nextGroup = cycle.numbering === 'legacy' ? 'legacy' : 'persistent';
      if (nextGroup !== group && nextGroup === 'legacy' && state.data.cycleNumbering?.mode === 'persistent') history.append(element('h3', 'history-group-label', message('legacyCycles')));
      group = nextGroup;
      history.append(historyRow(cycle));
    }
    document.querySelector('.history-section').hidden = !older.length;
    document.querySelector('.journal-layout').classList.toggle('no-history', !older.length);
  }
  function aggregate(cycles) {
    const result = { inputTokens: null, outputTokens: null, totalTokens: null, known: 0, count: cycles.length, partial: false };
    for (const key of ['inputTokens', 'outputTokens', 'totalTokens']) {
      const values = cycles.map((cycle) => cycle.usage?.[key]).filter(knownNumber);
      result[key] = values.length ? values.reduce((sum, value) => sum + value, 0) : null;
    }
    result.known = cycles.filter((cycle) => knownNumber(cycle.usage?.totalTokens)).length;
    result.partial = result.known < cycles.length || cycles.some((cycle) => cycle.usage?.status === 'partial');
    return result;
  }
  function icon(name) { return window.DashboardIcons.icon(name); }
  function iconLabel(node, name, text) {
    node.replaceChildren(icon(name), element('span', '', text));
    return node;
  }
  function runtimeRows(entries) {
    const list = element('dl', 'runtime-details');
    for (const [label, value] of entries) list.append(element('dt', '', label), element('dd', '', !value || value === 'unknown' ? message('unknown') : value));
    return list;
  }
  function languageLabel(value) { return value === 'zh-CN' || value === 'zh' ? message('languageChinese') : value === 'en' ? message('languageEnglish') : value || message('unknown'); }
  function actionMessage(key, values = {}, error = false) {
    const node = $('actionStatus');
    node.hidden = false;
    node.textContent = message(key, values);
    node.classList.toggle('status-failed', error);
  }
  function renderRuntime() {
    const data = state.data;
    const runtime = data?.runtime || {};
    const unavailable = scope.center ? false : state.statusFailed || runtime.available === false;
    const process = runtime.processState || runtime.state;
    const action = state.action || data?.control?.action;
    const retryStop = data?.control?.stopUnconfirmed === true;
    const locked = !data || readOnly() || (unavailable && !retryStop) || Boolean(action || state.mediaAction);
    renderRuntimeState();
    $('startButton').disabled = locked || retryStop || !['stopped', 'inactive'].includes(process);
    $('stopButton').disabled = locked || (!retryStop && process !== 'running');
    iconLabel($('startButton'), 'play', message(action === 'start' ? 'starting' : 'start'));
    iconLabel($('stopButton'), 'square', message(action === 'stop' ? 'stopping' : 'stop'));
    $('startButton').title = $('stopButton').title = readOnly() ? message('readOnly') : unavailable ? message('statusUnavailable') : '';
    $('startButton').hidden = scope.center || readOnly();
    $('stopButton').hidden = scope.center || readOnly();
    $('refreshButton').disabled = Boolean(state.refreshPending || state.action);
    $('modeNote').textContent = data ? message(scope.center ? centerModeKey() : readOnly() ? 'preview' : 'live') : '';
    $('autoRefresh').disabled = Boolean(data && readOnly() && !scope.center);
    document.querySelectorAll('.legacy-link').forEach((node) => { node.hidden = scope.center || data?.legacyAvailable !== true; });
    document.querySelectorAll('.dialog-links a[href^="/docs/"]').forEach((node) => { node.hidden = readOnly(); });
    const reason = runtime.pauseReason || data?.budgetPause?.reason;
    const paused = ['paused', 'waiting_limit', 'circuit_break'].includes(runtime.state);
    $('runtimeNotice').hidden = unavailable || (!reason && !paused && !data?.budgetPause);
    $('runtimeNotice').textContent = reason ? message('pauseReason', { reason: pauseLabel(reason) }) : paused ? message('pauseReview') : data?.budgetPause ? message('budgetPause') : '';
    updateElapsed();
    renderDiagnostics();
  }
  function renderRuntimeState() {
    const runtime = state.data?.runtime || {};
    const displayedState = runtimeStateValue();
    const unavailable = !scope.center && (state.statusFailed || runtime.available === false);
    const node = $('runtimeState');
    node.textContent = readOnly() && state.data?.status === null ? message('historicalRecord') : runtimeStatusLabel(displayedState);
    if (node.dataset) node.dataset.state = unavailable ? 'unavailable' : displayedState;
  }
  function renderCenterLiveState() {
    renderRuntimeState();
    renderCenterRuntimeContext(state.centerSummary);
  }
  function renderDiagnostics() {
    const data = state.data;
    const runtime = data?.runtime || {};
    const status = data?.status || {};
    const parsed = status.parsed || {};
    const fields = status.stateFile || {};
    const loop = parsed.loop || {};
    const entries = [[message('state'), runtimeLabel()], [message('processState'), statusLabel(state.statusFailed ? 'unavailable' : runtime.processState)], ['PID', String(runtime.pid ?? '—')], [message('currentCycle'), String(runtime.currentCycleNumber ?? '—')], [message('errorCount'), String(runtime.errorCount ?? loop.errorCount ?? fields.ERROR_COUNT ?? '—')], [message('lastRun'), formatTime(runtime.lastRun || loop.lastRun || fields.LAST_RUN, true)], [message('pauseReasonLabel'), pauseLabel(runtime.pauseReason || data?.budgetPause?.reason || fields.PAUSE_REASON) || '—']];
    for (const [name, value] of [['guardian', parsed.guardian], ['daemon', parsed.daemon], ['autostart', parsed.autostart]]) {
      entries.push([message(name), statusLabel(value?.state)]);
      const details = Object.entries(value || {}).filter(([key]) => key !== 'state' && value[key] !== null && value[key] !== '').map(([key, item]) => `${key}: ${String(item)}`).join(' · ');
      if (details) entries.push([message(`${name}Details`), details]);
    }
    if (loop.daemonSummary) entries.push([message('daemonDetails'), String(loop.daemonSummary)]);
    const summary = clear($('diagnosticSummary'));
    if (state.statusFailed && data) summary.append(element('p', 'fine-print', message('diagnosticsStale')));
    summary.append(runtimeRows(entries));
    if (data?.budgetPause) summary.append(element('p', 'fine-print', `${message('budgetPause')}: ${JSON.stringify(data.budgetPause)}`));
    $('rawText').textContent = status.raw || runtime.error || message('noDiagnostics');
    if (state.statusFailed && status.raw) $('rawText').textContent = `${message('diagnosticsStale')}\n\n${status.raw}`;
  }
  function renderLanguage() {
    const current = state.languageState;
    const next = current?.nextLanguage || current?.language || state.language;
    const productLanguage = scope.center && current?.productLanguageStatus === 'unknown' ? null : current?.productLanguage || current?.language || state.data?.runtime?.language;
    $('settingsLanguage').textContent = languageLabel(productLanguage);
    $('settingsMode').textContent = message(scope.center ? centerModeKey() : readOnly() ? 'preview' : 'live');
    $('settingsDescription').textContent = message(scope.center ? centerModeKey() : readOnly() ? 'settingsDescription' : 'settingsLive');
    $('languageSelect').value = next;
    $('languageSelect').disabled = scope.center || readOnly() || state.languageSaving || state.languageLoading || !current;
    $('languageHint').textContent = message(readOnly() ? 'languageExplanation' : current?.locked ? 'languageLocked' : 'languageUnlocked', { current: languageLabel(current?.language), next: languageLabel(next) });
    $('languageStatus').textContent = state.languageSaving ? message('languageSaving') : state.languageLoading ? message('languageLoading') : state.languageError ? message(state.languageError) : current?.pending ? message('languagePending') : state.languageSaved ? message('languageSaved') : '';
    $('languageStatus').classList.toggle('status-failed', Boolean(state.languageError));
  }
  function applyLanguageState(value) {
    if (!value || !['en', 'zh-CN'].includes(value.language) || (value.nextLanguage && !['en', 'zh-CN'].includes(value.nextLanguage))) throw new Error('Invalid language response');
    state.languageState = value;
    state.language = value.language;
    state.languageError = '';
    if (state.data) {
      state.data.languageState = value;
      state.data.language = value.language;
      render();
    } else { applyLanguage(); renderLanguage(); }
  }
  async function refreshLanguage() {
    if (scope.center || readOnly() || state.languageLoading || state.languageSaving) return;
    state.languageLoading = true;
    renderLanguage();
    try { applyLanguageState(await fetchJSON('/api/language', {}, 10000)); }
    catch (_) { state.languageError = 'languageUnavailable'; }
    finally { state.languageLoading = false; renderLanguage(); }
  }
  async function saveLanguage() {
    if (scope.center || readOnly() || state.languageSaving || state.languageLoading) return;
    const language = $('languageSelect').value;
    ++state.languageRevision;
    state.languageSaving = true;
    state.languageSaved = false;
    state.languageError = '';
    renderLanguage();
    try {
      const result = await fetchJSON('/api/language', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language }) }, 10000);
      if (result.ok !== true) throw new Error('Language save not confirmed');
      applyLanguageState(result);
      state.languageSaved = true;
      state.signature = '';
    } catch (_) { state.languageError = 'languageSaveFailed'; }
    finally { state.languageSaving = false; renderLanguage(); }
  }
  function unavailableArtifact(artifact) {
    if (artifact.associationStatus === 'unknown') return message('artifactUnassociated');
    if (artifact.kind === 'preview') {
      return message(artifact.state === 'stopped' ? 'previewEnded' : artifact.state === 'interrupted' ? 'previewInterrupted' : 'previewUnavailable');
    }
    return message(artifact.evidenceStatus === 'stale' ? 'artifactStale' : 'artifactUnavailable');
  }
  function mediaURL(value, productId) {
    if (scope.center) return safeScopedResource(value);
    if (typeof productId !== 'string' || !/^[0-9a-f]{32}$/.test(productId) || typeof value !== 'string') return null;
    return new RegExp(`^/api/product-media/${productId}/[a-zA-Z0-9_.-]+\\.(?:png|svg)$`).test(value) ? value : null;
  }
  async function retryProductMedia(productId) {
    if (readOnly() || state.mediaAction || productId !== state.data?.productMedia?.productId) return;
    const previousCapture = state.data?.productMedia?.screenshot;
    const previousSuccess = previousCapture?.latestSuccess?.capturedAt || null;
    state.mediaAction = true; state.mediaError = null;
    renderSidebar();
    renderRuntime();
    try {
      const sourceRevision = state.data?.entry?.sourceRecordRevision;
      const intentSignature = `${productId}:${state.data?.sourceId || ''}:${sourceRevision ?? ''}`;
      if (!state.mediaIntent || state.mediaIntent.signature !== intentSignature) state.mediaIntent = { signature: intentSignature, key: crypto.randomUUID() };
      const options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(scope.center
        ? { sourceId: state.data?.sourceId, expectedRevision: sourceRevision, idempotencyKey: state.mediaIntent.key }
        : { productId }) };
      if (scope.center) await fetchCenter(scopedJournalPath('/media/capture'), options, 170000);
      else await fetchJSON('/api/product-media/capture', options, 170000);
      state.mediaIntent = null;
    } catch (_) { state.mediaError = { productId, previousSuccess }; }
    finally {
      state.mediaAction = false;
      await refresh();
      renderSidebar();
      renderRuntime();
      if (scope.center) refreshCenterContext();
    }
  }
  function mediaRetryError(media) {
    const error = state.mediaError;
    if (!error) return false;
    const capture = media?.screenshot;
    if (error.productId !== media?.productId || (capture?.state === 'success' && capture.latestSuccess?.capturedAt !== error.previousSuccess)) {
      state.mediaError = null;
      return false;
    }
    return true;
  }
  function iconPublicationWarning(icon) {
    if (icon?.publicationStatus === 'conflict') return 'iconPublicationConflict';
    if (icon?.publicationStatus === 'failed') return 'iconPublicationFailed';
    if (['stale', 'unavailable'].includes(icon?.publicationStatus)) return 'iconPublicationChanged';
    const reference = icon?.reference;
    if (reference?.state === 'preserved') return 'iconReferencePreserved';
    return reference && !['inserted', 'linked', 'not_applicable'].includes(reference.state) ? 'iconReferenceUnconfirmed' : null;
  }
  function renderProductMedia(media) {
    if (!media?.productId) return null;
    const section = readOnly() ? bindDisclosure(element('details', 'sidebar-block product-media'), 'product-media') : element('section', 'sidebar-block product-media');
    section.append(element(readOnly() ? 'summary' : 'h2', '', message('productScreenshot')));
    const capture = media.screenshot || {};
    const success = capture.latestSuccess;
    const variants = (success?.variants || []).filter((item) => mediaURL(item.href, media.productId));
    const desktop = variants.find((item) => item.viewport === 'desktop') || variants[0];
    if (desktop) {
      const link = element('a', 'product-screenshot-link');
      link.href = mediaURL(desktop.href, media.productId);
      link.target = '_blank'; link.rel = 'noopener';
      link.setAttribute('aria-label', message('openScreenshot'));
      const image = element('img', 'product-screenshot');
      image.src = link.href;
      image.alt = message('screenshotAlt', { name: state.data.project?.name || message('noProject') });
      image.loading = 'lazy'; image.decoding = 'async';
      if (Number.isInteger(desktop.width) && Number.isInteger(desktop.height) && desktop.width > 0 && desktop.height > 0) {
        image.width = desktop.width; image.height = desktop.height;
      }
      image.addEventListener('error', () => {
        link.replaceWith(element('p', 'sidebar-note status-failed', message('screenshotResourceUnavailable')));
      }, { once: true });
      link.append(image); section.append(link);
      const caption = element('p', 'sidebar-note screenshot-caption', message('capturedAt', { time: formatTime(success.capturedAt, true) }));
      if (capture.currentVersion && success.version !== capture.currentVersion) caption.append(element('span', 'screenshot-stale', message('screenshotOldVersion')));
      section.append(caption);
      const links = element('div', 'screenshot-links');
      for (const variant of variants) {
        const item = element('a', '', message(variant.viewport === 'mobile' ? 'mobileScreenshot' : 'desktopScreenshot'));
        item.href = mediaURL(variant.href, media.productId); item.target = '_blank'; item.rel = 'noopener';
        links.append(item);
      }
      section.append(links);
    }
    if (!desktop || !['completed', 'ready', 'success', 'unchanged'].includes(capture.state)) {
      const key = { capturing: 'screenshotCapturing', running: 'screenshotCapturing', pending: 'screenshotCapturing',
        failed: 'screenshotFailed', interrupted: 'screenshotInterrupted', unsupported: 'screenshotUnsupported',
        not_applicable: 'screenshotNotApplicable', unavailable: 'screenshotUnavailable', stale: 'screenshotOldVersion' }[capture.state] || 'screenshotMissing';
      section.append(element('p', 'sidebar-note', message(key)));
    }
    if (!readOnly()) {
      const retry = element('button', 'text-button screenshot-retry', message(state.mediaAction ? 'screenshotCapturing' : 'retryScreenshot'));
      retry.id = 'retryScreenshot';
      retry.disabled = Boolean(state.mediaAction || state.statusFailed || state.action || state.data?.control?.action || state.data?.control?.stopUnconfirmed || !['stopped', 'inactive'].includes(state.data?.runtime?.processState));
      retry.title = message('retryScreenshotHint');
      retry.addEventListener('click', () => retryProductMedia(media.productId));
      section.append(retry);
      if (mediaRetryError(media)) section.append(element('p', 'sidebar-note status-failed', message('screenshotRetryFailed')));
    }
    return section;
  }
  function renderSidebar() {
    const sidebar = clear($('projectSidebar'));
    const data = state.data;
    const overview = element('section', 'sidebar-block project-overview');
    const name = element('h1', '', data.project?.displayName || data.project?.name || message('noProject')); name.id = 'projectName';
    const description = element('p', 'project-description', clean(data.project?.description)); description.id = 'projectDescription'; description.title = description.textContent;
    const latest = state.currentCycle;
    const date = element('p', 'sidebar-note', latest?.active ? message('currentRun') : latest ? message('latestRun', { date: formatDate(latest.startedAt) }) : message(readOnly() ? 'archived' : 'ready')); date.id = 'runHeading';
    const identity = element('div', 'project-identity');
    const media = data.productMedia;
    const productIcon = mediaURL(media?.icon?.href, media?.productId);
    if (productIcon) {
      const image = element('img', 'product-icon');
      image.src = productIcon; image.alt = ''; image.width = image.height = 36;
      image.title = message(media.icon.source === 'default' ? 'defaultProductIcon' : 'productIcon');
      image.addEventListener('error', () => image.remove(), { once: true });
      identity.append(image);
    }
    identity.append(name);
    overview.append(identity, description, date);
    const iconWarning = iconPublicationWarning(media?.icon);
    if (iconWarning) overview.append(element('p', 'sidebar-note status-failed', message(iconWarning)));
    const artifacts = element('section', 'sidebar-block');
    artifacts.append(element('h2', '', message('artifacts')));
    const visibleArtifacts = (data.artifacts || []).filter((artifact) => artifact.kind !== 'check');
    if (visibleArtifacts.length) {
      const list = element('ul', 'artifact-list');
      for (const artifact of visibleArtifacts) {
        const item = element('li');
        const label = artifact.displayLabel || (artifact.kind === 'preview' ? message(artifact.available === false ? 'previewName' : 'productPreview') : artifact.path?.split(/[\\/]/).pop()?.toUpperCase() === 'DELIVERY.MD' ? message('deliveryDocument') : String(artifact.label || artifact.path || '').split(/[\\/]/).pop());
        if (artifact.available === false || (!artifact.path && !artifact.url)) {
          item.append(element('span', '', `${label} · ${unavailableArtifact(artifact)}`));
        } else {
          const link = element('a', 'artifact-link');
          const scopedURL = artifact.kind === 'preview' ? safePreviewURL(artifact) : safeScopedResource(artifact.url);
          link.href = scope.center ? scopedURL : artifact.url || `/api/journal/document?path=${encodeURIComponent(artifact.path)}`;
          if (!link.href || (scope.center && !scopedURL)) { item.replaceChildren(element('span', '', `${label} · ${message('artifactUnavailable')}`)); list.append(item); continue; }
          link.target = '_blank';
          link.rel = 'noopener';
          link.title = artifact.path || artifact.url;
          link.append(icon(artifact.kind === 'preview' ? 'panels-top-left' : 'file-text'), element('span', '', label));
          const arrow = icon('external-link'); arrow.classList.add('artifact-arrow');
          arrow.setAttribute('aria-hidden', 'true');
          link.append(arrow);
          item.append(link);
        }
        if (artifact.recordedAt) item.append(element('p', 'sidebar-note', message('recordedAt', { time: formatTime(artifact.recordedAt) })));
        list.append(item);
      }
      artifacts.append(list);
    } else artifacts.append(element('p', 'sidebar-note', message('noArtifacts')));
    const runtime = element('section', 'sidebar-block');
    runtime.append(element('h2', '', message('runtime')));
    const sum = aggregate(data.cycles.filter((cycle) => !cycle.active));
    const usage = `${compactNumber(sum.totalTokens)}${knownNumber(sum.totalTokens) ? ' tokens' : ''}${sum.partial && sum.known ? message('usagePartialShort') : ''}`;
    const recordedCycle = scope.center ? data.cycles.find((cycle) => cycle.belongsToCurrentProject !== false) : null;
    const config = scope.center ? {
      engine: recordedCycle?.engine || 'unknown',
      model: recordedCycle?.observedConfig?.model || recordedCycle?.model || 'unknown',
      reasoning: recordedCycle?.observedConfig?.reasoning || 'unknown',
    } : data.runtime || {};
    const productLanguage = scope.center ? (data.languageState?.productLanguageStatus === 'unknown' ? null : data.languageState?.productLanguage) : config.language || data.language;
    const effort = ['low', 'medium', 'high', 'xhigh'].includes(config.reasoning) ? message(`effort_${config.reasoning}`) : config.reasoning;
    runtime.append(runtimeRows([[message('engine'), config.engine], [message('model'), config.model], [message('reasoning'), effort === 'unknown' ? message('unknown') : effort], [message('language'), languageLabel(productLanguage)], [message('recordedUsage'), usage]]));
    const details = bindDisclosure(element('details', 'runtime-disclosure'), 'runtime');
    details.append(element('summary', '', message('moreRuntime')), runtimeRows([[message('state'), runtimeLabel()], [message('source'), data.sourceName]]));
    details.append(element('p', 'sidebar-note', message(config.configSource === 'session_context' ? 'observedSession' : 'unconfirmedSession')));
    runtime.append(details);
    sidebar.append(overview);
    const productMedia = renderProductMedia(media);
    if (productMedia) sidebar.append(productMedia);
    sidebar.append(artifacts, runtime);
  }
  function applyLanguage() {
    document.documentElement.lang = state.language;
    document.title = `${state.data?.project?.name || 'Auto Company'} · ${message('work')}`;
    document.querySelectorAll('[data-i18n]').forEach((node) => { node.textContent = message(node.dataset.i18n); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => { node.placeholder = message(node.dataset.i18nPlaceholder); });
    $('centerContextNav').hidden = !scope.center;
    if (scope.center) document.querySelector('.brand').href = '/center';
    for (const [id, name] of [['tab-work', 'notebook-pen'], ['tab-usage', 'chart-no-axes-column'], ['tab-logs', 'terminal'], ['settingsButton', 'settings']]) iconLabel($(id), name, $(id).textContent);
    $('refreshButton').replaceChildren(icon('refresh-cw'));
    $('closeSettingsButton').replaceChildren(icon('x'));
    $('refreshButton').title = message('refresh');
    $('refreshButton').setAttribute('aria-label', message('refresh'));
    $('closeSettingsButton').setAttribute('aria-label', message('close'));
    $('closeProductSwitcherButton').setAttribute('aria-label', message('close'));
    document.querySelector('.tabs').setAttribute('aria-label', message('work'));
    document.querySelector('.table-scroll').setAttribute('aria-label', message('usageDetail'));
    $('projectSidebar').setAttribute('aria-label', message('artifacts'));
    window.DashboardIcons.hydrate();
  }
  function rememberFocus() {
    const active = document.activeElement;
    if (!active || active === document.body) return null;
    const disclosure = active.closest('details[data-disclosure-key]');
    return { id: active.id, key: active.dataset.focusKey, disclosure: active.tagName === 'SUMMARY' ? disclosure?.dataset.disclosureKey : null };
  }
  function restoreFocus(saved) {
    if (!saved) return;
    const node = saved.id ? $(saved.id) : saved.key ? [...document.querySelectorAll('[data-focus-key]')].find((item) => item.dataset.focusKey === saved.key) : saved.disclosure ? [...document.querySelectorAll('details[data-disclosure-key]')].find((item) => item.dataset.disclosureKey === saved.disclosure)?.querySelector(':scope > summary') : null;
    if (node && !node.disabled) node.focus({ preventScroll: true });
  }
  function latestCycle(data) {
    const scoped = Boolean(data.project?.id) && Object.hasOwn(data, 'latestProjectCycleId');
    return data.cycles.find((cycle) => cycle.active && (!scoped || cycle.projectStatus === 'current'))
      || (scoped ? data.cycles.find((cycle) => cycle.id === data.latestProjectCycleId && cycle.projectStatus === 'current') : data.cycles[0]);
  }
  function render() {
    const focus = rememberFocus();
    const data = state.data;
    applyLanguage();
    let latest = latestCycle(data);
    if (!latest?.active && liveProcess() && data.runtime?.state === 'running') latest = { id: '__current__', number: data.runtime?.currentCycleNumber, startedAt: data.runtime?.lastRun, status: 'running', active: true, synthetic: true };
    if (latest?.active && state.statusFailed) latest = { ...latest, active: false, status: 'unknown' };
    state.currentCycle = latest;
    if (scope.center) $('productSwitcherName').textContent = data.project?.name || data.entry?.displayName || message('switchProduct');
    renderCurrent(latest);
    renderHistory();
    renderSidebar();
    renderRuntime();
    renderLanguage();
    const notes = clear($('sourceNotes'));
    if (data.warnings?.length) {
      const disclosure = bindDisclosure(element('details'), 'warnings');
      const list = element('ul');
      data.warnings.forEach((warning) => list.append(element('li', '', clean(warning))));
      disclosure.append(element('summary', '', `${message('warning')} · ${data.warnings.length}`), list);
      notes.append(disclosure);
    }
    $('sourceName').textContent = message('sourceLabel', { name: data.sourceName || 'Auto Company' });
    if (!$('usageDate').value) $('usageDate').value = datePart(data.cycles.find((cycle) => !cycle.active)?.endedAt) || new Date().toISOString().slice(0, 10);
    renderUsage();
    renderLogOptions();
    selectTab(state.tab);
    restoreFocus(focus);
  }
  function filterUsage() {
    const period = $('usagePeriod').value;
    const selected = $('usageDate').value;
    $('usageDate').hidden = period === 'all';
    $('usageDateLabel').hidden = period === 'all';
    $('usageRange').textContent = '';
    const recorded = state.data.cycles.filter((cycle) => scope.center || !cycle.active);
    if (period === 'all') return recorded;
    if (!selected) return [];
    let start = selected;
    let end = selected;
    if (period === 'week') {
      const date = new Date(`${selected}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
      start = date.toISOString().slice(0, 10);
      date.setUTCDate(date.getUTCDate() + 6);
      end = date.toISOString().slice(0, 10);
      $('usageRange').textContent = `${start} – ${end}`;
    }
    return recorded.filter((cycle) => {
      const value = cycle.endedAt || cycle.startedAt || cycle.reservedAt;
      const date = scope.center ? localDatePart(value) : datePart(value);
      return date && date >= start && date <= end;
    });
  }
  function renderUsage() {
    if (!state.data) return;
    const cycles = filterUsage();
    const summary = clear($('usageSummary'));
    const rows = clear($('usageRows'));
    renderBudget(cycles);
    if (!cycles.length) {
      summary.append(element('p', 'muted', message('noUsage')));
      return;
    }
    const scoped = scope.center && state.scopedUsage?.key === usageKey(usageSelection()) ? state.scopedUsage.data : null;
    const total = scoped ? { ...scoped.usage, known: scoped.recorded, count: scoped.recorded + scoped.unknown,
      partial: Boolean(scoped.unknown || scoped.unknownTime || scoped.truncated || scoped.conflicting || cycles.some((cycle) => cycle.usage?.status === 'partial')) } : aggregate(cycles);
    summary.append(element('span', 'usage-total', number(total.totalTokens)), element('span', 'usage-summary-label', message('knownTotal')));
    summary.append(element('p', 'usage-coverage', message('coverageDescription', total)));
    const amounts = element('p', 'usage-coverage', `${message('input')} ${number(total.inputTokens)} · ${message('output')} ${number(total.outputTokens)}`);
    summary.append(amounts);
    if (!total.known) summary.append(element('p', 'usage-warning', message('noUsageKnown')));
    else if (total.known < total.count) summary.append(element('p', 'usage-warning', message('partialWarning', { count: total.count - total.known })));
    else if (total.partial) summary.append(element('p', 'usage-warning', message('partial')));
    for (const cycle of cycles) {
      const row = element('tr');
      row.append(element('td', '', cycle.identityKind === 'exploration' ? message('explorationNumber', { number: paddedCycleNumber(cycle) }) : `${message('cycle')} ${paddedCycleNumber(cycle)}`), element('td', '', formatTime(cycle.startedAt, true)), element('td', '', statusLabel(cycle.status)));
      for (const field of ['inputTokens', 'outputTokens', 'totalTokens']) {
        const cell = element('td', 'numeric', number(cycle.usage?.[field]));
        if (!knownNumber(cycle.usage?.[field])) cell.title = message('unknown');
        row.append(cell);
      }
      const status = knownNumber(cycle.usage?.totalTokens) ? (cycle.usage?.status === 'partial' ? 'partial' : 'reported') : 'unavailable';
      row.append(element('td', '', message(status)));
      rows.append(row);
    }
  }
  function renderBudget(cycles) {
    const container = clear($('budgetSummary'));
    const costs = cycles.map((cycle) => cycle.costUsd).filter(knownNumber);
    const cost = costs.length ? new Intl.NumberFormat(state.language, { style: 'currency', currency: 'USD', maximumFractionDigits: 6 }).format(costs.reduce((sum, value) => sum + value, 0)) : message('unknown');
    container.append(element('p', '', message('recordedCost', { cost, known: costs.length, count: cycles.length })));
    const budget = cycles.find((cycle) => cycle.budget)?.budget || ($('usagePeriod').value === 'all' ? state.data?.recordedBudget : null);
    if (budget) {
      const key = `budget_${budget.state || 'unknown'}`;
      container.append(element('p', '', message('recordedBudget', { state: message(key) === key ? String(budget.state || message('unknown')) : message(key), start: budget.start_date || '—', end: budget.end_date || '—' })));
      if (Array.isArray(budget.alerts)) {
        const list = element('ul');
        for (const alert of budget.alerts) {
          if (!alert || typeof alert !== 'object') continue;
          list.append(element('li', '', message('budgetAlert', { level: message(alert.level === 'warning' ? 'budgetWarning' : 'budgetLimit'), metric: alert.metric === 'cost_usd' ? 'USD' : message('total'), actual: number(alert.actual), limit: number(alert.limit), coverage: ['complete', 'partial', 'unavailable'].includes(alert.coverage) ? message(`budget_${alert.coverage}`) : message('unknown') })));
        }
        container.append(list);
      }
    }
    if (state.data?.budgetPause) container.append(element('p', 'status-failed', message('budgetPauseReason', { reason: pauseLabel(state.data.budgetPause.reason) || message('pauseReview') })));
  }
  function renderLogOptions() {
    const select = clear($('logSelect'));
    const cycles = logCycles();
    const hasRuntime = !scope.center || Boolean(safeScopedResource(state.data.runtimeLogUrl));
    if (state.selectedLog !== 'runtime' && !cycles.some((cycle) => cycle.id === state.selectedLog)) state.selectedLog = hasRuntime ? 'runtime' : '';
    if (!state.selectedLog && cycles.length) state.selectedLog = cycles[0].id;
    if (hasRuntime) {
      const global = element('option', '', message('runtimeLog'));
      global.value = 'runtime';
      select.append(global);
    }
    for (const cycle of cycles) {
      const label = cycle.identityKind === 'exploration' ? message('explorationNumber', { number: paddedCycleNumber(cycle) }) : `${message('cycle')} ${paddedCycleNumber(cycle)}`;
      const option = element('option', '', `${label} · ${formatTime(cycle.startedAt, true)} · ${statusLabel(cycle.status)}`);
      option.value = cycle.id;
      select.append(option);
    }
    select.value = state.selectedLog;
    select.disabled = false;
    $('refreshLogButton').disabled = Boolean(state.logPending);
  }
  function logContextKey() {
    const id = state.selectedLog;
    if (!scope.center) return JSON.stringify([id]);
    const cycle = logCycles().find((item) => item.id === id);
    return JSON.stringify([state.data?.entryId, state.data?.sourceId, state.data?.sourceRevision, id,
      id === 'runtime' ? state.data?.runtimeLogUrl : cycle?.logUrl]);
  }
  async function loadLog() {
    const key = logContextKey();
    if (state.logPending) {
      if (state.logPending.key !== key) {
        ++state.logRequest;
        if (state.logLoadedKey !== key) { state.logText = ''; $('logText').textContent = ''; $('copyLogButton').disabled = true; }
        await state.logPending.promise;
        return loadLog();
      }
      return state.logPending.promise;
    }
    const request = ++state.logRequest;
    const id = state.selectedLog;
    const previous = state.logLoadedKey === key ? state.logText : '';
    if (state.logLoadedKey !== key) $('logText').textContent = '';
    state.logText = '';
    $('copyLogButton').disabled = true;
    $('copyLogButton').textContent = message('copy');
    $('refreshLogButton').disabled = true;
    $('logStatus').textContent = message('loadingLog');
    const promise = (async () => { try {
      if (scope.center) {
        const cycle = logCycles().find((item) => item.id === id);
        const value = await fetchScopedText(id === 'runtime' ? state.data.runtimeLogUrl : cycle?.logUrl, 15000);
        if (request !== state.logRequest || key !== logContextKey()) return;
        state.logText = value; state.logLoadedKey = key; $('logText').textContent = value;
        $('logStatus').textContent = value ? message('logAvailable', { count: number(value.length) }) : message('logEmpty');
        $('copyLogButton').disabled = !value;
        return;
      }
      const result = await fetchJSON(id === 'runtime' ? '/api/log-tail?lines=180' : `/api/journal/log?id=${encodeURIComponent(id)}`, {}, 15000);
      if (request !== state.logRequest || key !== logContextKey()) return;
      if (id !== 'runtime' && !result.available) { $('logText').textContent = ''; $('logStatus').textContent = message('noLog'); return; }
      if (id === 'runtime' && typeof result.logTail !== 'string') throw new Error('Invalid runtime log');
      state.logText = String(id === 'runtime' ? result.logTail : result.text || '');
      state.logLoadedKey = key;
      $('logText').textContent = state.logText;
      $('logStatus').textContent = result.truncated ? message('logTruncated') : state.logText ? message('logAvailable', { count: number(state.logText.length) }) : message('logEmpty');
      $('copyLogButton').disabled = !state.logText;
    } catch (_) {
      if (request !== state.logRequest || key !== logContextKey()) return;
      state.logText = previous;
      $('logStatus').textContent = message('logFailed');
    } finally { if (state.logPending?.request === request) { state.logPending = null; $('refreshLogButton').disabled = false; } } })();
    state.logPending = { key, request, promise };
    return promise;
  }
  function selectTab(tab, focus = false) {
    state.tab = tab;
    for (const button of document.querySelectorAll('[data-tab]')) {
      const active = button.dataset.tab === tab;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      $(`panel-${button.dataset.tab}`).hidden = !active || !state.data;
    }
    if (focus) $(`tab-${tab}`).focus();
  }
  function switcherMatches(query) {
    const value = String(query || '').trim().toLocaleLowerCase(state.language);
    return scope.entries.filter((entry) => !entry.archived && entry.kind !== 'reference' && (!value || [entry.displayName, entry.description, entry.alias].some((item) => String(item || '').toLocaleLowerCase(state.language).includes(value))));
  }
  function renderProductSwitcher(query = '') {
    const list = clear($('productSwitcherList'));
    const entries = switcherMatches(query);
    $('productSwitcherStatus').textContent = entries.length ? '' : message('noProductsFound');
    for (const entry of entries) {
      const option = element('a', `product-switcher-option${entry.entryId === scope.entryId ? ' current' : ''}`);
      option.href = `/products/${encodeURIComponent(entry.entryId)}`;
      option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(entry.entryId === scope.entryId)); option.dataset.entryId = entry.entryId;
      const copy = element('span'); copy.append(element('strong', '', entry.displayName || message('unknown')), element('small', '', entry.description || message('unavailable')));
      option.append(copy);
      if (entry.entryId === scope.entryId) option.append(element('span', 'switcher-current', message('currentProduct')));
      list.append(option);
    }
  }
  async function openProductSwitcher() {
    if (!scope.center) return;
    const dialog = $('productSwitcherDialog'); const token = ++scope.token;
    $('productSwitcherSearch').value = ''; $('productSwitcherStatus').textContent = message('loadingProducts'); clear($('productSwitcherList'));
    dialog.showModal(); $('productSwitcherSearch').focus();
    try {
      const [entries, summary] = await Promise.all([fetchAllCenterEntries(), fetchCenter('/summary')]);
      if (token !== scope.token || !dialog.open || !Array.isArray(entries)) return;
      scope.entries = entries; renderProductSwitcher();
      renderCenterRuntimeContext(summary);
    } catch (_) { if (token === scope.token) $('productSwitcherStatus').textContent = message('readFailed'); }
  }
  async function refreshCenterContext() {
    if (!scope.center) return;
    const token = ++scope.contextToken; const entryId = scope.entryId;
    try {
      const summary = state.centerSummary || await fetchCenter('/summary');
      if (token !== scope.contextToken || entryId !== scope.entryId) return;
      renderCenterRuntimeContext(summary);
    } catch (_) {
      if (token === scope.contextToken) { $('centerRuntimeContext').textContent = ''; $('centerRuntimeContext').title = ''; }
    }
  }
  function moveSwitcherFocus(direction) {
    const options = [...$('productSwitcherList').querySelectorAll('[role="option"]')];
    if (!options.length) return;
    const current = options.indexOf(document.activeElement);
    const next = current < 0 ? (direction > 0 ? 0 : options.length - 1) : (current + direction + options.length) % options.length;
    options[next].focus();
  }
  function scheduleRefresh() {
    clearTimeout(state.timer);
    state.timer = null;
    if (!$('autoRefresh').checked || document.hidden || state.action || state.refreshPending || (readOnly() && !scope.center)) return;
    state.timer = setTimeout(refresh, state.statusFailed ? 15000 : 5000);
  }
  function refresh() {
    if (state.refreshPending) return state.refreshPending;
    clearTimeout(state.timer);
    $('refreshButton').disabled = true;
    $('refreshStatus').textContent = message('refreshing');
    const languageRevision = state.languageRevision;
    const detailToken = ++state.detailToken;
    const promise = (async () => { try {
      const requestEntryId = scope.entryId;
      const scopedSelection = scope.center ? usageSelection() : null;
      const scopedResult = scope.center ? await Promise.all([fetchFullScopedJournal(), fetchCenter('/summary')]) : null;
      const data = scope.center ? scopedResult[0] : await fetchJSON('/api/journal');
      if (scope.center) state.centerSummary = scopedResult[1];
      if (scope.center && (detailToken !== state.detailToken || requestEntryId !== scope.entryId || data.entryId !== scope.entryId)) throw new Error('Out-of-scope journal response');
      if (!data.ok || !Array.isArray(data.cycles)) throw new Error('invalid journal response');
      const signature = JSON.stringify({ ...data, generatedAt: undefined, status: data.status ? { ...data.status, timestamp: undefined, elapsedMs: undefined } : undefined });
      if (state.data && Number.isFinite(Date.parse(data.generatedAt)) && Date.parse(data.generatedAt) < Date.parse(state.data.generatedAt)) throw new Error('Out-of-order journal snapshot');
      let nextScopedUsage = null;
      if (scope.center) {
        if (!$('usageDate').value) {
          const latestRecorded = data.cycles.find((cycle) => !cycle.active);
          $('usageDate').value = localDatePart(latestRecorded?.endedAt || latestRecorded?.startedAt || latestRecorded?.reservedAt) || localDatePart(new Date());
        }
        const selection = scopedSelection.period === 'all' ? scopedSelection : usageSelection();
        nextScopedUsage = await fetchScopedUsage(selection, data);
      }
      state.data = data;
      if (scope.center) state.scopedUsage = nextScopedUsage;
      state.receivedAt = performance.now();
      state.statusFailed = scope.center ? false : data.runtime?.available === false || data.status?.ok === false || !data.runtime || ['unknown', 'unavailable'].includes(data.runtime.state);
      if (languageRevision === state.languageRevision && !state.languageSaving && !state.languageLoading) {
        if (data.languageState) {
          const language = data.languageState;
          if (['en', 'zh-CN'].includes(language.language) && (!language.nextLanguage || ['en', 'zh-CN'].includes(language.nextLanguage))) state.languageState = language;
        }
        state.language = scope.center && ['en', 'zh-CN'].includes(state.centerSummary?.language) ? state.centerSummary.language : state.languageState?.language || (data.language === 'zh-CN' ? 'zh-CN' : 'en');
      }
      if (!state.autoChanged) $('autoRefresh').checked = scope.center || !readOnly();
      $('connectionError').hidden = !state.statusFailed || (readOnly() && data.status === null);
      $('connectionError').textContent = message('runtimeUnavailable');
      $('loadingState').hidden = true;
      if (signature !== state.signature) {
        const scrollPosition = window.scrollY;
        state.signature = signature;
        render();
        requestAnimationFrame(() => window.scrollTo({ top: scrollPosition, behavior: 'instant' }));
      }
      renderRuntime();
      if (scope.center) renderUsage();
      if (scope.center) refreshCenterContext();
      $('refreshStatus').textContent = message('refreshed', { time: formatTime(data.generatedAt || new Date().toISOString()) });
      if (state.tab === 'logs') await loadLog();
    } catch (_) {
      state.statusFailed = true;
      state.signature = '';
      $('loadingState').hidden = true;
      $('connectionError').hidden = false;
      $('connectionError').textContent = message(state.data ? 'stale' : 'readFailed');
      $('refreshStatus').textContent = state.data?.generatedAt ? message('lastUpdated', { time: formatTime(state.data.generatedAt, true) }) : '';
      if (state.data) {
        if (scope.center) renderCenterLiveState();
        else render();
      }
      else renderRuntime();
    } finally {
      state.refreshPending = null;
      $('refreshButton').disabled = Boolean(state.action);
      scheduleRefresh();
    } })();
    state.refreshPending = promise;
    return promise;
  }
  async function runAction(action) {
    if ($(action === 'start' ? 'startButton' : 'stopButton').disabled || state.action) return;
    state.action = action;
    clearTimeout(state.timer);
    renderRuntime();
    actionMessage('actionPending', { action: message(action) });
    if (action === 'start' && state.refreshPending) await state.refreshPending;
    try {
      // Recheck after any in-flight status read before mutating the runtime.
      const process = state.data?.runtime?.processState || state.data?.runtime?.state;
      const retryStop = action === 'stop' && state.data?.control?.stopUnconfirmed === true;
      if (readOnly() || (!retryStop && (state.statusFailed || (action === 'start' ? !['stopped', 'inactive'].includes(process) : process !== 'running')))) throw new Error(message('stateChanged'));
      const result = await fetchJSON(`/api/action/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 120000);
      if (result.ok !== true) throw new Error('Action not confirmed');
      actionMessage('actionComplete', { action: message(action) });
    } catch (error) {
      actionMessage('actionFailed', { action: message(action), detail: error.name === 'AbortError' ? message('actionUnconfirmed') : error.message || message('actionUnconfirmed') }, true);
    } finally {
      if (state.refreshPending) await state.refreshPending;
      await refresh();
      state.action = '';
      renderRuntime();
      scheduleRefresh();
    }
  }

  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => { selectTab(button.dataset.tab); if (button.dataset.tab === 'logs') loadLog(); });
    button.addEventListener('keydown', (event) => {
      const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      const tabs = ['work', 'usage', 'logs'];
      const index = tabs.indexOf(state.tab);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
      selectTab(tabs[next], true);
      if (tabs[next] === 'logs') loadLog();
    });
  });
  state.elapsedTimer = setInterval(updateElapsed, 1000);
  $('refreshButton').addEventListener('click', refresh);
  $('startButton').addEventListener('click', () => runAction('start'));
  $('stopButton').addEventListener('click', () => runAction('stop'));
  $('autoRefresh').addEventListener('change', () => { state.autoChanged = true; scheduleRefresh(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && $('autoRefresh').checked && (scope.center || !readOnly()) && !state.action) refresh(); else scheduleRefresh(); });
  $('usagePeriod').addEventListener('change', () => { renderUsage(); refreshScopedUsage(); });
  $('usageDate').addEventListener('change', () => { renderUsage(); refreshScopedUsage(); });
  $('logSelect').addEventListener('change', () => { state.selectedLog = $('logSelect').value; loadLog(); });
  $('refreshLogButton').addEventListener('click', loadLog);
  $('copyLogButton').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(state.logText);
      $('copyLogButton').textContent = message('copied');
    } catch (_) { $('logStatus').textContent = message('copyFailed'); }
  });
  $('settingsButton').addEventListener('click', () => { $('settingsDialog').showModal(); refreshLanguage(); });
  $('productSwitcherButton').addEventListener('click', openProductSwitcher);
  $('closeProductSwitcherButton').addEventListener('click', () => $('productSwitcherDialog').close());
  $('productSwitcherSearch').addEventListener('input', () => renderProductSwitcher($('productSwitcherSearch').value));
  $('productSwitcherSearch').addEventListener('keydown', (event) => { if (event.key === 'ArrowDown') { event.preventDefault(); moveSwitcherFocus(1); } else if (event.key === 'ArrowUp') { event.preventDefault(); moveSwitcherFocus(-1); } });
  $('productSwitcherList').addEventListener('keydown', (event) => { if (event.key === 'ArrowDown') { event.preventDefault(); moveSwitcherFocus(1); } else if (event.key === 'ArrowUp') { event.preventDefault(); moveSwitcherFocus(-1); } else if (event.key === 'Enter') document.activeElement?.click(); });
  $('productSwitcherDialog').addEventListener('close', () => { ++scope.token; $('productSwitcherButton').focus(); });
  $('languageSelect').addEventListener('change', saveLanguage);
  $('closeSettingsButton').addEventListener('click', () => $('settingsDialog').close());
  $('settingsDialog').addEventListener('click', (event) => {
    if (event.target !== $('settingsDialog')) return;
    const box = $('settingsDialog').getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) $('settingsDialog').close();
  });
  applyLanguage();
  renderLanguage();
  refresh();
})();
