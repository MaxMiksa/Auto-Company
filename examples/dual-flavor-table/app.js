import { menus, flavors, exclusions } from './catalog.js';
import { generatePlan, findMenus, planToText } from './engine.js';

const STORAGE_KEY = 'dual-flavor-table-v1';
const $ = (selector) => document.querySelector(selector);
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const defaultConfig = { menuId:menus[0].id, servingsA:1, servingsB:1, flavorA:'mild', flavorB:'chili', vegetarian:false, exclusions:[], maxMinutes:60 };
let plan;
let shopping = new Set();
let completed = new Set();

function tell(message, error = false) {
  $('#message').textContent = message;
  $('#message').classList.toggle('error', error);
}

function readForm() {
  return {
    menuId: document.querySelector('input[name="menu"]:checked')?.value,
    servingsA: Number($('#servings-a').value), servingsB: Number($('#servings-b').value),
    flavorA: $('#flavor-a').value, flavorB: $('#flavor-b').value,
    vegetarian: $('#vegetarian').checked,
    exclusions: [...document.querySelectorAll('input[name="exclusions"]:checked')].map((input) => input.value),
    maxMinutes: Number($('#max-minutes').value),
  };
}

function updateMenus(selectedId) {
  let matches;
  const config = readForm();
  selectedId ??= config.menuId;
  try {
    matches = findMenus(config);
  } catch (error) {
    matches = [];
    tell(error.message, true);
  }
  const chosen = matches.some((menu) => menu.id === selectedId) ? selectedId : matches[0]?.id;
  $('#menu-options').innerHTML = matches.map((menu) => `<label class="menu-option"><input type="radio" name="menu" value="${escape(menu.id)}" ${menu.id === chosen ? 'checked' : ''}><span><strong>${escape(menu.effectiveTitle || menu.title)}</strong><small>约 ${escape(menu.minutes)} 分钟 · ${menu.vegetarian || config.vegetarian ? '素食' : '可换素食'}</small></span></label>`).join('');
  $('#menu-empty').hidden = matches.length > 0;
  $('#generate').disabled = matches.length === 0;
}

function fillForm(config) {
  $('#servings-a').value = config.servingsA;
  $('#servings-b').value = config.servingsB;
  $('#flavor-a').value = config.flavorA;
  $('#flavor-b').value = config.flavorB;
  $('#max-minutes').value = config.maxMinutes;
  $('#vegetarian').checked = config.vegetarian;
  for (const input of document.querySelectorAll('input[name="exclusions"]')) input.checked = config.exclusions.includes(input.value);
  updateMenus(config.menuId);
  $('#draft-message').hidden = true;
}

function snapshot() {
  return {version:1, app:'dual-flavor-table', config:plan.config, shopping:[...shopping], completed:[...completed]};
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot()));
    return true;
  } catch {
    tell('浏览器无法保存进度。当前方案仍可使用，请下载备份；关闭页面后可能无法恢复。', true);
    return false;
  }
}

function validateSnapshot(data) {
  if (!data || typeof data !== 'object' || data.version !== 1 || data.app !== 'dual-flavor-table' || !data.config || !Array.isArray(data.shopping) || !Array.isArray(data.completed)) throw new Error('备份格式不正确，请选择一桌双味导出的进度文件。');
  const candidate = generatePlan(data.config);
  const validIngredients = new Set(candidate.ingredients.map((item) => item.id));
  const validSteps = new Set(candidate.steps.map((step) => step.id));
  if (data.shopping.length > candidate.ingredients.length || data.completed.length > candidate.steps.length || data.shopping.some((id) => typeof id !== 'string' || !validIngredients.has(id)) || data.completed.some((id) => typeof id !== 'string' || !validSteps.has(id)) || new Set(data.shopping).size !== data.shopping.length || new Set(data.completed).size !== data.completed.length) throw new Error('备份中的材料或步骤与方案不一致。当前方案已保留，请使用完整的原始备份。');
  return {plan:candidate, shopping:new Set(data.shopping), completed:new Set(data.completed)};
}

function refreshProgress() {
  $('#shopping-progress').textContent = `${shopping.size} / ${plan.ingredients.length} 已备好`;
  $('#step-progress').textContent = `${completed.size} / ${plan.steps.length} 已完成`;
}

function render() {
  $('#plan-title').textContent = plan.title;
  $('#duration').textContent = `约 ${plan.minutes} 分钟 · ${plan.totalServings} 人`;
  $('#dishes').textContent = plan.dishes.join(' ＋ ');
  const flavorLabel = (id) => flavors.find((flavor) => flavor.id === id)?.label || id;
  $('#flavor-summary').innerHTML = `<span class="flavor-chip">A 组 <b>${plan.servingsA} 人 · ${escape(flavorLabel(plan.flavorA))}</b></span><span class="flavor-chip">B 组 <b>${plan.servingsB} 人 · ${escape(flavorLabel(plan.flavorB))}</b></span>`;
  $('#substitutions').innerHTML = plan.substitutions.map((item) => `<p class="substitution">↳ ${escape(item)}</p>`).join('');
  const groups = [...new Set(plan.ingredients.map((item) => item.group))];
  $('#shopping-list').innerHTML = groups.map((group) => `<h3 class="ingredient-group">${escape(group)}</h3>` + plan.ingredients.filter((item) => item.group === group).map((item) => `<label class="ingredient-row"><input type="checkbox" data-id="${escape(item.id)}" ${shopping.has(item.id) ? 'checked' : ''}><span><strong>${escape(item.name)}</strong>${item.note ? `<small>${escape(item.note)}</small>` : ''}</span><b class="ingredient-quantity">${escape(item.quantity)} ${escape(item.unit)}</b></label>`).join('')).join('');
  const phaseLabel = {prepare:'共享备料', cook:'依次烹饪', split:'两组分盘', finish:'各自调味'};
  $('#step-list').innerHTML = plan.steps.map((step) => `<li class="step-row"><div><label><input type="checkbox" data-id="${escape(step.id)}" ${completed.has(step.id) ? 'checked' : ''}><span class="step-title">${escape(step.title)}</span></label><p>${escape(step.detail)}</p><div class="step-meta">${escape(phaseLabel[step.phase] || '烹饪操作')} · 参考 ${escape(step.minutes)} 分钟</div></div></li>`).join('');
  $('#plan-notes').innerHTML = plan.notes.map((note) => `<li>${escape(note)}</li>`).join('');
  refreshProgress();
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

for (const selector of ['#flavor-a','#flavor-b']) $(selector).innerHTML = flavors.map((flavor) => `<option value="${escape(flavor.id)}">${escape(flavor.label)}</option>`).join('');
$('#exclusion-fields').innerHTML = exclusions.map((item) => `<label><input type="checkbox" name="exclusions" value="${escape(item.id)}">${escape(item.label)}</label>`).join('');
fillForm(defaultConfig);
plan = generatePlan(defaultConfig);
let startupWarning = '';
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    if (raw.length > 100000) throw new Error('存储过大');
    const restored = validateSnapshot(JSON.parse(raw));
    plan = restored.plan;
    shopping = restored.shopping;
    completed = restored.completed;
    fillForm(plan.config);
  }
} catch {
  startupWarning = '未能读取上次保存的进度，已打开一份默认方案。你可以导入备份恢复；损坏的数据不会用于生成内容。';
}
render();
if (startupWarning) tell(startupWarning, true);

$('#planner').addEventListener('change', (event) => {
  if (event.target.name !== 'menu') updateMenus();
  $('#draft-message').hidden = false;
});
$('#planner').addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    const candidate = generatePlan(readForm());
    if ((shopping.size || completed.size) && !window.confirm('重新生成会清除当前采购和烹饪勾选。要应用新设置吗？')) return;
    plan = candidate;
    shopping = new Set();
    completed = new Set();
    fillForm(plan.config);
    render();
    if (persist()) tell('整餐已生成。先核对采购材料，再按顺序开火。');
    $('#plan-title').focus({preventScroll:true});
  } catch (error) {
    tell(`${error.message} 调整设置后再试，当前方案和进度已保留。`, true);
    $('#message').focus();
  }
});

for (const [selector, collection] of [['#shopping-list', () => shopping], ['#step-list', () => completed]]) {
  $(selector).addEventListener('change', (event) => {
    const id = event.target.dataset.id;
    if (!id) return;
    if (event.target.checked) collection().add(id); else collection().delete(id);
    refreshProgress();
    persist();
  });
}
$('#export-text').addEventListener('click', () => {
  const progress = `\n\n当前进度\n已备材料：${shopping.size}/${plan.ingredients.length}\n已完成步骤：${completed.size}/${plan.steps.length}\n`;
  download(`一桌双味-${plan.menuId}.txt`, '\uFEFF' + planToText(plan) + progress, 'text/plain;charset=utf-8');
  tell('整餐清单已下载，包含材料、步骤、分味和注意事项。');
});
$('#print-plan').addEventListener('click', () => window.print());
$('#backup').addEventListener('click', () => {
  download('一桌双味-进度备份.json', JSON.stringify(snapshot(), null, 2), 'application/json');
  tell('进度备份已下载。请保留这个文件，用“导入备份”恢复。');
});
$('#import-backup').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 100000) throw new Error('备份文件过大，请选择小于 100 KB 的原始进度文件。');
    const restored = validateSnapshot(JSON.parse(await file.text()));
    if ((shopping.size || completed.size) && !window.confirm('导入备份会替换当前方案和勾选进度。继续吗？')) return;
    plan = restored.plan;
    shopping = restored.shopping;
    completed = restored.completed;
    fillForm(plan.config);
    render();
    if (persist()) tell('备份已恢复，可以从保留的步骤继续做饭。');
  } catch (error) {
    const reason = error instanceof SyntaxError ? '文件不是有效的进度备份。' : error.message;
    tell(`${reason} 当前方案和进度已保留。`, true);
  } finally {
    event.target.value = '';
  }
});
$('#reset-progress').addEventListener('click', () => {
  if (!shopping.size && !completed.size) { tell('还没有已勾选的材料或步骤，可以直接开始。'); return; }
  if (!window.confirm('清除当前方案的勾选，从第一步重新开始？')) return;
  shopping.clear();
  completed.clear();
  render();
  if (persist()) tell('勾选已清除，整餐方案保留。');
});
