import { menus, flavors, exclusions as exclusionOptions } from './catalog.js';

const allowedFields = ['menuId', 'servingsA', 'servingsB', 'flavorA', 'flavorB', 'vegetarian', 'exclusions', 'maxMinutes'];
const round = (number) => Math.round(number * 100) / 100;
const cleanName = (name) => name.replace(/^原味|^去骨|^鲜|^熟/, '');

function validateOptions(options, forPlan) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('请提供有效的方案设置。');
  for (const key of Object.keys(options)) if (!allowedFields.includes(key)) throw new Error(`未知设置：${key}。`);
  const config = { vegetarian: false, exclusions: [], maxMinutes: 60, ...(forPlan ? {} : { servingsA: 1, servingsB: 1 }), ...options };
  for (const key of ['servingsA', 'servingsB']) {
    if (!Number.isInteger(config[key]) || config[key] < 1 || config[key] > 4) throw new Error(`${key === 'servingsA' ? 'A' : 'B'}组份数必须为1至4的整数。`);
  }
  if (config.servingsA + config.servingsB > 6) throw new Error('两组总份数不能超过6份，请减少份数。');
  if (!Number.isInteger(config.maxMinutes) || config.maxMinutes < 20 || config.maxMinutes > 90) throw new Error('时间上限必须为20至90分钟的整数。');
  if (typeof config.vegetarian !== 'boolean') throw new Error('素食设置必须为 true 或 false。');
  if (!Array.isArray(config.exclusions)) throw new Error('排除食材必须使用数组。');
  for (const id of config.exclusions) {
    if (typeof id !== 'string' || !exclusionOptions.some((item) => item.id === id)) throw new Error(`未知排除食材：${String(id)}。`);
  }
  if (new Set(config.exclusions).size !== config.exclusions.length) throw new Error('排除食材不能重复选择。');
  config.exclusions = [...config.exclusions];
  if (forPlan || config.menuId !== undefined) {
    if (typeof config.menuId !== 'string' || !menus.some((menu) => menu.id === config.menuId)) throw new Error('整餐菜单不存在，请重新选择。');
  }
  for (const key of ['flavorA', 'flavorB']) {
    if (forPlan || config[key] !== undefined) {
      const flavor = flavors.find((item) => item.id === config[key]);
      if (!flavor) throw new Error(`${key === 'flavorA' ? 'A' : 'B'}组口味无效，请选择清淡、香辣或蒜香。`);
      const forbidden = excludedIds(config.exclusions);
      if (flavor.ingredients.some((ingredient) => forbidden.has(ingredient.id))) throw new Error(`${key === 'flavorA' ? 'A' : 'B'}组的${flavor.label}口味含有已排除食材，请更换口味。`);
    }
  }
  return config;
}

function excludedIds(selected) {
  return new Set(selected.flatMap((id) => exclusionOptions.find((option) => option.id === id).ingredientIds));
}

const chickpea = { id: 'chickpea', name: '熟鹰嘴豆', quantity: 130, unit: '克', note: '原味罐装或预煮熟豆，冲洗沥干；不可用干豆直接替代。' };
const tofu = { id: 'tofu', name: '原味硬豆腐', quantity: 150, unit: '克', note: '选无额外调味的硬豆腐；按包装要求冷藏。' };

function resolveMenu(menu, config) {
  const blocked = excludedIds(config.exclusions);
  const resolved = { ...menu, protein: { ...menu.protein }, accent: { ...menu.accent }, side: { ...menu.side }, substitutions: [] };
  if (resolved.protein.id === 'chicken' && (config.vegetarian || blocked.has('chicken'))) {
    resolved.protein = { ...tofu };
    resolved.substitutions.push('鸡肉替换为原味硬豆腐；烹饪步骤已改为豆腐做法。');
  }
  if (blocked.has(resolved.protein.id) && ['tofu', 'egg'].includes(resolved.protein.id)) {
    const original = resolved.protein.name;
    resolved.protein = { ...chickpea };
    resolved.substitutions.push(`${original}替换为熟鹰嘴豆；使用熟豆，不使用干豆。`);
  }
  if (blocked.has(resolved.accent.id) && resolved.accent.id === 'tomato') {
    resolved.accent = { id: 'pumpkin', name: '南瓜', quantity: 120, unit: '克', prep: '去皮去籽，切成1厘米小块。', usesMainWater: true, cook: '加入南瓜和分配给本批的主菜用水，中小火盖锅焖8分钟，中途翻动，筷子能穿透后开盖。' };
    resolved.substitutions.push('番茄替换为南瓜；切小块焖至无硬芯，时间估算增加5分钟。');
    resolved.mainMinutes += 5;
    resolved.minutes += 5;
  }
  if (blocked.has(resolved.accent.id) && resolved.accent.id === 'mushroom') {
    resolved.accent = { id: 'zucchini', name: '西葫芦', quantity: 120, unit: '克', prep: '洗净去两端，切成5毫米半圆片。', usesMainWater: false, cook: '中火翻炒西葫芦4分钟，直到中心变软但仍成片。' };
    resolved.substitutions.push('蘑菇替换为西葫芦；采购清单和步骤均已更新。');
  }
  const rejected = [resolved.protein, resolved.accent, resolved.side].filter((item) => blocked.has(item.id));
  if (rejected.length) throw new Error(`这套菜单无法避开${rejected.map((item) => item.name).join('、')}，请改选整餐或调整排除项。`);
  resolved.vegetarian = resolved.protein.id !== 'chicken';
  resolved.dishes = [`${cleanName(resolved.accent.name)}${cleanName(resolved.protein.name)}`, `清炒${cleanName(resolved.side.name)}`, '白米饭'];
  resolved.title = resolved.dishes.join(' · ');
  const total = config.servingsA + config.servingsB;
  const batches = Math.ceil(total / 2);
  // 一名操作者顺序使用炒锅；每增加一批主菜和蔬菜，增加相应炒制时间和分装时间。
  resolved.minutes += (batches - 1) * (resolved.mainMinutes + resolved.side.minutes + 1) + Math.max(0, total - 2);
  return resolved;
}

export function findMenus(options = {}) {
  const config = validateOptions(options, false);
  const available = [];
  for (const menu of menus) {
    try {
      const resolved = resolveMenu(menu, config);
      if (resolved.minutes <= config.maxMinutes) available.push(resolved);
    } catch (error) {
      if (!error.message.startsWith('这套菜单无法避开')) throw error;
    }
  }
  return available;
}

function ingredient(item, servings, group = '共享基础', note = item.note || '') {
  const prefix = group === '共享基础' ? 'shared' : group.startsWith('A') ? 'A' : 'B';
  return { id: `${prefix}:${item.id}`, ingredientId: item.ingredientId || item.id, name: item.name, quantity: round(item.quantity * servings), unit: item.unit, group, note };
}

function proteinPreparation(protein) {
  if (protein.id === 'chicken') return '蔬菜全部备好后再处理鸡肉；不要冲洗生鸡肉。用独立生肉刀板切成约1.5厘米小块，放生肉专用碗，暂不接触熟食容器。处理后用肥皂流水洗手，彻底清洁刀、板和台面；之后仅用干净器具接触熟食。';
  if (protein.id === 'tofu') return '豆腐沥干，切成约1.5厘米方块，用厨房纸轻压表面水分。放干净碗，不与其他食材混在一起，方便按批下锅。';
  if (protein.id === 'egg') return '将鸡蛋打入干净碗，搅打至蛋白蛋黄均匀。蛋壳丢弃后用肥皂流水洗手，清洁接触蛋液的台面；盛熟蛋使用另一只干净碗。';
  return '熟鹰嘴豆打开包装后冲洗沥干，按沥干重量称量；只使用已煮熟的豆，不把干豆加入本流程。';
}

function mainCooking(menu, batch, servings, total) {
  const ratio = `${servings}/${total}`;
  const prefix = `第${batch}批做${servings}份：取主菜食材、主菜用油、主菜用水及主菜盐各占总量的${ratio}。`;
  const oil = `锅用中火预热约1分钟，加入本批主菜用油（${round(5 * servings)}毫升）。`;
  const water = `本批主菜用水（${round(60 * servings)}毫升）`;
  const accent = menu.accent.cook.replace('分配给本批的主菜用水', water);
  const addWater = menu.accent.usesMainWater ? '' : `加入${water}。`;
  const salt = `加入本批主菜盐（${round(0.5 * servings)}克）。`;
  const finish = '成品盛入干净的共享主菜盆，先不加蒜粉或辣椒粉；每批熟菜用干净锅铲取出。';
  if (menu.protein.id === 'chicken') return `${prefix}${oil}下鸡肉中火翻炒约4分钟，肉块分开、不堆叠。${accent}${addWater}再小火煮3至5分钟。${salt}用干净食品温度计从侧面测各批最大肉块中心，至少74°C；未达标继续加热并复测，不能只看颜色或按分钟判断。温度计按说明清洁，生肉碗和夹具不可盛熟食。${finish}`;
  if (menu.protein.id === 'tofu') return `${prefix}${oil}下豆腐，煎约5分钟，中途轻翻，至表面微黄；用干净碗暂盛。${accent}${addWater}放回豆腐，小火煮3分钟至内部热透。${salt}${finish}`;
  if (menu.protein.id === 'egg') return `${prefix}${oil}下蛋液，中火轻推2至3分钟至全部凝固、无流动蛋液，盛入干净碗。${accent}${addWater}放回熟蛋，翻炒1分钟至全部热透。${salt}${finish}`;
  return `${prefix}${oil}${accent}${addWater}下熟鹰嘴豆，中小火翻动并加热3分钟，直到豆子内部热透。${salt}${finish}`;
}

export function generatePlan(options) {
  const config = validateOptions(options, true);
  const menu = resolveMenu(menus.find((item) => item.id === config.menuId), config);
  if (menu.minutes > config.maxMinutes) throw new Error(`这套${config.servingsA + config.servingsB}份整餐预计需要${menu.minutes}分钟，超过${config.maxMinutes}分钟上限；请增加时间、减少份数或更换菜单。`);
  const total = config.servingsA + config.servingsB;
  const groups = ['A', 'B'].map((id) => {
    const flavor = flavors.find((item) => item.id === config[`flavor${id}`]);
    return { id, label: `${id}组`, servings: config[`servings${id}`], flavorId: flavor.id, flavorLabel: flavor.label };
  });
  const ingredients = [
    ingredient({ id: 'rice', name: '大米（干重）', quantity: 75, unit: '克' }, total, '共享基础', '普通白米；淘洗水另备，煮饭水以电饭煲与米包装说明为准。'),
    ingredient({ id: 'rice-water', ingredientId: 'water', name: '煮饭用水', quantity: 112.5, unit: '毫升' }, total, '共享基础', '参考干米:水重量1:1.5；如设备刻度或米包装不同，按其说明调整。'),
    ingredient(menu.protein, total), ingredient(menu.accent, total), ingredient(menu.side, total),
    ingredient({ id: 'main-oil', ingredientId: 'rapeseed-oil', name: '主菜用纯菜籽油', quantity: 5, unit: '毫升' }, total),
    ingredient({ id: 'side-oil', ingredientId: 'rapeseed-oil', name: '蔬菜用纯菜籽油', quantity: 3, unit: '毫升' }, total),
    ingredient({ id: 'main-water', ingredientId: 'water', name: '主菜用水', quantity: 60, unit: '毫升' }, total),
    ingredient({ id: 'side-water', ingredientId: 'water', name: '蔬菜用水', quantity: 20, unit: '毫升' }, total),
    ingredient({ id: 'main-salt', ingredientId: 'salt', name: '主菜基础盐', quantity: 0.5, unit: '克' }, total),
    ingredient({ id: 'side-salt', ingredientId: 'salt', name: '蔬菜基础盐', quantity: 0.3, unit: '克' }, total),
  ];
  for (const group of groups) {
    const flavor = flavors.find((item) => item.id === group.flavorId);
    ingredients.push(...flavor.ingredients.map((item) => ingredient(item, group.servings, `${group.id}组最后调味`, '只加入本组主菜；用本组独立干净勺子。')));
  }
  const blocked = excludedIds(config.exclusions);
  if (ingredients.some((item) => blocked.has(item.ingredientId))) throw new Error('采购清单仍含已排除食材，无法生成该方案。');
  const steps = [];
  const addStep = (title, detail, minutes, phase) => steps.push({ id: `step-${steps.length + 1}`, title, detail, minutes, phase });
  addStep('先启动共享米饭', `洗手并清洁台面。称${75 * total}克干米，淘洗后加参考${round(112.5 * total)}毫升水（按设备/米包装调整），启动电饭煲普通煮饭档。米饭在后续备料和炒菜时并行煮约30至40分钟；一名操作者只依次操作一口炒锅。确认电饭煲与炒锅容量适合${total}份；主菜与蔬菜每批最多2份。`, 3, 'prepare');
  addStep('一次备好两组蔬菜', `共享主菜的${menu.accent.name}：${menu.accent.prep}配菜${menu.side.name}：${menu.side.prep}分别放入干净碗。称出主菜与蔬菜各自的油、水、基础盐，勿加入蒜、辣椒或复合酱料。备好共享熟菜盆、A/B两组主菜碗及各自干净勺；碗可加干净盖子保温。`, 7 + Math.max(0, total - 2), 'prepare');
  addStep(`准备${menu.protein.name}`, proteinPreparation(menu.protein), menu.protein.id === 'chicken' ? 6 : 3, 'prepare');
  const batches = [];
  for (let remaining = total; remaining > 0; remaining -= 2) batches.push(Math.min(2, remaining));
  batches.forEach((servings, index) => addStep(`共享主菜：第${index + 1}/${batches.length}批`, mainCooking(menu, index + 1, servings, total), menu.mainMinutes, 'cook'));
  addStep('清洁炒锅，再做共享蔬菜', `全部主菜做好后盖好共享熟菜盆。关火，把炒锅和锅铲清洗干净、沥干，再用来炒蔬菜；清洗时避开已盛出的熟菜。${menu.protein.id === 'chicken' ? '检查处理生鸡肉后的手、刀板、台面与工具已清洁，熟菜不能接触生肉容器。' : menu.protein.id === 'egg' ? '检查接触生蛋液后的手、台面与工具已清洁，熟菜不能接触蛋液容器。' : '检查台面与熟菜容器保持清洁。'}`, 2, 'cook');
  batches.forEach((servings, index) => addStep(`共享蔬菜：第${index + 1}/${batches.length}批`, `本批${servings}份，取${menu.side.name}、蔬菜用油、水、盐各占总量的${servings}/${total}。锅中火预热，加${round(3 * servings)}毫升蔬菜用油。${menu.side.cook}加${round(0.3 * servings)}克本批蔬菜基础盐，翻匀后盛入干净共享配菜盆；不要放蒜、辣椒或主菜口味调料。`, menu.side.minutes, 'cook'));
  addStep('检查主食完成', '确认电饭煲已完成煮饭；打开检查米粒熟软、无硬芯。若未熟，按设备说明补水继续煮，时间相应延长；不为赶上估时提前结束。熟饭用干净饭勺轻拌，按电饭煲说明短时保温。', 2, 'cook');
  const servingOrder = [...groups].sort((left, right) => Number(right.flavorId === 'mild') - Number(left.flavorId === 'mild'));
  addStep('先盛清淡组，按份数分开', `先分${servingOrder[0].label}，再分${servingOrder[1].label}；若有清淡组必须先盛。将共享主菜充分混匀，让固体和汁液均匀，再分A组${config.servingsA}/${total}、B组${config.servingsB}/${total}；每组主菜进入自己的干净碗。蔬菜和米饭也各按${config.servingsA}:${config.servingsB}分配。盛菜工具只接触未调味共享盆，不放回已调味碗；两组各有独立勺。`, 3, 'split');
  for (const group of servingOrder) {
    const seasonings = ingredients.filter((item) => item.group === `${group.id}组最后调味`).map((item) => `${item.name}${item.quantity}${item.unit}`).join('、');
    addStep(`${group.label}最后调成${group.flavorLabel}`, `仅在${group.label}主菜碗内加入${seasonings}，用本组干净勺趁热拌匀。${group.flavorId === 'chili' ? '辣椒粉可先放一半，试味后加到适口；不要把试味勺再放回调料罐。' : group.flavorId === 'garlic' ? '蒜粉先撒开再拌匀，避免粉末结团；使用可直接调味的食品级纯蒜粉。' : '少量盐可按偏好减少，保持清淡原味。'}米饭和蔬菜保持共享基础味。不可回到共用炒锅，不与另一组共用调味勺。`, 1, 'finish');
  }
  const notes = [
    `约${menu.minutes}分钟是${total}份、1名操作者、1口炒锅（每批最多2份）与1台电饭煲的估算；未进行真实烹饪或真人体验验证。设备、米品种、刀工和实际熟度可能延长时间。`,
    '本产品的排除规则只核对列出的原料，并不保证过敏安全。采购时检查豆腐、熟豆、油和纯香料的完整配料与过敏原/交叉接触标签；家庭器具也可能残留。严重过敏者需自行核实每件原料和环境。',
    '只用原味、无复合酱料的原料；不需要酱油、蚝油、豆瓣酱、黄油或坚果。所有质量为可食净重；熟鹰嘴豆为沥干熟重，不包括干豆浸泡煮制。',
    '基础味全部共做，蒜粉和辣椒粉只在分盘后加入。清淡先盛，每组干净碗勺，禁止调味后的勺回共享盆或共享调料罐。',
    '默认配套用具：炒锅与锅盖、电饭煲、刀板、量秤/量杯、共享盛菜盆、分组碗盘、独立勺与饭勺；不需要第二个炉头。',
    '本计划用于现做现吃；熟菜盛出后加盖、尽快完成后续步骤并食用，清洁用水与淘米水不计入烹饪用水清单。',
  ];
  if (menu.protein.id === 'chicken') notes.push('鸡肉菜单需要食品温度计；每批最大肉块中心至少74°C，时间和颜色不能替代测温。先备蔬菜、最后切生鸡肉，不冲洗鸡肉，生熟工具分开并彻底清洁。');
  return {
    id: `${menu.id}-${config.servingsA}-${config.servingsB}-${config.flavorA}-${config.flavorB}-${config.vegetarian ? 'veg' : 'standard'}-${config.exclusions.slice().sort().join('_') || 'none'}`,
    menuId: menu.id, title: menu.title,
    servingsA: config.servingsA, servingsB: config.servingsB, totalServings: total,
    flavorA: config.flavorA, flavorB: config.flavorB, minutes: menu.minutes,
    vegetarian: menu.vegetarian, dishes: [...menu.dishes], ingredients, steps, notes,
    substitutions: [...menu.substitutions], groups, config,
    equipment: ['1口炒锅及锅盖', '1台电饭煲', '1名操作者', ...(menu.protein.id === 'chicken' ? ['食品温度计'] : [])],
  };
}

export function planToText(plan) {
  const textValue = (value) => typeof value === 'string' && value.trim().length > 0;
  const positive = (value) => Number.isFinite(value) && value > 0;
  const stringList = (value) => Array.isArray(value) && value.every(textValue);
  if (!plan || typeof plan !== 'object' || !textValue(plan.title)
    || !Number.isInteger(plan.totalServings) || plan.totalServings < 2 || plan.totalServings > 6 || !positive(plan.minutes)
    || !stringList(plan.dishes) || plan.dishes.length < 3 || !stringList(plan.notes) || !stringList(plan.substitutions)
    || !Array.isArray(plan.ingredients) || !plan.ingredients.length || !plan.ingredients.every((item) => item && textValue(item.name) && textValue(item.unit) && textValue(item.group) && positive(item.quantity))
    || !Array.isArray(plan.steps) || !plan.steps.length || !plan.steps.every((step) => step && textValue(step.title) && textValue(step.detail) && positive(step.minutes))
    || !Array.isArray(plan.groups) || plan.groups.length !== 2 || !plan.groups.every((group) => group && textValue(group.label) && textValue(group.flavorLabel) && Number.isInteger(group.servings) && group.servings > 0)) {
    throw new Error('无法导出：请先生成完整整餐方案。');
  }
  const lines = [
    '一桌双味｜整餐计划', plan.title,
    `${plan.totalServings}份 · 预计${plan.minutes}分钟（估算，未实烹验证）`,
    ...plan.groups.map((group) => `${group.label}：${group.servings}份 · ${group.flavorLabel}`),
    '', '整餐：', ...plan.dishes.map((dish) => `- ${dish}`),
    '', '食材替换：', ...(plan.substitutions.length ? plan.substitutions.map((item) => `- ${item}`) : ['- 无']),
    '', '采购与用量：',
  ];
  for (const group of ['共享基础', 'A组最后调味', 'B组最后调味']) {
    lines.push(group);
    for (const item of plan.ingredients.filter((ingredient) => ingredient.group === group)) lines.push(`- ${item.name} ${item.quantity}${item.unit}${item.note ? `；${item.note}` : ''}`);
  }
  lines.push('', '烹饪步骤（按顺序完成）：');
  plan.steps.forEach((step, index) => lines.push(`${index + 1}. ${step.title}（约${step.minutes}分钟）`, step.detail, ''));
  lines.push('使用边界与清洁：', ...plan.notes.map((note) => `- ${note}`));
  return lines.join('\n');
}
