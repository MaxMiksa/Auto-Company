// 以下参数和成本是合成规划示例，未经真实房间测量，也不是商家报价。
export const DEFAULT_PROFILE = Object.freeze({
  name: '示例房间（合成数据）', goal: 'heat', width: 120, height: 150,
  windowType: 'sliding', permission: 'none', surface: 'unknown', escape: true,
  ventilation: true, budget: 600, electricity: 0.6, hours: 6, days: 90,
  laborRate: 30, moveCount: 1, nextWidth: null, nextHeight: null,
  glass: 'unknown', hasFan: true, hasCurtain: false, rentalMonths: 12,
  temperature: null, humidity: null, risk: 'none', safetyConfirmed: false, filmCompatible: false,
});

const IDS = ['existing', 'fan', 'curtain', 'seal', 'film', 'insert'];
const COMPONENTS = ['materials', 'delivery', 'installation', 'energy', 'rework', 'moving'];
const ENUMS = {
  goal: ['heat', 'cold', 'glare'], windowType: ['sliding', 'casement', 'fixed'],
  permission: ['none', 'adhesive', 'drill'], surface: ['sound', 'fragile', 'unknown'],
  glass: ['unknown', 'single', 'double'], risk: ['none', 'damp', 'hot', 'electrical'],
};
const RANGES = {
  width: [20, 400], height: [20, 400], budget: [0, 1000000],
  electricity: [0, 100], hours: [0, 24], days: [1, 366],
  laborRate: [0, 10000], moveCount: [0, 10], rentalMonths: [1, 120],
};
const OPTIONAL_RANGES = {
  nextWidth: [20, 400], nextHeight: [20, 400], temperature: [-10, 60], humidity: [0, 100],
};
const LABELS = {
  name: '房间名称', goal: '改善目标', width: '窗宽', height: '窗高',
  windowType: '窗型', permission: '安装许可', surface: '表面状态', escape: '逃生窗口用途',
  ventilation: '主要通风窗口用途', budget: '总预算', electricity: '电价', hours: '每天运行时长',
  days: '运行天数', laborRate: '工时成本', moveCount: '搬迁次数',
  nextWidth: '下个房间窗宽', nextHeight: '下个房间窗高', glass: '玻璃类型',
  hasFan: '已有风扇', hasCurtain: '已有窗帘', rentalMonths: '剩余租期',
  temperature: '室温', humidity: '湿度', risk: '房间风险',
};
const optional = value => value === null || value === undefined || value === '';
const finiteRange = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const round = value => Math.round(value * 100) / 100;

export function validateProfile(profile) {
  const errors = [];
  if (!object(profile)) return { ok: false, errors: ['房间资料必须是对象。'] };
  if (typeof profile.name !== 'string' || !profile.name.trim() || profile.name.length > 120) errors.push('房间名称须为 1–120 个字符。');
  for (const [key, choices] of Object.entries(ENUMS)) {
    if (!choices.includes(profile[key])) errors.push(`${LABELS[key]}不是支持的选项。`);
  }
  for (const [key, [min, max]] of Object.entries(RANGES)) {
    if (!finiteRange(profile[key], min, max)) errors.push(`${LABELS[key]}须为 ${min}–${max} 之间的有限数字。`);
  }
  for (const key of ['days', 'moveCount', 'rentalMonths']) {
    if (!Number.isInteger(profile[key])) errors.push(`${LABELS[key]}须为整数。`);
  }
  for (const [key, [min, max]] of Object.entries(OPTIONAL_RANGES)) {
    if (!optional(profile[key]) && !finiteRange(profile[key], min, max)) errors.push(`${LABELS[key]}须留空或填写 ${min}–${max} 之间的数字。`);
  }
  if (optional(profile.nextWidth) !== optional(profile.nextHeight)) errors.push('下个房间的窗宽和窗高须同时填写或同时留空。');
  for (const key of ['escape', 'ventilation', 'hasFan', 'hasCurtain']) {
    if (typeof profile[key] !== 'boolean') errors.push(`${LABELS[key]}须选择是或否。`);
  }
  for (const key of ['safetyConfirmed', 'filmCompatible']) {
    if (profile[key] !== undefined && typeof profile[key] !== 'boolean') errors.push('现场安全与玻璃兼容确认须为布尔状态。');
  }
  return { ok: errors.length === 0, errors };
}

function cost(materials, delivery, hours, watts, rework, moveHours, profile) {
  const result = {
    materials, delivery, installation: hours * profile.laborRate,
    energy: watts / 1000 * profile.hours * profile.days * profile.electricity,
    rework, moving: profile.moveCount * (moveHours * profile.laborRate + materials * 0.1),
  };
  for (const key of COMPONENTS) result[key] = round(result[key]);
  result.total = round(COMPONENTS.reduce((sum, key) => sum + result[key], 0));
  return result;
}

function overrideCost(base, override) {
  const result = { ...base };
  if (object(override)) {
    for (const key of COMPONENTS) {
      if (finiteRange(override[key], 0, 1000000)) result[key] = round(override[key]);
    }
  }
  result.total = round(COMPONENTS.reduce((sum, key) => sum + result[key], 0));
  return result;
}

export function buildPlan(profile, costOverrides = {}) {
  const validation = validateProfile(profile);
  if (!object(costOverrides)) validation.errors.push('成本覆盖须为对象。');
  else for (const id of IDS) {
    const override = costOverrides[id];
    if (override === undefined) continue;
    if (!object(override)) { validation.errors.push('方案成本覆盖结构无效。'); continue; }
    for (const key of COMPONENTS) if (override[key] !== undefined && !finiteRange(override[key], 0, 1000000)) validation.errors.push('费用须为 0–1000000 之间的有限数字，不接受空值或缺失金额。');
  }
  validation.ok = validation.errors.length === 0;
  if (!validation.ok) return { blocked: true, warnings: validation.errors, candidates: [], recommendedId: null, checklist: [] };
  const warnings = ['所有金额均为可修改的规划估算；效果、安装安全和搬迁复用须现场核验，不能据此保证降温或节能。', '完整成本含劳动机会成本，并非全是本次现金支出；示例默认已有工具，新增工具须填入安装项，税费须纳入材料或运输，拆除恢复与损耗须纳入返工预留。'];
  const blocked = profile.risk !== 'none';
  if ((profile.escape || profile.ventilation) && !profile.safetyConfirmed) warnings.push('该窗承担逃生或主要通风用途：相关窗体加装须先核实完整开启与通道，不能因可拆卸而视为安全。');
  if (profile.risk === 'damp') warnings.push('存在潮湿、漏水或霉变风险：先由房东或合适的专业人员排查原因，不用密封覆盖问题。');
  if (profile.risk === 'electrical') warnings.push('存在电气风险：暂停使用相关设备，先安排合格人员排查。');
  if (profile.risk === 'hot') warnings.push('存在过热风险：优先离开危险环境并安排适当帮助，房间改善规划不能替代及时处置。');
  if (!optional(profile.temperature) && profile.temperature >= 35) warnings.push('输入室温较高；不能依赖风扇保证安全或只按舒适评分判断风险。');
  if (!optional(profile.humidity) && profile.humidity >= 60) warnings.push('湿度较高：记录潮湿来源和持续时间，先排查漏水与霉变，不承诺靠帘或密封解决；单个读数不等于霉变诊断。');
  if (!profile.safetyConfirmed) warnings.push('尚未核实现场开启、通风、逃生和燃烧设备供气：密封、玻璃膜及内窗暂停在待确认，不自动放行。');
  if (profile.surface !== 'sound') warnings.push('表面状态不确定或脆弱：粘贴方案须先在隐蔽处小范围测试，仍可能损伤饰面。');
  if (profile.moveCount && optional(profile.nextWidth)) warnings.push('下个房间尺寸未知：搬迁适配费用仅是预留，不能确认可复用。');
  const area = profile.width * profile.height / 10000;
  const sameSize = !optional(profile.nextWidth) && Math.abs(profile.width - profile.nextWidth) <= 5 && Math.abs(profile.height - profile.nextHeight) <= 5;
  const candidates = [
    {
      id: 'existing', title: '先调整已有物品与使用时段', status: 'eligible',
      reason: profile.risk !== 'none' ? '零采购排查流程：记录异常，停止相关设备或安装，处理风险后重新规划。' : profile.goal === 'heat' ? '先避开直射、移动座位；仅在室外更凉且条件允许时通风。' : profile.goal === 'cold' ? '远离冷窗，调整座位、衣物和已有帘的使用。' : '改变屏幕和座位角度，调整已有遮挡，先观察眩光来源。',
      steps: profile.risk !== 'none' ? ['记录异常并暂停安装或异常设备；高温不适优先离开危险环境。', '联系房东或合适专业人员排查水源、电气或过热原因，不自行拆电路或覆盖霉斑。', '问题处理后重新填写风险和现场确认，再比较改善方案。'] : ['记录改善前的室内外条件与体感。', '一次只改变一项，保留通风与逃生通道；天气、空气质量或安防不适合时不自动开窗。', '在相似时段复测，效果不足再考虑采购。'],
      rollback: ['恢复座位和已有物品位置；发现不适或通道受阻立即停止。'],
      move: '不涉及固定安装；新房间需重新观察朝向、直射和通道。', reuse: '已有物品能否复用取决于其尺寸与完好程度。',
      evidence: '低成本试用基线；CBE 原有合成实验提示辐射会影响舒适判断，未验证真实房间效果。',
      watts: 0, cost: cost(0, 0, profile.risk !== 'none' ? 0 : 0.25, 0, 0, 0, profile),
    },
    {
      id: 'fan', title: profile.hasFan ? '试用已有风扇' : '独立放置的风扇', status: profile.goal === 'heat' ? 'eligible' : 'excluded',
      reason: profile.goal === 'heat' ? '气流可能改善体感；风扇不等同于降低室温。' : '风扇不针对当前保暖或眩光目标。',
      steps: ['检查设备、线缆和插座完好，保持干燥与通道畅通；摆放不影响窗扇开启与逃生。', '低档短时试用，记录实际功率或按设备铭牌更新耗电。', '持续记录体感；高温或不适时停止并寻求合适帮助。'],
      rollback: ['关闭并拔除设备，收好线缆；不改动窗体或电路。'],
      move: '搬迁前断电、清洁和包装；新房间重新检查插座与摆位。', reuse: '尺寸限制较少，仍需检查设备寿命、运输与插座条件。',
      evidence: '美国能源部 Energy Saver 将风扇作用描述为人体的气流冷却；无本产品实测功效。',
      watts: 35, cost: cost(profile.hasFan ? 0 : 160, profile.hasFan ? 0 : 15, 0.25, 35, profile.hasFan ? 10 : 20, 0.25, profile),
    },
    {
      id: 'curtain', title: '独立支架内遮帘', status: profile.width > 240 ? 'conditional' : 'eligible',
      reason: profile.width > 240 ? '跨度较大，需确认支架承重与稳定性；不能直接套用示例规格。' : '减少直射、眩光或冷窗辐射暴露的试用路径；不承诺具体温差。',
      steps: ['核查自立支架尺寸、承重和防倾倒说明，避开取暖器。', '保留窗扇开合、通风与逃生空间，安装前确认布料要求。', '先短时试用遮挡，对比相似条件下的体感和光照。'],
      rollback: ['拆下帘布和支架，恢复通道；不在未知墙面上施加粘贴或钻孔。'],
      move: sameSize ? '下个房间尺寸相近仍须重测支架范围与通道，拆装工时已预留。' : '拆装后重测；新窗尺寸可能需要换帘布或支架，不能保证复用。',
      reuse: '优先可调支架；实际复用取决于调节范围、稳定性与布料尺寸。',
      evidence: '美国能源部 Energy Saver 的窗户覆盖物资料说明遮挡受材质、安装与使用影响；不支持统一降温保证。',
      watts: 0, cost: cost((profile.hasCurtain ? 100 : 180) + area * 25, 20, 1.5, 0, 40, 1, profile),
    },
    {
      id: 'seal', title: '可移除的缝隙密封试装', status: profile.permission === 'none' || profile.windowType === 'fixed' || profile.goal === 'glare' ? 'excluded' : profile.safetyConfirmed && profile.surface === 'sound' ? 'eligible' : 'conditional',
      reason: profile.permission === 'none' ? '没有粘贴许可，排除粘贴密封。' : profile.windowType === 'fixed' ? '固定窗没有可确认的开合缝隙，不以通用密封条替代漏水或结构排查。' : profile.goal === 'glare' ? '缝隙密封不针对当前眩光目标。' : '仅针对已确认漏风缝隙；不得封堵排水孔、必要通风或逃生窗。',
      steps: ['未核实现场安全时不施工：先确认漏风点、燃烧设备供气与排水通风结构，取得具体位置许可。', '不封堵排水孔、进排气口、烟道或供气；在隐蔽处测试小段粘贴与移除，脆弱表面停止。', '保留完整开合路径和逃生空间，短期检查结露、残胶与窗扇运行。'],
      rollback: ['依厂家说明移除；出现残胶、涂层损伤或结露时停止并记录返工。'],
      move: '拆除的粘贴条通常需要重新采购；新窗重新测量缝隙，不能视为可重复安装。', reuse: '低复用；只将可保留工具计入复用，不保证密封条再用。',
      evidence: '美国能源部气密与 weatherstripping 指引以识别漏风为前提；本产品不验证实际气密量。',
      watts: 0, cost: cost(25 + 2 * (profile.width + profile.height) / 100 * 6, 10, 1, 0, 35, 0.75, profile),
    },
    {
      id: 'film', title: '经玻璃兼容性确认的窗膜', status: profile.permission === 'none' || profile.goal === 'cold' ? 'excluded' : profile.glass !== 'unknown' && profile.filmCompatible && profile.safetyConfirmed ? 'eligible' : 'conditional',
      reason: profile.permission === 'none' ? '没有粘贴许可，排除窗膜。' : profile.goal === 'cold' ? '未提供保暖性能依据，不将普通太阳控制膜推荐为保暖方案。' : profile.glass === 'unknown' ? '玻璃类型未知，暂停安装，须确认具体玻璃与膜兼容性。' : profile.filmCompatible && profile.safetyConfirmed ? '使用者已确认厂家兼容及现场通道；仍须核对热应力、原窗保修与冬季得热取舍。' : '需厂家确认玻璃、朝向、膜型号、保修与热应力兼容性，现场确认前不要安装。',
      steps: ['条件未确认时不施工：取得玻璃与膜厂家的明确兼容及保修说明，并核对租约许可。', '保持窗扇完整开启与通风逃生通道，保留厂家要求边缘；玻璃裂损时停止安装。', '保存型号、批次、安装与移除说明，记录冬季得热、采光取舍，试用后记录眩光和体感。'],
      rollback: ['按厂家说明移除；残胶、玻璃损伤和清理工时可能超出预留。'],
      move: '已贴膜不计搬迁复用；新玻璃重新确认兼容性并重新采购。', reuse: '通常不能将已贴窗膜移到新窗；仅保留工具和记录。',
      evidence: '玻璃兼容性与热应力需具体厂商确认；没有特定膜的真实性能或质保数据。',
      watts: 0, cost: cost(area * 90, 15, 2, 0, 100, 1.5, profile),
    },
    {
      id: 'insert', title: '专业复核的定制内窗', status: profile.permission !== 'drill' || profile.goal === 'glare' ? 'excluded' : 'conditional',
      reason: profile.permission !== 'drill' ? '当前许可不足，本产品不授权零钻条件下安装定制内窗。' : profile.goal === 'glare' ? '没有定制内窗的眩光控制性能资料，不能按当前目标推荐。' : '需要现场尺寸、连接方式、承重、结露与逃生复核；定制费用和搬迁适配风险较高。',
      steps: ['先取得房东对具体安装方案的书面许可；未专业复核不施工。', '由合适人员确认尺寸、固定方式、玻璃与完整开启、逃生通风及燃烧设备供气，不封堵烟道或排水。', '取得包含运输、工具、安装、恢复和搬迁限制的完整费用后再决定。'],
      rollback: ['按安装方案拆除并恢复连接部位，预留专业拆装与饰面修复。'],
      move: sameSize ? '尺寸相近不等于适配：仍需重测窗框与连接位置，由合适人员确认。' : '定制尺寸可能无法用于新窗，需计重新定制和处置费用。',
      reuse: '未知；没有下一房间现场测量与安装确认时不能承诺复用。',
      evidence: '只有具体产品性能资料与现场安装复核才能支撑效能判断；示例成本并非承包或履约服务。',
      watts: 0, cost: cost(area * 650 + 300, 100, 4, 0, 250, 3, profile),
    },
  ];
  for (const candidate of candidates) {
    candidate.cost = overrideCost(candidate.cost, object(costOverrides) ? costOverrides[candidate.id] : undefined);
    if (candidate.id === 'seal' && profile.surface === 'fragile' && candidate.status !== 'excluded') {
      candidate.status = 'excluded'; candidate.reason = '表面脆弱，排除粘贴密封，先处理表面与漏风原因。';
    }
    if (candidate.cost.total > profile.budget) {
      candidate.status = 'excluded'; candidate.reason += ` 全周期估算 ¥${candidate.cost.total.toFixed(2)} 超出预算 ¥${profile.budget.toFixed(2)}。`;
    }
    if ((profile.escape || profile.ventilation) && !profile.safetyConfirmed && !['existing', 'fan'].includes(candidate.id) && candidate.status !== 'excluded') {
      candidate.status = 'conditional'; candidate.reason += ' 该窗承担逃生或主要通风用途，须核实不妨碍完整开启、通风和通行，确认前暂停安装。';
    }
    if (profile.risk !== 'none' && candidate.id !== 'existing') {
      candidate.status = 'excluded'; candidate.reason = '存在房间风险，暂停相关设备与施工，先排查后再制定改善方案。';
    }
  }
  const eligible = candidates.filter(candidate => candidate.status === 'eligible').sort((a, b) => a.cost.total - b.cost.total);
  // 首先安排可撤回的观察基线，条件未确认的方案永不自动推荐。
  const recommendedId = eligible.find(candidate => candidate.id === 'existing')?.id ?? eligible[0]?.id ?? null;
  if (!blocked && !recommendedId) warnings.push('没有预算内且条件已满足的方案；可先调整预算或工时估算，不能把未确认方案当作可安装。');
  return {
    blocked, warnings, candidates, recommendedId,
    checklist: ['已测量窗宽、窗高并核对窗扇完整开启路径。', '通风、逃生和燃烧设备进排气通道始终畅通。', '租约、材料兼容与安装位置的许可已经确认。', '已将工具、税运、劳动估值、拆除恢复、损耗与搬迁计入费用。', '已记录改善前条件，明确停止和恢复步骤。', '安装后实际试开窗和检查通行，观察结露、松动与电气异常。', '已用相似条件复测，不把温差直接归因于方案。', '搬迁后重新核查权限、尺寸、表面、玻璃与通道，不沿用旧房安全批准。'],
  };
}

export function validateRecord(record) {
  const errors = [];
  if (!object(record)) return { ok: false, errors: ['测量记录必须是对象。'] };
  if (typeof record.id !== 'string' || !/^[\w-]{1,80}$/.test(record.id)) errors.push('记录标识须为 1–80 个字母、数字、下划线或短横线。');
  let validDate = false;
  if (typeof record.date === 'string' && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(record.date)) {
    const timestamp = Date.parse(`${record.date.length === 10 ? `${record.date}T00:00` : record.date}:00Z`);
    validDate = Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, record.date.length) === record.date;
  }
  if (!validDate) errors.push('记录日期时段须为有效的 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm。');
  if (!['before', 'after'].includes(record.phase)) errors.push('记录阶段须为改善前或改善后。');
  if (!finiteRange(record.temperature, -10, 60)) errors.push('室温须为 -10–60℃。');
  if (!finiteRange(record.humidity, 0, 100)) errors.push('湿度须为 0–100%。');
  if (!Number.isInteger(record.sensation) || !finiteRange(record.sensation, -3, 3)) errors.push('体感须为 -3–3 的整数。');
  if (!optional(record.outdoor) && !finiteRange(record.outdoor, -30, 60)) errors.push('室外温度须留空或填写 -30–60℃。');
  if (!optional(record.radiation) && !finiteRange(record.radiation, -10, 80)) errors.push('平均辐射温度须留空或填写 -10–80℃，不能用表面温度冒充。');
  if (typeof record.note !== 'string' || record.note.length > 500) errors.push('记录备注须为不超过 500 个字符的文字。');
  return { ok: errors.length === 0, errors };
}

export function summarizeTrial(records, target = 0) {
  const base = { status: 'insufficient', comparable: false, message: '', before: null, after: null, deltaTemperature: null, deltaSensation: null, deltaDistance: null };
  if (!finiteRange(target, -3, 3)) return { ...base, message: '舒适目标须在 -3–3 之间。' };
  if (!Array.isArray(records) || records.length > 500 || records.some(record => !validateRecord(record).ok)) return { ...base, message: '记录无效，请先修正记录再观察趋势。' };
  const average = (items, key) => round(items.reduce((sum, item) => sum + item[key], 0) / items.length);
  const describe = items => items.length ? { count: items.length, temperature: average(items, 'temperature'), humidity: average(items, 'humidity'), sensation: average(items, 'sensation'), distance: round(items.reduce((sum, item) => sum + Math.abs(item.sensation - target), 0) / items.length), outdoor: items.every(item => !optional(item.outdoor)) ? average(items, 'outdoor') : null } : null;
  const beforeRecords = records.filter(record => record.phase === 'before');
  const afterRecords = records.filter(record => record.phase === 'after');
  base.before = describe(beforeRecords); base.after = describe(afterRecords);
  if (beforeRecords.length < 2 || afterRecords.length < 2) return { ...base, message: '至少需要改善前、后各 2 条有效记录；当前样本不足，不能判断方向。' };
  base.deltaTemperature = round(base.after.temperature - base.before.temperature);
  base.deltaSensation = round(base.after.sensation - base.before.sensation);
  base.deltaDistance = round(base.after.distance - base.before.distance);
  if (base.before.outdoor === null || base.after.outdoor === null) return { ...base, status: 'incomparable', message: '室外温度记录不完整，条件不可比；室温差只作描述，不能归因于方案。' };
  // 每条前后记录的外温都须处在同一个 2℃ 区间，避免均值掩盖极端条件。
  const outdoor = records.map(record => record.outdoor);
  if (Math.max(...outdoor) - Math.min(...outdoor) > 2) return { ...base, status: 'incomparable', message: '前后室外温度范围相差超过 2℃，条件不可比；不可由温差判断效果。' };
  const direction = base.deltaDistance < 0 ? '体感平均更接近目标' : base.deltaDistance > 0 ? '体感平均更偏离目标' : '体感与目标的平均距离未变';
  return { ...base, status: 'comparable', comparable: true, message: `${direction}。这只是相似外温下的方向性观察；日照、湿度、时段和其他变化仍可能影响结果，不能证明因果或保证未来效果。` };
}

function hasUnsafeStructure(value, depth = 0) {
  if (depth > 12) return true;
  if (value === null || typeof value !== 'object') return false;
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== Array.prototype && Object.getPrototypeOf(value) !== null) return true;
  for (const key of Object.keys(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key) || hasUnsafeStructure(value[key], depth + 1)) return true;
  }
  return false;
}

export function validateBackup(data) {
  const errors = [];
  if (!object(data)) return { ok: false, errors: ['备份必须是 JSON 对象。'] };
  let serialized;
  try { serialized = JSON.stringify(data); } catch { return { ok: false, errors: ['备份结构不可读取。'] }; }
  if (!serialized || serialized.length > 500000 || hasUnsafeStructure(data)) return { ok: false, errors: ['备份过大或包含不安全结构。'] };
  if (data.version !== 1) errors.push('不支持的备份版本。');
  errors.push(...validateProfile(data.profile).errors);
  if (data.relocation !== undefined && data.relocation !== null) errors.push(...validateProfile(data.relocation).errors.map(error => `新房重评：${error}`));
  if (data.selectedId !== null && !IDS.includes(data.selectedId)) errors.push('所选方案标识无效。');
  if (!Array.isArray(data.records) || data.records.length > 500) errors.push('备份最多包含 500 条测量记录。');
  else {
    const ids = new Set();
    data.records.forEach((record, index) => {
      const checked = validateRecord(record);
      if (!checked.ok) errors.push(`第 ${index + 1} 条记录：${checked.errors.join(' ')}`);
      if (object(record)) {
        if (ids.has(record.id)) errors.push(`第 ${index + 1} 条记录的标识重复。`);
        ids.add(record.id);
      }
    });
  }
  if (!object(data.costOverrides)) errors.push('成本覆盖须为对象。');
  else for (const id of IDS) {
    const override = data.costOverrides[id];
    if (override === undefined) continue;
    if (!object(override)) { errors.push('方案成本覆盖结构无效。'); continue; }
    for (const key of COMPONENTS) if (override[key] !== undefined && !finiteRange(override[key], 0, 1000000)) errors.push('成本覆盖须为 0–1000000 之间的有限数字。');
  }
  if (!object(data.checklist) || Object.keys(data.checklist).length > 100 || Object.entries(data.checklist).some(([key, value]) => key.length > 160 || typeof value !== 'boolean')) errors.push('检查清单须为不超过 100 项的布尔状态。');
  if (typeof data.notes !== 'string' || data.notes.length > 4000) errors.push('方案备注不能超过 4000 个字符。');
  if (errors.length) return { ok: false, errors };
  const cleanProfile = source => Object.fromEntries(Object.keys(DEFAULT_PROFILE).map(key => [key, source[key] ?? (Object.hasOwn(OPTIONAL_RANGES, key) ? null : ['safetyConfirmed', 'filmCompatible'].includes(key) ? false : source[key])]));
  const profile = cleanProfile(data.profile);
  const records = data.records.map(record => Object.fromEntries(['id', 'date', 'phase', 'temperature', 'humidity', 'sensation', 'outdoor', 'radiation', 'note'].map(key => [key, record[key] ?? null])));
  const costOverrides = {};
  for (const id of IDS) if (object(data.costOverrides[id])) costOverrides[id] = Object.fromEntries(COMPONENTS.filter(key => data.costOverrides[id][key] !== undefined).map(key => [key, data.costOverrides[id][key]]));
  return { ok: true, errors: [], value: { version: 1, profile, selectedId: data.selectedId, records, costOverrides, checklist: { ...data.checklist }, notes: data.notes, relocation: data.relocation ? cleanProfile(data.relocation) : null } };
}

const markdown = value => String(value ?? '').replace(/\\/g, '\\\\').replace(/([`*_[\]#|])/g, '\\$1').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, ' ');

export function exportMarkdown(state) {
  const checked = validateBackup(state);
  if (!checked.ok) throw new Error(`无法导出：${checked.errors.join(' ')}`);
  const clean = checked.value;
  const plan = buildPlan(clean.profile, clean.costOverrides);
  const selected = plan.candidates.find(candidate => candidate.id === clean.selectedId);
  const trial = summarizeTrial(clean.records, 0);
  const lines = [
    `# ${markdown(clean.profile.name)}：可逆舒适改善计划`, '',
    '本文件是本地规划与观察记录，不是报价、施工许可、专业安全评估或实测效果承诺。', '',
    `目标：${{ heat: '减轻闷热', cold: '减轻冷感', glare: '减轻眩光' }[clean.profile.goal]}；窗尺寸：${clean.profile.width} × ${clean.profile.height} cm；总预算：¥${clean.profile.budget.toFixed(2)}。`,
    `安装许可：${{ none: '不允许粘贴或钻孔', adhesive: '允许粘贴，禁止钻孔', drill: '允许钻孔（仍须具体位置许可）' }[clean.profile.permission]}；剩余租期：${clean.profile.rentalMonths} 个月；预计搬迁：${clean.profile.moveCount} 次。`, '',
    '## 风险与限制', '', ...plan.warnings.map(warning => `- ${markdown(warning)}`), '',
    '## 全周期方案比较', '', '| 方案 | 状态 | 材料 | 运输 | 安装工时成本 | 耗电 | 返工 | 搬迁 | 总计 |', '|---|---|---:|---:|---:|---:|---:|---:|---:|',
    ...plan.candidates.map(candidate => `| ${markdown(candidate.title)} | ${{ eligible: '可试用', conditional: '需确认', excluded: '排除' }[candidate.status]} | ${COMPONENTS.map(key => `¥${candidate.cost[key].toFixed(2)}`).join(' | ')} | ¥${candidate.cost.total.toFixed(2)} |`), '',
    '## 已选方案', '',
  ];
  if (selected) {
    lines.push(`**${markdown(selected.title)}**（${{ eligible: '可试用', conditional: '需确认后才能安装', excluded: '已排除，暂停执行' }[selected.status]}）`, '', markdown(selected.reason), '', '执行：', ...selected.steps.map(step => `- ${markdown(step)}`), '', '撤回：', ...selected.rollback.map(step => `- ${markdown(step)}`), '', `搬迁：${markdown(selected.move)}`, `复用边界：${markdown(selected.reuse)}`, `依据：${markdown(selected.evidence)}`, '');
  } else lines.push('尚未选择可执行方案。', '');
  if (clean.relocation) {
    const next = buildPlan(clean.relocation);
    lines.push('## 新房独立重评', '', '旧房许可、安全结论、已填费用与原日记均不作为新房批准。新房默认预算若沿用原规划上限，仍须使用者确认。', '', `新房：${markdown(clean.relocation.name)}；窗尺寸：${clean.relocation.width} × ${clean.relocation.height} cm；预算：¥${clean.relocation.budget.toFixed(2)}。`, `新房权限：${{ none: '不允许粘贴或钻孔', adhesive: '允许粘贴，禁止钻孔', drill: '允许钻孔（仍须具体位置许可）' }[clean.relocation.permission]}；现场安全：${clean.relocation.safetyConfirmed ? '使用者已核实，仍非专业批准' : '待重新核实'}；膜兼容：${clean.relocation.filmCompatible ? '使用者已确认' : '待重新确认'}。`, '', ...next.warnings.map(warning => `- ${markdown(warning)}`), '', '| 新房方案 | 状态 | 新规划估算 | 适配与复用限制 |', '|---|---|---:|---|', ...next.candidates.map(item => `| ${markdown(item.title)} | ${{ eligible: '可试用', conditional: '需确认', excluded: '排除' }[item.status]} | ¥${item.cost.total.toFixed(2)} | ${markdown(item.reason)} ${markdown(item.reuse)} |`), '');
  }
  const checklist = [...plan.checklist, '试用后能正常开窗、通行，无松动、结露或新异常', '体感未改善或变差时停止，按回退顺序恢复原状'];
  lines.push('## 安装前检查', '', ...checklist.map((item, index) => `- [${clean.checklist[`${selected?.id}:${index}`] || clean.checklist[index] || clean.checklist[item] ? 'x' : ' '}] ${markdown(item)}`), '', '## 前后观察', '', markdown(trial.message), '', '| 日期 | 阶段 | 室温℃ | 湿度% | 体感 | 外温℃ | 辐射温度℃ | 备注 |', '|---|---|---:|---:|---:|---:|---:|---|', ...clean.records.map(record => `| ${record.date} | ${record.phase === 'before' ? '改善前' : '改善后'} | ${record.temperature} | ${record.humidity} | ${record.sensation} | ${record.outdoor ?? '未测'} | ${record.radiation ?? '未测'} | ${markdown(record.note)} |`), '', '## 用户备注', '', markdown(clean.notes), '', '数据均由本地使用者填写；合成示例、公开资料和方向性观察不能替代真实房间验证、采用或付费证据。', '');
  return lines.join('\n');
}
