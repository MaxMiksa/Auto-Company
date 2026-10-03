const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({ window: {}, Date });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../dashboard/date-time.js'), 'utf8'), context);
const dates = context.window.DashboardDate;
test('display dates handle today, yesterday and year rollover at render time', () => {
  const now = new Date(2027, 0, 1, 0, 5);
  assert.equal(dates.format(new Date(2027, 0, 1, 0, 1, 59), 'zh-CN', now), '今天 00:01');
  assert.equal(dates.format(new Date(2026, 11, 31, 23, 59, 59), 'zh-CN', now), '昨天 23:59');
  assert.equal(dates.format(new Date(2026, 11, 30, 9, 7), 'zh-CN', now), '2026-12-30 09:07');
  assert.equal(dates.format(new Date(2027, 0, 3, 9, 7), 'zh-CN', now), '01-03 09:07');
  assert.equal(dates.format(new Date(2027, 0, 1, 0, 1), 'en', now), 'Today 00:01');
  assert.equal(dates.format(new Date(2026, 11, 31, 23, 59), 'en', now), 'Yesterday 23:59');
  assert.equal(dates.date('2027-01-01', 'zh-CN', now), '今天');
  assert.equal(dates.format('invalid', 'zh-CN', now), null);
});
test('yesterday uses local calendar days across a daylight-saving boundary', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    assert.equal(dates.format(new Date(2027, 2, 14, 0, 15), 'en', new Date(2027, 2, 15, 0, 5)), 'Yesterday 00:15');
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
