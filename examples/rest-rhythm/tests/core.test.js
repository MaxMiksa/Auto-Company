import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTrip, planTrip, serializeTrip, parseTrip } from '../core.js';

function fixture() {
  return {
    title: '按自己的节奏看展', city: '自选城市', date: '2026-10-02', start: '09:00', end: '17:00',
    people: [
      { name: '甲', maxActive: 35, restMinutes: 15, needsSeat: true, needsAlone: false, avoidDim: true, needsQuiet: false },
      { name: '乙', maxActive: 50, restMinutes: 20, needsSeat: true, needsAlone: true, avoidDim: false, needsQuiet: true }
    ],
    activities: [{ id: 'a', name: '看矿物', duration: 60, travelMinutes: 5, required: true, indoor: true, opens: '09:00', closes: '16:00', source: '自行核对', notes: '' }],
    recovery: { name: '已核对的休息室', travelMinutes: 3, seat: 'yes', alone: 'yes', light: 'normal', noise: 'quiet', source: '本人现场核对', verifiedAt: '2026-10-01', notes: '' },
    backupRecovery: { name: '备用休息室', travelMinutes: 2, seat: 'yes', alone: 'yes', light: 'normal', noise: 'quiet', source: '本人现场核对', verifiedAt: '2026-10-01', notes: '' },
    exit: { name: '原入口', travelMinutes: 4, notes: '沿已经核对的路线返回。' }
  };
}

function verifyTimeline(result) {
  let active = 0;
  let previousEnd;
  const minute = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  for (const item of result.timeline) {
    assert.equal(minute(item.end) - minute(item.start), item.duration);
    if (previousEnd) assert.equal(item.start, previousEnd);
    if (item.type === 'recovery') {
      assert.ok(item.duration >= result.summary.restMinutes);
      active = 0;
    } else active += item.duration;
    assert.ok(active <= result.summary.activeLimit, `${item.name}的累计连续活动超过上限`);
    previousEnd = item.end;
  }
}

test('两人35/15与50/20取严格活动上限和最长恢复，长活动实际往返恢复点', () => {
  const result = planTrip(fixture());
  assert.equal(result.summary.status, 'ready');
  assert.equal(result.summary.activeLimit, 35);
  assert.equal(result.summary.restMinutes, 20);
  assert.equal(result.timeline.filter(item => item.type === 'activity').reduce((total, item) => total + item.duration, 0), 60);
  assert.ok(result.timeline.some(item => item.type === 'recovery'));
  for (let index = 0; index < result.timeline.length; index++) if (result.timeline[index].type === 'recovery') {
    assert.equal(result.timeline[index - 1].type, 'travel');
    assert.equal(result.timeline[index + 1].type, 'travel');
  }
  verifyTimeline(result);
});

test('未知硬条件且备用也未知时阻止可执行活动，保留退出动作', () => {
  const trip = fixture(); trip.recovery.alone = 'unknown'; trip.backupRecovery = null;
  const result = planTrip(trip);
  assert.equal(result.summary.status, 'blocked');
  assert.ok(result.unmet.some(message => message.includes('独处')));
  assert.ok(!result.timeline.some(item => item.type === 'activity'));
  assert.ok(result.timeline.some(item => item.type === 'exit'));
});

test('主恢复点失效时使用满足硬条件的备用点，无备用则明确失败', () => {
  const trip = fixture();
  const backup = planTrip(trip, { unavailableRecovery: true });
  assert.equal(backup.summary.status, 'ready');
  assert.equal(backup.summary.recoveryName, '备用休息室');
  trip.backupRecovery = null;
  const blocked = planTrip(trip, { unavailableRecovery: true });
  assert.equal(blocked.summary.status, 'blocked');
  assert.ok(blocked.unmet.length);
});

test('无恢复点不会凭空生成就地休息', () => {
  const trip = fixture(); trip.recovery = null; trip.backupRecovery = null;
  const result = planTrip(trip);
  assert.equal(result.summary.status, 'blocked');
  assert.ok(!result.timeline.some(item => item.type === 'recovery'));
});

test('关闭窗口无法容纳长活动时完整回滚，不把部分游览当完成', () => {
  const trip = fixture(); trip.activities[0].closes = '09:20';
  const result = planTrip(trip);
  assert.ok(result.unmet.some(message => message.includes('开放时间')));
  assert.deepEqual(result.summary.completedIds, []);
  assert.ok(!result.timeline.some(item => item.activityId === 'a'));
});

test('等待开放会实际往返已填写的恢复点，等待不假装坐下', () => {
  const trip = fixture(); trip.activities[0].opens = '10:00'; trip.activities[0].duration = 15;
  const result = planTrip(trip);
  assert.equal(result.summary.status, 'ready');
  assert.ok(result.timeline.some(item => item.type === 'recovery'));
  assert.ok(result.timeline.find(item => item.type === 'activity').start >= '10:00');
  verifyTimeline(result);
});

test('过长转场与恢复往返给出无法满足，不制造超限时间轴', () => {
  const trip = fixture(); trip.activities[0].travelMinutes = 40;
  const result = planTrip(trip);
  assert.equal(result.summary.status, 'blocked');
  verifyTimeline(result);
  trip.activities[0].travelMinutes = 5; trip.recovery.travelMinutes = 20;
  const far = planTrip(trip);
  assert.equal(far.summary.status, 'blocked');
  assert.ok(far.unmet.some(message => message.includes('往返太长')));
});

test('必做超时后返回，可选超时不会取消后续可做的必做活动', () => {
  const trip = fixture(); trip.end = '09:40';
  const result = planTrip(trip);
  assert.equal(result.summary.status, 'blocked');
  assert.ok(result.timeline.some(item => item.type === 'exit'));
  trip.end = '10:00'; trip.activities[0].required = false; trip.activities[0].duration = 200;
  trip.activities.push({ ...trip.activities[0], id: 'b', name: '短展览', duration: 10, required: true });
  const optional = planTrip(trip);
  assert.equal(optional.summary.status, 'ready');
  assert.deepEqual(optional.summary.completedIds, ['b']);
  assert.ok(optional.warnings.some(message => message.includes('可选')));
  verifyTimeline(optional);
});

test('雨天保留室内项目，未完成的室外必做项目仍是未完成', () => {
  const trip = fixture(); trip.activities[0].indoor = false;
  trip.activities.push({ ...trip.activities[0], id: 'b', name: '室内展览', duration: 10, indoor: true });
  const result = planTrip(trip, { rain: true });
  assert.ok(result.unmet.some(message => message.includes('雨天')));
  assert.ok(result.summary.completedIds.includes('b'));
  assert.ok(!result.summary.completedIds.includes('a'));
  assert.equal(result.summary.status, 'partial');
});

test('延误与提前返回重新核验可用时间，不越过结束时限', () => {
  const trip = fixture();
  const delayed = planTrip(trip, { delayMinutes: 60, earlyEnd: '10:30' });
  assert.equal(delayed.summary.start, '10:00');
  assert.equal(delayed.summary.status, 'blocked');
  assert.ok(delayed.summary.end <= '10:30');
  const impossible = planTrip(trip, { now: '17:00' });
  assert.equal(impossible.summary.status, 'blocked');
  assert.ok(impossible.unmet.some(message => message.includes('返回路程')));
});

test('标记已完成后不重复安排，剩余行程先实际恢复', () => {
  const trip = fixture(); trip.activities.push({ ...trip.activities[0], id: 'b', name: '航空展', duration: 10 });
  const result = planTrip(trip, { completedIds: ['a'], now: '11:00' });
  assert.equal(result.summary.status, 'ready');
  assert.ok(!result.timeline.some(item => item.activityId === 'a'));
  assert.ok(result.timeline.findIndex(item => item.type === 'recovery') < result.timeline.findIndex(item => item.type === 'activity'));
  assert.deepEqual(result.summary.completedIds, ['a', 'b']);
  verifyTimeline(result);
});

test('任意城市与用户文本原样保存，纯函数不改输入', () => {
  const trip = fixture(); trip.city = '任意未收录城市'; trip.activities[0].name = '<script>globalThis.injected=true</script>';
  const before = JSON.stringify(trip);
  planTrip(trip);
  assert.equal(JSON.stringify(trip), before);
  const roundtrip = parseTrip(serializeTrip(trip));
  assert.deepEqual(roundtrip, trip);
  assert.equal(globalThis.injected, undefined);
});

test('安全JSON拒绝错误版本、污染字段、超大文本与格式错误', () => {
  assert.throws(() => parseTrip('{'), /JSON/);
  assert.throws(() => parseTrip(JSON.stringify({ format: 'rest-rhythm', version: 2, trip: fixture() })), /第1版/);
  assert.throws(() => parseTrip('{"format":"rest-rhythm","version":1,"trip":{"__proto__":{"polluted":true}}}'), /不安全/);
  assert.throws(() => parseTrip(' '.repeat(200001)), /200KB/);
  assert.equal({}.polluted, undefined);
});

test('输入错误用中文返回；零人、重复活动、负时长、错误日期不排程', () => {
  const trip = fixture(); trip.people = []; trip.date = '2026-02-30'; trip.activities[0].duration = -1;
  trip.activities.push({ ...trip.activities[0] });
  const errors = validateTrip(trip);
  assert.ok(errors.some(message => message.includes('人数')));
  assert.ok(errors.some(message => message.includes('日期')));
  assert.ok(errors.some(message => message.includes('时长')));
  assert.ok(errors.some(message => message.includes('标识')));
  assert.equal(planTrip(trip).summary.status, 'blocked');
});

test('出口路程过长不生成冒充可用的退出线', () => {
  const trip = fixture(); trip.exit.travelMinutes = 50;
  const result = planTrip(trip);
  assert.equal(result.summary.status, 'blocked');
  assert.ok(!result.timeline.some(item => item.type === 'exit'));
  assert.ok(result.unmet.some(message => message.includes('沿途恢复点')));
});

test('恢复点单程12分钟的往返分属不同连续活动段，可按实际路程完成', () => {
  const trip = fixture(); trip.recovery.travelMinutes = 12; trip.activities[0].duration = 30;
  const result = planTrip(trip);
  assert.equal(result.summary.status, 'ready');
  assert.equal(result.timeline.filter(item => item.type === 'activity').reduce((sum, item) => sum + item.duration, 0), 30);
  verifyTimeline(result);
});

test('超长延误不输出次日冒充同日的时间，重复已完成标记不污染状态', () => {
  const trip = fixture(); trip.start = '20:00'; trip.end = '23:00';
  const result = planTrip(trip, { delayMinutes: 720 });
  assert.equal(result.summary.status, 'blocked');
  assert.ok(result.unmet.some(message => message.includes('次日')));
  assert.ok(result.summary.start <= '23:59');
  const normal = fixture(); normal.activities.push({ ...normal.activities[0], id: 'b', name: '其他活动', duration: 10 });
  const repeated = planTrip(normal, { completedIds: ['a', 'a'], now: '11:00' });
  assert.deepEqual(repeated.summary.knownCompletedIds, ['a']);
  assert.deepEqual(repeated.summary.scheduledIds, ['b']);
});

test('当前时间之后追加延误，不吞掉继续旅行时的延误', () => {
  const trip = fixture();
  const result = planTrip(trip, { now: '11:00', delayMinutes: 30 });
  assert.equal(result.summary.start, '11:30');
  assert.equal(result.summary.status, 'ready');
  assert.equal(result.timeline[0].start, '11:30');
  verifyTimeline(result);
});

test('活动数量上限20项，与界面约定一致', () => {
  const trip = fixture();
  trip.activities = Array.from({ length: 21 }, (_, index) => ({ ...trip.activities[0], id: String(index) }));
  assert.ok(validateTrip(trip).some(message => message.includes('1—20')));
});
