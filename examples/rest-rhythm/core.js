/** 单日旅行准备；所有路程和现场属性均来自使用者输入。 */
const FORMAT = 'rest-rhythm';
const VERSION = 1;
const LIMIT = 200000;
const timeValue = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : NaN;
const timeLabel = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const text = (value, limit = 2000) => typeof value === 'string' && value.length <= limit;

function unsafeObject(value, depth = 0, counter = { value: 0 }) {
  if (++counter.value > 10000 || depth > 12) return true;
  if (!value || typeof value !== 'object') return false;
  if (Object.keys(value).some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) return true;
  return Object.values(value).some(child => unsafeObject(child, depth + 1, counter));
}

export function validateTrip(trip) {
  const errors = [];
  if (!object(trip) || unsafeObject(trip)) return ['旅行数据格式不正确，或包含不安全的字段。'];
  for (const [key, label] of [['title', '旅行名称'], ['city', '城市']]) {
    if (!text(trip[key], 120) || !trip[key].trim()) errors.push(`请填写${label}（最多120字）。`);
  }
  if (!text(trip.date, 10) || !/^\d{4}-\d{2}-\d{2}$/.test(trip.date) || Number.isNaN(Date.parse(`${trip.date}T00:00:00Z`)) || new Date(`${trip.date}T00:00:00Z`).toISOString().slice(0, 10) !== trip.date) errors.push('请选择有效的旅行日期。');
  const start = timeValue(trip.start), end = timeValue(trip.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) errors.push('请填写同一天内的起止时间，结束必须晚于开始；暂不支持跨午夜。');
  if (!Array.isArray(trip.people) || trip.people.length < 1 || trip.people.length > 4) errors.push('旅行者人数必须为1—4人。');
  else trip.people.forEach((person, index) => {
    if (!object(person)) { errors.push(`第${index + 1}位旅行者格式不正确。`); return; }
    if (!text(person.name, 80) || !person.name.trim()) errors.push(`请填写第${index + 1}位旅行者姓名。`);
    if (!number(person.maxActive, 1, 480)) errors.push(`第${index + 1}位旅行者连续活动时间必须为1—480分钟整数。`);
    if (!number(person.restMinutes, 1, 240)) errors.push(`第${index + 1}位旅行者恢复时间必须为1—240分钟整数。`);
    for (const key of ['needsSeat', 'needsAlone', 'avoidDim', 'needsQuiet']) if (person[key] !== undefined && typeof person[key] !== 'boolean') errors.push(`第${index + 1}位旅行者的恢复条件格式不正确。`);
  });
  if (!Array.isArray(trip.activities) || trip.activities.length < 1 || trip.activities.length > 20) errors.push('请填写1—20项活动。');
  else {
    const ids = new Set();
    trip.activities.forEach((activity, index) => {
      const label = `第${index + 1}项活动`;
      if (!object(activity)) { errors.push(`${label}格式不正确。`); return; }
      if (!text(activity.id, 80) || !activity.id.trim() || ids.has(activity.id)) errors.push(`${label}需要不重复的标识。`);
      ids.add(activity.id);
      if (!text(activity.name, 120) || !activity.name.trim()) errors.push(`请填写${label}名称。`);
      if (!number(activity.duration, 1, 720)) errors.push(`${label}时长必须为1—720分钟整数。`);
      if (!number(activity.travelMinutes, 0, 480)) errors.push(`${label}转场必须为0—480分钟整数。`);
      for (const key of ['required', 'indoor']) if (typeof activity[key] !== 'boolean') errors.push(`${label}的必做/室内选项格式不正确。`);
      for (const key of ['opens', 'closes']) if (activity[key] !== undefined && activity[key] !== '' && !Number.isFinite(timeValue(activity[key]))) errors.push(`${label}开放时间格式应为HH:MM。`);
      if (activity.opens && activity.closes && timeValue(activity.closes) <= timeValue(activity.opens)) errors.push(`${label}关闭时间必须晚于开放时间。`);
      for (const key of ['source', 'notes']) if (activity[key] !== undefined && !text(activity[key])) errors.push(`${label}说明或来源过长。`);
    });
  }
  const checkRecovery = (recovery, label) => {
    if (recovery === null || recovery === undefined) return;
    if (!object(recovery)) { errors.push(`${label}格式不正确。`); return; }
    if (!text(recovery.name, 120) || !recovery.name.trim()) errors.push(`请填写${label}名称。`);
    if (!number(recovery.travelMinutes, 0, 480)) errors.push(`${label}单程路程必须为0—480分钟整数。`);
    for (const key of ['seat', 'alone']) if (!['yes', 'no', 'unknown'].includes(recovery[key])) errors.push(`${label}座位和独处条件必须选择有、无或未知。`);
    if (!['normal', 'dim', 'unknown'].includes(recovery.light)) errors.push(`${label}光照条件必须选择正常、昏暗或未知。`);
    if (!['quiet', 'busy', 'unknown'].includes(recovery.noise)) errors.push(`${label}声音条件必须选择安静、嘈杂或未知。`);
    for (const key of ['source', 'verifiedAt', 'notes']) if (recovery[key] !== undefined && !text(recovery[key])) errors.push(`${label}说明、核验日期或来源过长。`);
  };
  checkRecovery(trip.recovery, '主恢复点');
  checkRecovery(trip.backupRecovery, '备用恢复点');
  if (!object(trip.exit) || !text(trip.exit.name, 120) || !trip.exit.name.trim() || !number(trip.exit.travelMinutes, 0, 480)) errors.push('请填写出口/返回地点，以及0—480分钟整数的返回路程。');
  else if (trip.exit.notes !== undefined && !text(trip.exit.notes)) errors.push('退出说明过长。');
  return [...new Set(errors)];
}

function recoveryFailures(recovery, people) {
  if (!recovery) return ['未填写可用恢复点'];
  const failures = [];
  if (people.some(person => person.needsSeat) && recovery.seat !== 'yes') failures.push('坐下恢复条件未满足或未知');
  if (people.some(person => person.needsAlone) && recovery.alone !== 'yes') failures.push('独处条件未满足或未知');
  if (people.some(person => person.avoidDim) && recovery.light !== 'normal') failures.push('正常光照条件未满足或未知');
  if (people.some(person => person.needsQuiet) && recovery.noise !== 'quiet') failures.push('安静条件未满足或未知');
  return failures;
}

export function planTrip(trip, disruption = {}) {
  const validation = validateTrip(trip);
  const empty = { timeline: [], warnings: [], unmet: validation, summary: { status: 'blocked', completedIds: [], skippedIds: [], start: trip?.start || '', end: trip?.start || '', totalMinutes: 0 } };
  if (validation.length) return empty;
  if (!object(disruption) || unsafeObject(disruption)) return { ...empty, unmet: ['变化情境格式不正确。'] };
  const delay = disruption.delayMinutes ?? 0;
  if (!number(delay, 0, 720) || (disruption.now && !Number.isFinite(timeValue(disruption.now))) || (disruption.earlyEnd && !Number.isFinite(timeValue(disruption.earlyEnd))) || (disruption.completedIds !== undefined && (!Array.isArray(disruption.completedIds) || disruption.completedIds.some(id => typeof id !== 'string' || !trip.activities.some(activity => activity.id === id)))) || ['rain', 'unavailableRecovery'].some(key => disruption[key] !== undefined && typeof disruption[key] !== 'boolean')) return { ...empty, unmet: ['请检查延误分钟、当前时间、提前结束时间和已完成活动。'] };
  const timeline = [], warnings = [], unmet = [];
  const activeLimit = Math.min(...trip.people.map(person => person.maxActive));
  const restMinutes = Math.max(...trip.people.map(person => person.restMinutes));
  const rawStart = Math.max(timeValue(trip.start), disruption.now ? timeValue(disruption.now) : 0) + delay;
  const start = Math.min(rawStart, 1439);
  const end = Math.min(timeValue(trip.end), disruption.earlyEnd ? timeValue(disruption.earlyEnd) : 1440);
  let now = start, active = 0;
  const completedIds = [...new Set(disruption.completedIds || [])], skippedIds = [];
  const knownCompletedIds = [...completedIds];
  const remaining = trip.activities.filter(activity => !completedIds.includes(activity.id));
  warnings.push('这是基于自填资料和路程估计的准备方案；空座、独处、现场声音、开放和路线都不作实时保证。');
  warnings.push('活动转场从上一地点估计；恢复点单程路程统一用于每项活动的往返，出口路程统一用于各地点返回。请逐段核对实际距离。');
  if (delay) warnings.push(`出发延误${delay}分钟，已重排剩余活动。`);
  if (completedIds.length) warnings.push('已完成活动不会再次安排；此前消耗未知，剩余行程先到恢复点完成一次恢复。');
  if (disruption.rain) warnings.push('雨天情境会移除室外活动；室内标记由使用者填写，交通仍需现场核对。');
  if (disruption.earlyEnd) warnings.push(`已按${disruption.earlyEnd}提前返回重排；返回路程保留在时限内。`);
  let recovery = disruption.unavailableRecovery ? trip.backupRecovery : trip.recovery;
  let failures = recoveryFailures(recovery, trip.people);
  if (failures.length && !disruption.unavailableRecovery && trip.backupRecovery && !recoveryFailures(trip.backupRecovery, trip.people).length) {
    recovery = trip.backupRecovery; failures = []; warnings.push('主恢复点不满足硬条件，已改用备用恢复点。');
  }
  if (disruption.unavailableRecovery) warnings.push(recovery ? '主恢复点不可用，已尝试备用恢复点。' : '主恢复点不可用，且没有备用恢复点。');
  if (recovery && !recovery.source?.trim()) warnings.push('恢复点没有记录来源；请在出发前补充核验依据。');
  if (recovery && !recovery.verifiedAt?.trim()) warnings.push('恢复点没有核验日期；请在出发前确认信息仍适用。');
  if (recovery && ['seat', 'alone', 'light', 'noise'].some(key => recovery[key] === 'unknown')) warnings.push('恢复点部分条件未知；未作为硬条件的未知仍需自行核对。');
  if (rawStart >= 1440) unmet.push('延误已使出发跨入次日；单日方案无法满足，请修改日期或出发时间。');
  if (start + trip.exit.travelMinutes > end) unmet.push('当前时间或延误已使返回路程超出结束时限，无法给出满足时限的行程。');
  if (trip.exit.travelMinutes > activeLimit) unmet.push('返回路程本身超过最严格连续活动上限，需要另一个沿途恢复点或更短的退出路线。');
  if (remaining.length && failures.length) unmet.push(`恢复点不可用：${failures.join('；')}。请补齐或更换恢复点再安排活动。`);
  const reserve = Math.max(recovery?.travelMinutes || 0, trip.exit.travelMinutes);
  const add = (type, name, duration, notes = '', activityId) => {
    if (!duration) return;
    timeline.push({ type, name, start: timeLabel(now), end: timeLabel(now + duration), duration, notes, ...(activityId ? { activityId } : {}) });
    now += duration;
    if (type !== 'recovery') active += duration;
  };
  const canSpend = duration => now + duration + trip.exit.travelMinutes <= end;
  const rest = (context, minimumDuration = restMinutes) => {
    const route = recovery.travelMinutes;
    if (active + route > activeLimit) return '到恢复点的路程会超过连续活动上限';
    if (route + reserve >= activeLimit) return '恢复点往返太长，恢复后没有安全活动余量';
    if (!canSpend(route * 2 + minimumDuration)) return '恢复及往返后已没有足够时间按时返回';
    add('travel', `前往${recovery.name}`, route, `从${context}前往恢复点，计入连续活动。`);
    add('recovery', `在${recovery.name}恢复`, minimumDuration, '按同行者最长恢复时长安排；现场条件需要再次确认。');
    active = 0;
    add('travel', `返回${context}`, route, '恢复点返回活动地点，计入下一段连续活动。');
    return '';
  };
  let stopped = unmet.length > 0;
  if (!stopped && completedIds.length && remaining.length) {
    const failure = rest('当前地点');
    if (failure) { unmet.push(`继续行程前恢复失败：${failure}。`); stopped = true; }
  }
  for (const activity of remaining) {
    if (stopped) { skippedIds.push(activity.id); if (activity.required) unmet.push(`必做活动「${activity.name}」未完成。`); continue; }
    if (disruption.rain && !activity.indoor) {
      skippedIds.push(activity.id);
      (activity.required ? unmet : warnings).push(`${activity.required ? '必做' : '可选'}活动「${activity.name}」因雨天未安排，请选择可接受的室内替代。`);
      continue;
    }
    const snapshot = { now, active, length: timeline.length };
    let failed = '';
    const deadline = Math.min(end - trip.exit.travelMinutes, activity.closes ? timeValue(activity.closes) : 1440);
    if (active + activity.travelMinutes + reserve >= activeLimit) failed = rest('上一地点');
    if (!failed && activity.travelMinutes + active + reserve >= activeLimit) failed = '转场及安全返回余量超过连续活动上限';
    if (!failed && !canSpend(activity.travelMinutes)) failed = '转场后没有时间按时返回';
    if (!failed) add('travel', `前往${activity.name}`, activity.travelMinutes, '转场计入连续活动。', activity.id);
    const opens = activity.opens ? timeValue(activity.opens) : now;
    if (!failed && now < opens) {
      const waiting = opens - now;
      if (active + waiting + reserve < activeLimit && canSpend(waiting)) add('wait', `等待${activity.name}开放`, waiting, '没有确认可坐下的等候条件，因此等待计入连续活动。', activity.id);
      else {
        // 在已填写的恢复点等候，来回路程均保留；不能凭空在活动地点恢复。
        failed = rest(activity.name, Math.max(restMinutes, opens - now - recovery.travelMinutes * 2));
      }
    }
    let remainingDuration = activity.duration;
    while (!failed && remainingDuration > 0) {
      let capacity = activeLimit - active - reserve;
      if (capacity <= 0) { failed = rest(activity.name); capacity = activeLimit - active - reserve; }
      if (failed) break;
      if (capacity <= 0) { failed = '恢复点往返后没有活动余量'; break; }
      const chunk = Math.min(remainingDuration, capacity);
      if (now + chunk > deadline || !canSpend(chunk)) { failed = '活动或中途恢复无法在开放时间和返回时限内完成'; break; }
      add('activity', activity.name, chunk, remainingDuration > chunk ? '长活动分段；随后往返恢复点。' : (activity.notes || ''), activity.id);
      remainingDuration -= chunk;
      if (remainingDuration > 0) failed = rest(activity.name);
    }
    if (failed) {
      // 排程只承诺能完整执行的活动；失败试排不能留下虚假的部分成功。
      now = snapshot.now; active = snapshot.active; timeline.length = snapshot.length;
      skippedIds.push(activity.id);
      (activity.required ? unmet : warnings).push(`${activity.required ? '必做' : '可选'}活动「${activity.name}」未完成：${failed}。`);
      if (activity.required) stopped = true;
    } else completedIds.push(activity.id);
  }
  if (now + trip.exit.travelMinutes <= end && active + trip.exit.travelMinutes <= activeLimit) add('exit', `返回${trip.exit.name}`, trip.exit.travelMinutes, trip.exit.notes || '停止探索，按已核对的返回路线离开。');
  else if (!unmet.some(message => message.includes('返回路程'))) unmet.push('无法在当前时间与连续活动上限内返回；需缩短退出路线或现场取得帮助，不能视为可执行方案。');
  if (!timeline.some(item => item.type === 'exit') && trip.exit.travelMinutes === 0) timeline.push({ type: 'exit', name: `返回${trip.exit.name}`, start: timeLabel(now), end: timeLabel(now), duration: 0, notes: trip.exit.notes || '返回点与当前位置相同；请核对这一输入。' });
  const scheduledIds = completedIds.filter(id => !knownCompletedIds.includes(id));
  return { timeline, warnings: [...new Set(warnings)], unmet: [...new Set(unmet)], summary: { status: unmet.length ? (scheduledIds.length > 0 ? 'partial' : 'blocked') : 'ready', activeLimit, restMinutes, completedIds, knownCompletedIds, scheduledIds, skippedIds, recoveryName: recovery?.name || '', start: timeLabel(start), end: timeLabel(now), totalMinutes: now - start } };
}

export function serializeTrip(trip) {
  const errors = validateTrip(trip);
  if (errors.length) throw new Error(errors.join('\n'));
  const json = JSON.stringify({ format: FORMAT, version: VERSION, trip }, null, 2);
  if (new TextEncoder().encode(json).length > LIMIT) throw new Error('旅行数据超过200KB，请缩短说明或移除多余字段。');
  return json;
}

export function parseTrip(json) {
  if (typeof json !== 'string' || new TextEncoder().encode(json).length > LIMIT) throw new Error('导入内容必须是小于200KB的JSON文本。');
  let value;
  try { value = JSON.parse(json); } catch { throw new Error('JSON无法读取，请检查文件是否完整。'); }
  if (!object(value) || unsafeObject(value)) throw new Error('导入文件包含不安全字段或嵌套过深。');
  if (value.format !== FORMAT || value.version !== VERSION) throw new Error('导入文件不是本产品支持的第1版旅行数据。');
  const errors = validateTrip(value.trip);
  if (errors.length) throw new Error(errors.join('\n'));
  // JSON文本仅作为数据返回；展示层必须使用textContent，禁止作为HTML执行。
  return value.trip;
}
