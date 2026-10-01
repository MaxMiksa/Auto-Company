// 每份原料重量为清洗、去皮后的可食部分；米为干米，豆类为熟制沥干重量。
export const flavors = [
  { id: 'mild', label: '清淡', name: '清淡', description: '保持原味，分盘后少量加盐。', ingredients: [{ id: 'salt', name: '食盐', quantity: 0.2, unit: '克' }] },
  { id: 'chili', label: '香辣', name: '香辣', description: '分盘后加入纯辣椒粉；按个人耐辣度减量。', ingredients: [{ id: 'chili', name: '纯辣椒粉', quantity: 0.5, unit: '克' }, { id: 'salt', name: '食盐', quantity: 0.2, unit: '克' }] },
  { id: 'garlic', label: '蒜香', name: '蒜香', description: '分盘后加入纯蒜粉，拌入热主菜。', ingredients: [{ id: 'garlic', name: '纯蒜粉', quantity: 1, unit: '克' }, { id: 'salt', name: '食盐', quantity: 0.2, unit: '克' }] },
];

export const exclusions = [
  { id: 'soy', label: '大豆 / 豆腐', ingredientIds: ['tofu'] },
  { id: 'egg', label: '鸡蛋', ingredientIds: ['egg'] },
  { id: 'mushroom', label: '蘑菇', ingredientIds: ['mushroom'] },
  { id: 'garlic', label: '蒜', ingredientIds: ['garlic'] },
  { id: 'chili', label: '辣椒', ingredientIds: ['chili'] },
  { id: 'tomato', label: '番茄', ingredientIds: ['tomato'] },
  { id: 'chicken', label: '鸡肉', ingredientIds: ['chicken'] },
  { id: 'chickpea', label: '鹰嘴豆', ingredientIds: ['chickpea'] },
];

const tofu = { id: 'tofu', name: '原味硬豆腐', quantity: 150, unit: '克', note: '选无额外调味的硬豆腐；按包装要求冷藏。' };
const chicken = { id: 'chicken', name: '去骨鸡腿肉', quantity: 150, unit: '克', note: '去皮、无腌料；需要食品温度计测中心温度。' };

export const menus = [
  {
    id: 'tomato-tofu', title: '番茄豆腐 · 西兰花 · 米饭',
    description: '番茄煨豆腐配脆嫩西兰花，酸甜底味适合两组最后调味。',
    vegetarian: true, minutes: 42, mainMinutes: 13,
    dishes: ['番茄煨豆腐', '清炒西兰花', '白米饭'],
    protein: { ...tofu },
    accent: { id: 'tomato', name: '番茄', quantity: 120, unit: '克', prep: '洗净去蒂，切成约2厘米块。', usesMainWater: false, cook: '中火翻炒番茄3分钟至边缘变软、开始出汁。' },
    side: { id: 'broccoli', name: '西兰花', quantity: 160, unit: '克', prep: '切成约3厘米小朵，茎去硬皮切薄片，冲洗沥干。', cook: '中火翻炒1分钟，加分配给本批的蔬菜用水，盖锅焖3分钟；开盖翻炒至没有明显积水，茎能被筷子戳入。', minutes: 5 },
  },
  {
    id: 'potato-egg', title: '土豆鸡蛋 · 小白菜 · 米饭',
    description: '薄切土豆配熟蛋块，小白菜单独快炒。',
    vegetarian: true, minutes: 45, mainMinutes: 16,
    dishes: ['土豆炒鸡蛋', '清炒小白菜', '白米饭'],
    protein: { id: 'egg', name: '鸡蛋', quantity: 2, unit: '枚', note: '按每份2枚中等大小鸡蛋；不使用溏心做法。' },
    accent: { id: 'potato', name: '土豆', quantity: 100, unit: '克', prep: '削皮，切成约3毫米薄片，冲去表面淀粉并沥干。', usesMainWater: true, cook: '加入土豆与分配给本批的主菜用水，中小火盖锅焖8分钟，中途翻动；筷子可轻松穿透、没有硬芯后再继续。' },
    side: { id: 'bok-choy', name: '小白菜', quantity: 160, unit: '克', prep: '掰开逐叶清洗，切成4厘米段，菜梗和菜叶分开放。', cook: '先炒菜梗2分钟，再下菜叶和分配给本批的蔬菜用水，翻炒2分钟，直到菜梗变软、菜叶全熟。', minutes: 4 },
  },
  {
    id: 'pumpkin-chickpea', title: '南瓜鹰嘴豆 · 菠菜 · 米饭',
    description: '使用现成熟鹰嘴豆，南瓜切小块焖软；无需提前泡豆。',
    vegetarian: true, minutes: 44, mainMinutes: 15,
    dishes: ['南瓜焖鹰嘴豆', '清炒菠菜', '白米饭'],
    protein: { id: 'chickpea', name: '熟鹰嘴豆', quantity: 130, unit: '克', note: '原味罐装或预煮熟豆，冲洗沥干；不可用干豆直接替代。' },
    accent: { id: 'pumpkin', name: '南瓜', quantity: 120, unit: '克', prep: '去皮去籽，切成1厘米小块。', usesMainWater: true, cook: '加入南瓜和分配给本批的主菜用水，中小火盖锅焖8分钟，中途翻动；筷子能穿透后开盖。' },
    side: { id: 'spinach', name: '菠菜', quantity: 160, unit: '克', prep: '切去根部，逐叶冲洗泥沙，切成4厘米段并沥干。', cook: '先下菠菜梗炒1分钟，再下叶与分配给本批的蔬菜用水，翻炒2分钟，直到全部变软、无生叶。', minutes: 4 },
  },
  {
    id: 'mushroom-tofu', title: '蘑菇豆腐 · 胡萝卜 · 米饭',
    description: '蘑菇鲜味配煎豆腐，胡萝卜薄片单独焖炒。',
    vegetarian: true, minutes: 43, mainMinutes: 13,
    dishes: ['蘑菇煨豆腐', '清炒胡萝卜', '白米饭'],
    protein: { ...tofu },
    accent: { id: 'mushroom', name: '鲜蘑菇', quantity: 120, unit: '克', prep: '快速冲洗后沥干，去硬根，切成约5毫米片。', usesMainWater: false, cook: '中火翻炒蘑菇4分钟，直到明显缩小、表面出水。' },
    side: { id: 'carrot', name: '胡萝卜', quantity: 160, unit: '克', prep: '洗净去皮，切成约2毫米薄片。', cook: '翻炒1分钟，加入分配给本批的蔬菜用水，盖锅焖4分钟；薄片能被筷子穿透后开盖收去多余水。', minutes: 6 },
  },
  {
    id: 'carrot-chicken', title: '胡萝卜鸡肉 · 西葫芦 · 米饭',
    description: '小块鸡腿肉与薄片胡萝卜同煮；可自动替换为豆腐。',
    vegetarian: false, minutes: 48, mainMinutes: 16,
    dishes: ['胡萝卜鸡肉', '清炒西葫芦', '白米饭'],
    protein: { ...chicken },
    accent: { id: 'carrot', name: '胡萝卜', quantity: 100, unit: '克', prep: '洗净去皮，切成约2毫米薄片。', usesMainWater: true, cook: '中火翻炒胡萝卜2分钟后加入分配给本批的主菜用水，盖锅焖5分钟，直到薄片能被筷子穿透。' },
    side: { id: 'zucchini', name: '西葫芦', quantity: 160, unit: '克', prep: '洗净去两端，纵向切半后切5毫米半圆片。', cook: '中火翻炒3分钟，加入分配给本批的蔬菜用水，再炒1分钟，直到中心变软但仍成片。', minutes: 4 },
  },
  {
    id: 'corn-chicken', title: '玉米鸡肉 · 卷心菜 · 米饭',
    description: '熟甜玉米粒配鸡肉，卷心菜快炒；可自动替换为豆腐。',
    vegetarian: false, minutes: 46, mainMinutes: 14,
    dishes: ['玉米鸡肉', '清炒卷心菜', '白米饭'],
    protein: { ...chicken },
    accent: { id: 'corn', name: '熟甜玉米粒', quantity: 100, unit: '克', prep: '选原味熟玉米粒，冲洗沥干；冷冻玉米按包装解冻。', usesMainWater: true, cook: '下熟玉米粒和分配给本批的主菜用水，中火翻炒2分钟至全部热透。' },
    side: { id: 'cabbage', name: '卷心菜', quantity: 160, unit: '克', prep: '去掉硬芯，叶片掰开洗净，切成3厘米块，沥干。', cook: '中火翻炒2分钟，加分配给本批的蔬菜用水，再翻炒2分钟，直到叶片变软、菜梗熟透。', minutes: 4 },
  },
];
