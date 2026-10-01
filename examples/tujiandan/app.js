import { FORMAT_LABELS, detectFormat, evaluateBatch, formatBytes, csvRows, statusForItem } from "./core.js";
import { translate, bindStaticTranslations } from "./i18n.js";

const $ = id => document.getElementById(id);
const entries = [];
let filter = "all";
let busy = false;
let language = 'zh-CN';
try { if (localStorage.getItem('tujiandan-language') === 'en') language = 'en'; } catch {}
const localizePage = bindStaticTranslations();
const t = text => translate(text, language);

function rules() {
  const width = Number($("min-width").value);
  const height = Number($("min-height").value);
  const maxMb = Number($("max-mb").value);
  return {
    minWidth: Number.isFinite(width) && width >= 0 ? width : 0,
    minHeight: Number.isFinite(height) && height >= 0 ? height : 0,
    maxBytes: Number.isFinite(maxMb) && maxMb > 0 ? maxMb * 1024 * 1024 : Infinity,
    formats: [...document.querySelectorAll('input[name="format"]:checked')].map(input => input.value),
    nameStyle: $("name-style").value,
    prefix: $("prefix").value
  };
}

function recalculate() {
  evaluateBatch(entries, rules());
  render();
}

async function readDimensions(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("图片尺寸不可读取");
    return [image.naturalWidth, image.naturalHeight];
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function inspect(file) {
  const item = { name: file.name, path: file.webkitRelativePath || file.name, bytes: file.size, format: null, width: null, height: null, issues: [] };
  try {
    item.format = detectFormat(await file.slice(0, 256).arrayBuffer());
    if (item.format && item.format !== "svg") [item.width, item.height] = await readDimensions(file);
  } catch {
    // A corrupt or unsupported image remains in the report with its known data.
  }
  return item;
}

async function addFiles(files) {
  if (busy || !files.length) return;
  busy = true;
  $("language").disabled = true;
  const zone = $("dropzone");
  const description = zone.querySelector(".drop-copy p");
  const original = description.textContent;
  for (let i = 0; i < files.length; i++) {
    description.textContent = language === 'en'
      ? `Checking ${i + 1} / ${files.length}: ${files[i].name}`
      : `正在检查 ${i + 1} / ${files.length}：${files[i].name}`;
    entries.push(await inspect(files[i]));
    recalculate();
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  description.textContent = original;
  busy = false;
  $("language").disabled = false;
  $("results").scrollIntoView({ behavior: "smooth", block: "start" });
}

function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content != null) element.textContent = content;
  return element;
}

function render() {
  const issueCount = entries.filter(item => statusForItem(item) !== "通过").length;
  $("intro-count").textContent = String(entries.length).padStart(2, "0");
  $("count-label").textContent = language === 'en' ? `${entries.length} images` : `${entries.length} 张`;
  $("all-count").textContent = entries.length;
  $("issue-count").textContent = issueCount;
  $("export").disabled = entries.length === 0;
  $("clear").disabled = entries.length === 0;
  $("empty-state").hidden = entries.length > 0;
  $("result-list").hidden = entries.length === 0;
  $("result-note").hidden = entries.length === 0;
  const list = $("result-list");
  list.replaceChildren();
  if (!entries.length) return;
  const rows = filter === "issues" ? entries.filter(item => statusForItem(item) !== "通过") : entries;
  const header = node("div", "result-row header");
  for (const label of ["#", "文件名", "实际尺寸", "格式", "体积", "检查结论"]) header.append(node("span", "", t(label)));
  list.append(header);
  for (const item of rows) {
    const row = node("div", "result-row");
    row.append(node("span", "index", String(entries.indexOf(item) + 1).padStart(2, "0")));
    const filename = node("span", "filename", item.name);
    if (item.path !== item.name) filename.append(node("span", "subpath", item.path));
    row.append(filename);
    for (const [label, value] of [
      ['实际尺寸', item.width == null ? t('无法读取') : `${item.width} × ${item.height} px`],
      ['格式', item.format ? FORMAT_LABELS[item.format] : t('未知')],
      ['体积', formatBytes(item.bytes)],
    ]) { const cell = node('span', '', value); cell.dataset.label = t(label); row.append(cell); }
    const verdict = node("span", "issue-list");
    const status = statusForItem(item);
    verdict.append(node("span", status === "通过" ? "pass-pill" : status === "无法检查" ? "unable-pill" : "issue-pill", t(status)));
    for (const issue of item.issues) verdict.append(node("span", "issue-pill", t(issue.text)));
    row.append(verdict);
    list.append(row);
  }
  if (!rows.length) list.append(node("p", "empty-state", t("这批图片没有待处理项。")));
  $("result-note").textContent = language === 'en'
    ? `${entries.length} images; ${issueCount} need attention or cannot be checked. Results reflect the current rules and update when you change them. Original files are never modified.`
    : `共 ${entries.length} 张，${issueCount} 张需处理或无法检查。结果仅反映当前规则；修改规则后会立即更新，不修改原文件。`;
}

function setFilter(value) {
  filter = value;
  for (const [name, button] of [["all", $("filter-all")], ["issues", $("filter-issues")]]) {
    const active = name === value;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  render();
}

$("choose-files").addEventListener("click", () => $("files").click());
$("choose-folder").addEventListener("click", () => $("folder").click());
for (const input of [$("files"), $("folder")]) input.addEventListener("change", () => { addFiles([...input.files]); input.value = ""; });
const dropzone = $("dropzone");
dropzone.addEventListener("click", event => { if (event.target === dropzone || event.target.closest(".drop-copy,.drop-icon")) $("files").click(); });
dropzone.addEventListener("keydown", event => { if (event.target === dropzone && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); $("files").click(); } });
for (const type of ["dragenter", "dragover"]) dropzone.addEventListener(type, event => { event.preventDefault(); dropzone.classList.add("dragging"); });
for (const type of ["dragleave", "drop"]) dropzone.addEventListener(type, event => { event.preventDefault(); dropzone.classList.remove("dragging"); });
dropzone.addEventListener("drop", event => addFiles([...event.dataTransfer.files]));
for (const input of document.querySelectorAll(".rule-grid input,.rule-grid select")) {
  const update = () => {
    if (input.name === "format" && !document.querySelector('input[name="format"]:checked')) input.checked = true;
    recalculate();
  };
  input.addEventListener("input", update);
  input.addEventListener("change", update);
}
$("filter-all").addEventListener("click", () => setFilter("all"));
$("filter-issues").addEventListener("click", () => setFilter("issues"));
$("clear").addEventListener("click", () => { entries.length = 0; setFilter("all"); });
$("export").addEventListener("click", () => {
  const blob = new Blob([csvRows(entries, rules(), language)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${language === 'en' ? 'image-checklist' : '图检单'}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$("language").value = language;
localizePage(language);
$("language").addEventListener('change', () => {
  language = $("language").value === 'en' ? 'en' : 'zh-CN';
  try { localStorage.setItem('tujiandan-language', language); } catch {}
  localizePage(language);
  $("dropzone").querySelector('.drop-copy p').textContent = t('文件只在此设备的浏览器中读取，不会传到服务器。');
  render();
});
render();
