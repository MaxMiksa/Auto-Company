/* Lucide 0.468.0, pinned f12b0de177fbc2a6795e99be065887e72b237123.
 * Source: https://github.com/lucide-icons/lucide/tree/f12b0de177fbc2a6795e99be065887e72b237123/icons
 * License: LICENSE-lucide.txt. All interface and status geometry uses Lucide.
 */
(() => {
  "use strict";
  const ICONS = {
  "info": '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  "minus": '<path d="M5 12h14"/>',
  "plus": '<path d="M5 12h14"/><path d="M12 5v14"/>',
  "arrow-left": '<path d="m12 19-7-7 7-7"/><path d="M5 12h14"/>',
  "arrow-up-down": '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
  "arrow-up": '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  "arrow-down": '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  "filter": '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  "circle-check": '<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>',
  "circle-help": '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  "circle-pause": '<circle cx="12" cy="12" r="10"/><line x1="10" x2="10" y1="15" y2="9"/><line x1="14" x2="14" y1="15" y2="9"/>',
  "clock": '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  "loader-circle": '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  "circle-play": '<circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>',
  "notebook-pen": "<path d=\"M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4\" />\n  <path d=\"M2 6h4\" />\n  <path d=\"M2 10h4\" />\n  <path d=\"M2 14h4\" />\n  <path d=\"M2 18h4\" />\n  <path d=\"M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z\" />",
  "chart-no-axes-column": "<line x1=\"18\" x2=\"18\" y1=\"20\" y2=\"10\" />\n  <line x1=\"12\" x2=\"12\" y1=\"20\" y2=\"4\" />\n  <line x1=\"6\" x2=\"6\" y1=\"20\" y2=\"14\" />",
  "terminal": "<polyline points=\"4 17 10 11 4 5\" />\n  <line x1=\"12\" x2=\"20\" y1=\"19\" y2=\"19\" />",
  "play": "<polygon points=\"6 3 20 12 6 21 6 3\" />",
  "square": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" />",
  "sliders-horizontal": "<line x1=\"21\" x2=\"14\" y1=\"4\" y2=\"4\" />\n  <line x1=\"10\" x2=\"3\" y1=\"4\" y2=\"4\" />\n  <line x1=\"21\" x2=\"12\" y1=\"12\" y2=\"12\" />\n  <line x1=\"8\" x2=\"3\" y1=\"12\" y2=\"12\" />\n  <line x1=\"21\" x2=\"16\" y1=\"20\" y2=\"20\" />\n  <line x1=\"12\" x2=\"3\" y1=\"20\" y2=\"20\" />\n  <line x1=\"14\" x2=\"14\" y1=\"2\" y2=\"6\" />\n  <line x1=\"8\" x2=\"8\" y1=\"10\" y2=\"14\" />\n  <line x1=\"16\" x2=\"16\" y1=\"18\" y2=\"22\" />",
  "refresh-cw": "<path d=\"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8\" />\n  <path d=\"M21 3v5h-5\" />\n  <path d=\"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16\" />\n  <path d=\"M8 16H3v5\" />",
  "file-text": "<path d=\"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z\" />\n  <path d=\"M14 2v4a2 2 0 0 0 2 2h4\" />\n  <path d=\"M10 9H8\" />\n  <path d=\"M16 13H8\" />\n  <path d=\"M16 17H8\" />",
  "list-checks": "<path d=\"m3 17 2 2 4-4\" />\n  <path d=\"m3 7 2 2 4-4\" />\n  <path d=\"M13 6h8\" />\n  <path d=\"M13 12h8\" />\n  <path d=\"M13 18h8\" />",
  "panels-top-left": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" />\n  <path d=\"M3 9h18\" />\n  <path d=\"M9 21V9\" />",
  "external-link": "<path d=\"M15 3h6v6\" />\n  <path d=\"M10 14 21 3\" />\n  <path d=\"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6\" />",
  "chevron-right": "<path d=\"m9 18 6-6-6-6\" />",
  "x": "<path d=\"M18 6 6 18\" />\n  <path d=\"m6 6 12 12\" />",
  "layout-grid": "<rect width=\"7\" height=\"7\" x=\"3\" y=\"3\" rx=\"1\" />\n  <rect width=\"7\" height=\"7\" x=\"14\" y=\"3\" rx=\"1\" />\n  <rect width=\"7\" height=\"7\" x=\"14\" y=\"14\" rx=\"1\" />\n  <rect width=\"7\" height=\"7\" x=\"3\" y=\"14\" rx=\"1\" />",
  "list-ordered": "<path d=\"M10 12h11\" />\n  <path d=\"M10 18h11\" />\n  <path d=\"M10 6h11\" />\n  <path d=\"M4 10h2\" />\n  <path d=\"M4 6h1v4\" />\n  <path d=\"M6 18H4c0-1 2-2 2-3s-1-1.5-2-1\" />",
  "settings": "<path d=\"M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z\" />\n  <circle cx=\"12\" cy=\"12\" r=\"3\" />",
  "search": "<circle cx=\"11\" cy=\"11\" r=\"8\" />\n  <path d=\"m21 21-4.3-4.3\" />",
  "ellipsis-vertical": "<circle cx=\"12\" cy=\"12\" r=\"1\" />\n  <circle cx=\"12\" cy=\"5\" r=\"1\" />\n  <circle cx=\"12\" cy=\"19\" r=\"1\" />",
  "arrow-right": "<path d=\"M5 12h14\" />\n  <path d=\"m12 5 7 7-7 7\" />",
  "chevron-down": "<path d=\"m6 9 6 6 6-6\" />",
  "circle-alert": "<circle cx=\"12\" cy=\"12\" r=\"10\" />\n  <line x1=\"12\" x2=\"12\" y1=\"8\" y2=\"12\" />\n  <line x1=\"12\" x2=\"12.01\" y1=\"16\" y2=\"16\" />",
  "archive": "<rect width=\"20\" height=\"5\" x=\"2\" y=\"3\" rx=\"1\" />\n  <path d=\"M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8\" />\n  <path d=\"M10 12h4\" />",
  "eye": "<path d=\"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0\" />\n  <circle cx=\"12\" cy=\"12\" r=\"3\" />",
  "circle-x": "<circle cx=\"12\" cy=\"12\" r=\"10\" />\n  <path d=\"m15 9-6 6\" />\n  <path d=\"m9 9 6 6\" />"
};
  // Shared execution vocabulary; raw server states and product outcomes remain separate.
  const STATES = {
    completed: ['已完成', 'Completed', 'completed'],
    ended: ['运行结束', 'Run ended', 'completed'],
    delivery_complete: ['交付完成', 'Delivery complete', 'completed'],
    running: ['执行中', 'Running', 'running'],
    paused: ['暂停中', 'Paused', 'paused'],
    queued: ['排队中', 'Queued', 'pending'],
    failed: ['执行失败', 'Failed', 'failed'],
    blocked: ['待处理', 'Needs attention', 'attention'],
    attention: ['待处理', 'Needs attention', 'attention'],
    canceled: ['已取消', 'Canceled', 'canceled'],
    idle: ['等待下一轮', 'Waiting for next cycle', 'pending'],
    unknown: ['状态待确认', 'Status unconfirmed', 'unknown'],
    preparing: ['准备中', 'Preparing', 'pending'],
    starting: ['启动中', 'Starting', 'running'],
    stopping: ['停止中', 'Stopping', 'running'],
    archived: ['已归档', 'Archived', 'archived'],
    read_only: ['只读', 'Read only', 'read_only'],
  };
  const ALIASES = {};
  const definition = value => STATES[ALIASES[value] || value];
  window.DashboardStatus = Object.freeze({
    label: (value, language) => definition(value)?.[language === 'zh-CN' ? 0 : 1],
    visual: value => definition(value)?.[2] || 'unknown',
  });
  const STATUS_ICONS = { completed: 'circle-check', running: 'circle-play', paused: 'circle-pause', pending: 'clock', failed: 'circle-x', unknown: 'circle-help', attention: 'circle-alert', archived: 'archive', read_only: 'eye', canceled: 'circle-x' };
  function svg(markup, size) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({ viewBox: `0 0 ${size} ${size}`, class: 'ui-icon', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) node.setAttribute(key, value);
    // Only fixed library geometry is parsed; never interpolate product data.
    node.innerHTML = markup;
    return node;
  }
  function icon(name) {
    const node = svg(ICONS[name] || ICONS['file-text'], 24);
    node.setAttribute('data-lucide', ICONS[name] ? name : 'file-text');
    return node;
  }
  function status(state) {
    return icon(STATUS_ICONS[state] || 'circle-help');
  }
  function hydrate(root = document) {
    root.querySelectorAll('[data-icon]').forEach(node => node.replaceChildren(icon(node.dataset.icon)));
  }
  window.DashboardIcons = Object.freeze({ icon, status, hydrate });
})();
