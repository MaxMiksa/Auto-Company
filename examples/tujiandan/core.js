import { translate } from './i18n.js';

export const FORMAT_LABELS = {
  png: "PNG", jpeg: "JPEG", webp: "WebP", gif: "GIF", avif: "AVIF", bmp: "BMP", svg: "SVG"
};

export function detectFormat(bytes) {
  const b = new Uint8Array(bytes);
  if (b.length >= 8 && b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71 && b[4] === 13 && b[5] === 10 && b[6] === 26 && b[7] === 10) return "png";
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return "jpeg";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
  if (b.length >= 6 && (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a")) return "gif";
  if (b.length >= 12 && ascii(b, 4, 4) === "ftyp" && ["avif", "avis"].includes(ascii(b, 8, 4))) return "avif";
  if (b.length >= 2 && ascii(b, 0, 2) === "BM") return "bmp";
  if (/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(new TextDecoder().decode(b).replace(/^\uFEFF/, ""))) return "svg";
  return null;
}

function ascii(bytes, start, length) {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

export function extensionFormat(name) {
  const ext = name.split(".").pop()?.toLowerCase();
  return ext === "jpg" ? "jpeg" : (ext in FORMAT_LABELS ? ext : null);
}

export function evaluateImage(item, rules) {
  const issues = [];
  const stem = item.name.replace(/\.[^.]+$/, "");
  if (!item.format) issues.push({ kind: "format", text: "无法识别图片格式" });
  else {
    if (!rules.formats.includes(item.format)) issues.push({ kind: "format", text: `${FORMAT_LABELS[item.format]} 不在允许格式内` });
    const ext = extensionFormat(item.name);
    if (ext !== item.format) issues.push({ kind: "format", text: "扩展名与文件内容格式不一致" });
  }
  if (item.width == null || item.height == null) issues.push({ kind: "size", text: "无法读取图片尺寸" });
  else if (item.width < rules.minWidth || item.height < rules.minHeight) {
    issues.push({ kind: "size", text: `${item.width} × ${item.height} px；要求至少 ${rules.minWidth} × ${rules.minHeight} px` });
  }
  if (item.bytes > rules.maxBytes) issues.push({ kind: "weight", text: `${formatBytes(item.bytes)}；上限 ${formatBytes(rules.maxBytes)}` });
  if (rules.nameStyle === "slug" && !/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(stem)) {
    issues.push({ kind: "name", text: "文件名请使用小写英文、数字、- 或 _" });
  }
  if (rules.nameStyle === "spaces" && /^\s|\s$/.test(stem)) {
    issues.push({ kind: "name", text: "文件名首尾有空格" });
  }
  if (rules.prefix && !stem.startsWith(rules.prefix)) {
    issues.push({ kind: "name", text: `文件名缺少前缀「${rules.prefix}」` });
  }
  return issues;
}

export function evaluateBatch(items, rules) {
  const names = new Map();
  for (const item of items) {
    const key = item.name.toLocaleLowerCase();
    names.set(key, (names.get(key) || 0) + 1);
  }
  for (const item of items) {
    item.issues = evaluateImage(item, rules);
    if (names.get(item.name.toLocaleLowerCase()) > 1) item.issues.push({ kind: "name", text: "同批文件名重复，请核对后重命名" });
  }
  return items;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2).replace(/\.00$/, "")} MiB`;
}

export function statusForItem(item) {
  if (!item.format || item.width == null || item.height == null) return "无法检查";
  return item.issues.length ? "需处理" : "通过";
}

export function csvRows(items, rules, language = 'zh-CN') {
  const t = text => translate(text, language);
  const nameLabels = { slug: "小写英文/数字/-/_", spaces: "名称首尾无空格", none: "仅检查重名和前缀" };
  const summary = rules ? (language === 'en'
    ? `Current rules (initial values are examples): width>=${rules.minWidth}px, height>=${rules.minHeight}px, size<=${Number.isFinite(rules.maxBytes) ? formatBytes(rules.maxBytes) : t('未设置')}, formats=${rules.formats.map(f => FORMAT_LABELS[f]).join('/') || t('未选择')}, naming=${t(nameLabels[rules.nameStyle])}, prefix=${rules.prefix || t('无')}`
    : `本次检查规则（初始值仅为示例）：宽≥${rules.minWidth}px，高≥${rules.minHeight}px，体积≤${Number.isFinite(rules.maxBytes) ? formatBytes(rules.maxBytes) : "未设置"}，格式=${rules.formats.map(f => FORMAT_LABELS[f]).join("/") || "未选择"}，命名=${nameLabels[rules.nameStyle]}，前缀=${rules.prefix || "无"}`) : "";
  const rows = [["文件名", "格式", "宽(px)", "高(px)", "大小(bytes)", "状态", "问题"].map(t)];
  for (const item of items) rows.push([
    item.path || item.name, item.format || t("未知"), item.width ?? "", item.height ?? "", item.bytes,
    t(statusForItem(item)), item.issues.map(issue => t(issue.text)).join(language === 'en' ? '; ' : "；")
  ]);
  const output = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(","));
  if (summary) output.unshift(`"${summary.replaceAll('"', '""')}"`, "");
  return "\uFEFF" + output.join("\r\n");
}
