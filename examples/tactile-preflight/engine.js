const NS = 'http://www.w3.org/2000/svg';
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_OBJECTS = 800;
const TAGS = new Set(['svg', 'g', 'defs', 'title', 'desc', 'style', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'text', 'tspan', 'pattern', 'linearGradient', 'radialGradient', 'stop']);
const SHAPES = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'text']);
const STYLES = new Set(['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'display', 'visibility', 'background-color', 'shape-rendering', 'pointer-events']);
const NUMBER = '[-+]?(?:\\d*\\.\\d+|\\d+\\.?\\d*)(?:[eE][-+]?\\d+)?';
const numberRE = new RegExp(NUMBER, 'g');
let fontSequence = 0;
let resourceSequence = 0;

function fail(message, code = 'INVALID_SVG') {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function finite(values) { return values.every(Number.isFinite); }
function numbers(value) {
  const tokens = value.match(numberRE) || [];
  if (value.replace(numberRE, '').replace(/[\s,]/g, '')) fail('包含无法解析的数值。');
  const result = tokens.map(Number);
  if (!finite(result)) fail('数值必须是有限数。');
  return result;
}
function physical(value) {
  const match = String(value || '').trim().match(new RegExp(`^(${NUMBER})(mm|cm|in)$`, 'i'));
  return match ? Number(match[1]) * ({ mm: 1, cm: 10, in: 25.4 }[match[2].toLowerCase()]) : null;
}
function validateTransform(value) {
  let remaining = value;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^()]*)\)/g;
  const counts = { matrix: [6], translate: [1, 2], scale: [1, 2], rotate: [1, 3], skewX: [1], skewY: [1] };
  for (const match of value.matchAll(re)) {
    const parts = numbers(match[2]);
    if (!counts[match[1]].includes(parts.length)) fail('transform 参数不完整。');
    remaining = remaining.replace(match[0], '');
  }
  if (remaining.replace(/[\s,]/g, '')) fail('不支持或无法解析的 transform。');
}
function validatePath(value) {
  if (!value.trim()) return;
  const tokenRE = new RegExp(`[MmLlHhVvCcSsQqTtAaZz]|${NUMBER}`, 'g');
  const tokens = value.match(tokenRE) || [];
  if (value.replace(tokenRE, '').replace(/[\s,]/g, '')) fail('path 含无法解析的命令或数值。');
  if (!/^[Mm]$/.test(tokens[0])) fail('path 必须以 moveto 开始。');
  const arities = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
  let index = 0;
  while (index < tokens.length) {
    const command = tokens[index++].toUpperCase();
    if (!(command in arities)) fail('path 命令不完整。');
    const values = [];
    while (index < tokens.length && !/^[A-Za-z]$/.test(tokens[index])) values.push(Number(tokens[index++]));
    const count = arities[command];
    if (!finite(values) || (count ? !values.length || values.length % count : values.length)) fail('path 参数不完整或非有限数。');
    if (command === 'A') for (let i = 0; i < values.length; i += 7) {
      if (values[i] < 0 || values[i + 1] < 0 || ![0, 1].includes(values[i + 3]) || ![0, 1].includes(values[i + 4])) fail('椭圆弧参数无效。');
    }
  }
}
function safePaint(value) {
  if (/\\|\/\*|@|(?:expression|var)\s*\(/i.test(value)) fail('不支持转义、注释、外部样式变量或活动样式。');
  for (const match of value.matchAll(/url\s*\(([^)]*)\)/gi)) {
    if (!/^\s*['"]?#[A-Za-z_][\w:.-]*['"]?\s*$/.test(match[1])) fail('SVG 不允许外链或外部资源。');
  }
  if (/url/i.test(value.replace(/url\s*\([^)]*\)/gi, ''))) fail('资源引用无法验证。');
}

function validate(root) {
  const elements = [root, ...root.querySelectorAll('*')];
  if (elements.length > 5000) fail('SVG 结构过大；最多支持 5000 个节点。');
  const ids = new Set();
  const fonts = [];
  for (const element of elements) {
    if (element.namespaceURI !== NS || !TAGS.has(element.localName)) fail(`不支持 ${element.localName} 结构；请先转成静态 SVG 图元。`);
    if (element !== root && element.localName === 'svg') fail('暂不支持嵌套 SVG 视口；请保留 g 变换。');
    if (element.id) {
      if (ids.has(element.id)) fail(`重复对象 ID：${element.id}`);
      if (!element.closest('defs') && element.id.length > 120) fail('对象 ID 过长；最多支持 120 个字符，请缩短后重试。');
      ids.add(element.id);
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.localName.toLowerCase();
      const value = attribute.value;
      if (name.startsWith('on') || ['href', 'src', 'base', 'tabindex', 'autofocus'].includes(name)) fail('SVG 不允许事件、链接或活动内容。');
      if (['filter', 'clip-path', 'mask', 'marker', 'marker-start', 'marker-mid', 'marker-end', 'vector-effect'].includes(name) && value !== 'none') fail(`${name} 无法可信测量；请展开为静态图元后重试。`);
      if (name === 'transform' || name === 'patterntransform' || name === 'gradienttransform') validateTransform(value);
      if (name === 'd') validatePath(value);
      if (name === 'points') { if (numbers(value).length % 2) fail('points 坐标必须成对。'); }
      if (['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'stroke-width', 'stroke-miterlimit', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-size'].includes(name)) {
        if (/nan|infinity/i.test(value)) fail('SVG 包含非有限数。');
        const length = new RegExp(`^${NUMBER}(?:mm|cm|in|px|pt|pc|em|ex|%)?$`, 'i');
        const list = ['x', 'y'].includes(name) && ['text', 'tspan'].includes(element.localName);
        if (list ? value.trim().split(/[\s,]+/).some(part => !length.test(part)) : !length.test(value.trim())) fail(`无法解析 ${name} 数值。`);
        if (['r', 'rx', 'ry', 'width', 'height', 'stroke-width'].includes(name) && parseFloat(value) < 0) fail('图元尺寸和描边不能为负数。');
      }
      if (['fill', 'stroke', 'style', 'font-family'].includes(name) || /url\s*\(/i.test(value)) safePaint(value);
      if (name === 'style') {
        for (let i = 0; i < element.style.length; i++) {
          if (!STYLES.has(element.style[i])) fail(`不支持样式属性 ${element.style[i]}；无法可信测量。`);
        }
        // Invalid declarations otherwise disappear silently in CSSOM.
        for (const declaration of value.split(';').filter(part => part.trim())) {
          const property = declaration.split(':')[0].trim().toLowerCase();
          if (!STYLES.has(property)) fail(`不支持样式属性 ${property}。`);
        }
      }
    }
    if (element.localName === 'style') {
      const css = element.textContent;
      if (/\\|\/\*/.test(css)) fail('样式表包含无法验证的转义或注释。');
      const blocks = [...css.matchAll(/@font-face\s*\{([^{}]*)\}/gi)];
      if (!blocks.length || css.replace(/@font-face\s*\{[^{}]*\}/gi, '').trim()) fail('仅支持内嵌 data 字体的 @font-face；请把其他 CSS 转为图元属性。');
      for (const block of blocks) {
        const declaration = block[1];
        const family = declaration.match(/font-family\s*:\s*(['"])([^'"]+)\1\s*;/i);
        const source = declaration.match(/src\s*:\s*url\(\s*(data:font\/(?:truetype|ttf|otf|woff2?)(?:;charset=[\w-]+)?;base64,[A-Za-z0-9+/=]+)\s*\)(?:\s*format\(['"][\w-]+['"]\))?\s*;/i);
        if (!family || !source) fail('字体必须完整内嵌为 data:font，不允许外链字体。');
        const rest = declaration.replace(family[0], '').replace(source[0], '').replace(/font-(?:weight|style)\s*:\s*(?:normal|bold|italic|[1-9]00)\s*;/gi, '').trim();
        if (rest) fail('字体声明含不支持的属性。');
        fonts.push({ old: family[2], url: source[1], element });
      }
    }
  }
  for (const element of elements) for (const name of ['fill', 'stroke', 'style']) {
    for (const match of (element.getAttribute(name) || '').matchAll(/url\s*\(\s*['"]?#([\w:.-]+)['"]?\s*\)/gi)) {
      if (!ids.has(match[1])) fail(`资源引用 #${match[1]} 不存在。`);
    }
  }
  return fonts;
}

function mmMatrix(root, widthMm, heightMm, viewBox) {
  const [x, y, width, height] = viewBox;
  const aspect = (root.getAttribute('preserveAspectRatio') || 'xMidYMid meet').trim();
  if (!/^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?:\s+(?:meet|slice))?)$/.test(aspect)) fail('无法解析 preserveAspectRatio。');
  let sx = widthMm / width, sy = heightMm / height, ox = 0, oy = 0;
  if (aspect !== 'none') {
    sx = sy = aspect.endsWith('slice') ? Math.max(sx, sy) : Math.min(sx, sy);
    ox = (widthMm - width * sx) * (aspect.includes('xMin') ? 0 : aspect.includes('xMax') ? 1 : 0.5);
    oy = (heightMm - height * sy) * (aspect.includes('YMin') ? 0 : aspect.includes('YMax') ? 1 : 0.5);
  }
  return new DOMMatrix([sx, 0, 0, sy, ox - x * sx, oy - y * sy]);
}
function matrixFor(model, element) {
  const rootMatrix = model.svg.getCTM(), local = element.getCTM();
  if (!rootMatrix || !local || Math.abs(rootMatrix.a * rootMatrix.d - rootMatrix.b * rootMatrix.c) < 1e-12) fail('SVG 必须挂载到可测量的页面中。', 'MEASUREMENT_UNAVAILABLE');
  const matrix = model._mm.multiply(rootMatrix.inverse()).multiply(local);
  if (!finite([matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]) || Math.abs(matrix.a * matrix.d - matrix.b * matrix.c) < 1e-12) fail('零缩放或非有限变换无法可信测量。');
  return matrix;
}
function union(boxes) {
  return [Math.min(...boxes.map(box => box[0])), Math.min(...boxes.map(box => box[1])), Math.max(...boxes.map(box => box[2])), Math.max(...boxes.map(box => box[3]))];
}
function visible(element, root) {
  for (let current = element; current && current !== root.parentNode; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    if (current === root) break;
  }
  const style = getComputedStyle(element);
  const painted = value => value !== 'none' && value !== 'transparent' && value !== 'rgba(0, 0, 0, 0)';
  return (painted(style.fill) && Number(style.fillOpacity) > 0 && element.localName !== 'line') || (painted(style.stroke) && Number(style.strokeOpacity) > 0 && parseFloat(style.strokeWidth) > 0);
}
function leafBox(model, element) {
  let bbox;
  try { bbox = element.getBBox(); } catch { fail('浏览器无法测量此图元。', 'MEASUREMENT_UNAVAILABLE'); }
  if (!finite([bbox.x, bbox.y, bbox.width, bbox.height])) fail('图元边界包含非有限数。');
  const style = getComputedStyle(element);
  let padding = style.stroke !== 'none' && Number(style.strokeOpacity) > 0 ? parseFloat(style.strokeWidth) / 2 : 0;
  if (!Number.isFinite(padding)) fail('描边宽度无法测量。');
  if (style.strokeLinejoin === 'miter' && ['path', 'polygon', 'polyline', 'rect'].includes(element.localName)) padding *= Math.max(1, parseFloat(style.strokeMiterlimit) || 4);
  const m = matrixFor(model, element);
  const corners = [[bbox.x - padding, bbox.y - padding], [bbox.x + bbox.width + padding, bbox.y - padding], [bbox.x - padding, bbox.y + bbox.height + padding], [bbox.x + bbox.width + padding, bbox.y + bbox.height + padding]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
  return [Math.min(...corners.map(p => p.x)), Math.min(...corners.map(p => p.y)), Math.max(...corners.map(p => p.x)), Math.max(...corners.map(p => p.y))];
}
function refresh(model) {
  for (const object of model.objects) {
    object.box = union(object._leaves.map(element => leafBox(model, element)));
    object.circle = null;
    if (object.element.localName === 'circle') {
      const element = object.element, m = matrixFor(model, element);
      const sx = Math.hypot(m.a, m.b), sy = Math.hypot(m.c, m.d);
      if (Math.abs(sx - sy) < 1e-7 && Math.abs(m.a * m.c + m.b * m.d) < 1e-7) {
        const center = new DOMPoint(element.cx.baseVal.value, element.cy.baseVal.value).matrixTransform(m);
        const style = getComputedStyle(element);
        const stroke = style.stroke !== 'none' ? parseFloat(style.strokeWidth) / 2 : 0;
        object.circle = { x: center.x, y: center.y, r: (element.r.baseVal.value + stroke) * sx };
      }
    }
  }
}

export async function importSvg(source, mount, options = {}) {
  if (typeof source !== 'string' || !source.trim()) fail('请选择非空 SVG 文件。');
  if (new TextEncoder().encode(source).length > MAX_BYTES) fail('文件超过 2 MB，请简化后重试。');
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(source)) fail('不允许 DOCTYPE、实体或外部样式表。');
  const documentSvg = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (documentSvg.querySelector('parsererror')) fail('SVG XML 格式无效，请检查闭合标签。');
  const root = documentSvg.documentElement;
  if (root.localName !== 'svg' || root.namespaceURI !== NS) fail('文件必须是标准 SVG。');
  const fonts = validate(root);
  if (root.hasAttribute('transform')) fail('暂不支持根 SVG transform；请把变换放入 g 组。');
  let widthMm = physical(root.getAttribute('width')), heightMm = physical(root.getAttribute('height'));
  let scaleSource = 'explicit-mm';
  if (options.widthMm != null || options.heightMm != null) {
    widthMm = Number(options.widthMm); heightMm = Number(options.heightMm); scaleSource = 'user-mm';
  }
  if (!finite([widthMm, heightMm]) || widthMm == null || heightMm == null || widthMm <= 0 || heightMm <= 0) fail('SVG 没有可信物理尺寸；请输入打印宽、高（毫米）。', 'SCALE_REQUIRED');
  if (widthMm > 2000 || heightMm > 2000) fail('打印宽、高最多支持 2000 毫米。', 'INVALID_SCALE');
  let viewBox = root.hasAttribute('viewBox') ? numbers(root.getAttribute('viewBox')) : null;
  if (!viewBox) {
    const unit = value => {
      const mm = physical(value);
      if (mm != null) return mm * 96 / 25.4;
      const match = String(value || '').match(new RegExp(`^(${NUMBER})(?:px)?$`));
      return match ? Number(match[1]) : NaN;
    };
    viewBox = [0, 0, unit(root.getAttribute('width')), unit(root.getAttribute('height'))];
  }
  if (viewBox.length !== 4 || !finite(viewBox) || viewBox[2] <= 0 || viewBox[3] <= 0) fail('SVG 需要有效 viewBox 或明确的原始宽、高。');
  const warnings = ['此工具仅提供几何候选关系，不认证触觉可读性、盲文转写、打印工艺或标准合规。', '路径和旋转图元采用含描边的保守外接矩形；候选重叠须人工复核。'];
  const svg = document.importNode(root, true);
  // Resource IDs are private to this mounted drawing; point and label IDs stay stable.
  const resourceMap = new Map();
  const resourcePrefix = `tactile-resource-${++resourceSequence}-`;
  for (const resource of svg.querySelectorAll('defs [id]')) {
    const original = resource.getAttribute('data-preflight-resource-id') || resource.id;
    resourceMap.set(resource.id, `${resourcePrefix}${original}`);
    resource.setAttribute('data-preflight-resource-id', original);
    resource.id = `${resourcePrefix}${original}`;
  }
  for (const element of [svg, ...svg.querySelectorAll('*')]) for (const attribute of ['fill', 'stroke', 'style']) {
    if (!element.hasAttribute(attribute)) continue;
    element.setAttribute(attribute, element.getAttribute(attribute).replace(/url\s*\(\s*['"]?#([\w:.-]+)['"]?\s*\)/gi, (match, id) => `url(#${resourceMap.get(id) || id})`));
  }
  svg.setAttribute('viewBox', viewBox.join(' '));
  svg.setAttribute('width', `${widthMm}mm`); svg.setAttribute('height', `${heightMm}mm`);
  const _mm = mmMatrix(svg, widthMm, heightMm, viewBox);
  if (Math.abs(_mm.a - _mm.d) > 1e-7) warnings.push('打印尺寸采用非等比缩放；圆将按保守椭圆外接矩形处理，不能沿用圆的精确距离。');
  const familyMap = new Map();
  for (const font of fonts) if (!familyMap.has(font.old)) familyMap.set(font.old, `TactileEmbedded${++fontSequence}`);
  const loading = [];
  for (const style of svg.querySelectorAll('style')) {
    const matching = fonts.filter(font => font.element.textContent === style.textContent);
    style.textContent = matching.map(font => `@font-face { font-family: '${familyMap.get(font.old)}'; src: url(${font.url}); }`).join('\n');
    for (const font of matching) {
      const face = new FontFace(familyMap.get(font.old), `url(${font.url})`);
      loading.push(face.load().then(loaded => document.fonts.add(loaded)).catch(() => fail(`内嵌字体 ${font.old} 加载失败；不能可信测量。`, 'FONT_UNAVAILABLE')));
    }
  }
  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    for (const [old, replacement] of familyMap) {
      if (element.getAttribute('font-family') === old) element.setAttribute('font-family', replacement);
      if (element.style.fontFamily.replace(/['"]/g, '') === old) element.style.fontFamily = replacement;
    }
  }
  if (!(mount instanceof Element) || !mount.isConnected) fail('导入区域必须已连接到页面。', 'MEASUREMENT_UNAVAILABLE');
  mount.append(svg);
  try {
    await Promise.all(loading);
    await document.fonts.ready;
    const model = { source, svg, widthMm, heightMm, scaleSource, objects: [], warnings, _mm };
    const used = new Set([...svg.querySelectorAll('[id]')].map(element => element.id));
    const labelGroups = [...svg.querySelectorAll('[data-role="label"]')].filter(element => element.localName === 'g');
    if (labelGroups.some(group => group.parentElement.closest('[data-role="label"]'))) fail('标签组不能互相嵌套。');
    const candidates = [...labelGroups, ...svg.querySelectorAll('path,circle,ellipse,rect,line,polyline,polygon,text')].filter(element => !element.closest('defs') && !(element.closest('[data-role="label"]') && element.closest('[data-role="label"]') !== element && element.closest('[data-role="label"]').localName === 'g'));
    for (const element of candidates) {
      const leaves = element.localName === 'g' ? [...element.querySelectorAll('path,circle,ellipse,rect,line,polyline,polygon,text')].filter(leaf => visible(leaf, svg)) : (visible(element, svg) ? [element] : []);
      if (!leaves.length || (element.localName === 'path' && !element.getAttribute('d')?.trim())) continue;
      if (model.objects.length >= MAX_OBJECTS) fail('可见对象超过 800 个；请分图后重试。');
      let id = element.id;
      if (!id) { let n = model.objects.length + 1; do { id = `tactile-object-${n++}`; } while (used.has(id)); element.id = id; used.add(id); }
      const description = element.getAttribute('aria-roledescription') || '';
      const kind = element.getAttribute('data-role') === 'label' || element.localName === 'text' ? 'label' : element.getAttribute('data-role') === 'point' || /point/i.test(description) || element.localName === 'circle' ? 'point' : 'shape';
      const name = element.getAttribute('aria-label') || element.getAttribute('data-name') || (kind === 'label' ? element.textContent.trim() : '') || id;
      const auxiliary = Boolean(element.closest('[aria-roledescription="axis"],.role-axis')) || element.getAttribute('aria-hidden') === 'true';
      model.objects.push({ id, name, kind, association: element.getAttribute('data-association') || element.getAttribute('data-associated') || element.getAttribute('data-for') || null, box: null, element, auxiliary, _leaves: leaves });
      for (const leaf of leaves.filter(leaf => leaf.localName === 'text')) {
        const style = getComputedStyle(leaf), family = style.fontFamily;
        const generics = /^(?:serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i;
        if (!familyMap.size || ![...familyMap.values()].some(font => family.includes(font))) {
          const primary = family.split(',')[0].trim().replace(/['"]/g, '');
          if (!generics.test(primary)) warnings.push(`文本「${name}」使用非内嵌字体 ${primary}；字体是否安装无法可靠确认，浏览器替代字形可能改变打印边界。`);
        }
      }
    }
    if (!model.objects.length) fail('SVG 没有可见、可测量的对象。');
    if (model.objects.some(object => object.kind === 'label' && !object.association && !object.auxiliary)) warnings.push('部分标签没有所属对象；请在审查中手动关联，工具不根据距离猜测归属。');
    if (model.objects.some(object => object.auxiliary)) warnings.push('坐标轴和辅助图元仍保留，但不计入核心对象关系；轴线、刻度与网格请人工复核。');
    if ((svg.getAttribute('preserveAspectRatio') || '').includes('slice')) warnings.push('SVG 使用 slice；图元可能被页面边界裁切，边界候选仍需复核。');
    model.warnings = [...new Set(warnings)];
    refresh(model);
    model.objects = model.objects.filter(object => object.box[2] > object.box[0] && object.box[3] > object.box[1]);
    if (!model.objects.length) fail('SVG 没有具有可见面积的可测量对象。');
    return model;
  } catch (error) { svg.remove(); throw error; }
}

function gap(a, b) {
  if (a.circle && b.circle) return Math.max(0, Math.hypot(a.circle.x - b.circle.x, a.circle.y - b.circle.y) - a.circle.r - b.circle.r);
  if (a.circle || b.circle) {
    const circle = a.circle || b.circle, box = a.circle ? b.box : a.box;
    const x = Math.max(box[0] - circle.x, 0, circle.x - box[2]);
    const y = Math.max(box[1] - circle.y, 0, circle.y - box[3]);
    return Math.max(0, Math.hypot(x, y) - circle.r);
  }
  const x = Math.max(0, a.box[0] - b.box[2], b.box[0] - a.box[2]);
  const y = Math.max(0, a.box[1] - b.box[3], b.box[1] - a.box[3]);
  return Math.hypot(x, y);
}
export function analyze(model, { nearMm = 3 } = {}) {
  nearMm = Number(nearMm);
  if (!Number.isFinite(nearMm) || nearMm <= 0 || nearMm > 100) fail('候选间距须大于 0 且不超过 100 毫米。', 'INVALID_THRESHOLD');
  refresh(model);
  const relations = [], warnings = [...model.warnings];
  for (const object of model.objects) {
    if (object.association && !model.objects.some(target => target.id === object.association && target.kind !== 'label')) warnings.push(`标签「${object.name}」的所属对象不存在或仍是标签。`);
    if (object.box[0] < 0 || object.box[1] < 0 || object.box[2] > model.widthMm || object.box[3] > model.heightMm) warnings.push(`「${object.name}」的保守边界超出打印页面，请检查裁切。`);
  }
  for (let i = 0; i < model.objects.length; i++) for (let j = i + 1; j < model.objects.length; j++) {
    const a = model.objects[i], b = model.objects[j];
    const associated = (a.kind === 'label' && b.kind !== 'label' && a.association === b.id) || (b.kind === 'label' && a.kind !== 'label' && b.association === a.id);
    if ((a.auxiliary || b.auxiliary) && !associated) continue;
    const gapMm = gap(a, b);
    if (gapMm >= nearMm && !associated) continue;
    let type = gapMm <= 1e-7 ? 'overlap' : 'near';
    let message = gapMm <= 1e-7 ? '保守边界重叠，需人工复核。' : `边界间距 ${gapMm.toFixed(2)} 毫米，小于当前 ${nearMm} 毫米候选阈值。`;
    if (a.kind === 'point' && b.kind === 'point' && gapMm <= 1e-7) {
      type = 'coincident';
      message = a.box.every((value, index) => Math.abs(value - b.box[index]) < 1e-6) ? '两个独立数据点具有同一几何边界；保留各自身份，此关系不自动判为缺陷。' : '两个独立数据点的几何边界相交；保留各自身份，此关系不自动判为缺陷。';
    }
    if (associated) { type = 'association'; message = `标签与所属对象的几何间距 ${gapMm.toFixed(2)} 毫米；${gapMm < nearMm ? '小于当前候选阈值，' : ''}是否适当由制图者复核。`; }
    relations.push({ id: JSON.stringify([a.id, b.id]), a: a.id, b: b.id, gapMm, type, candidate: gapMm < nearMm && type !== 'coincident', message });
  }
  return { relations, warnings: [...new Set(warnings)] };
}

export function moveLabel(model, id, dxMm, dyMm) {
  const object = model.objects.find(item => item.id === id);
  if (!object || object.kind !== 'label') fail('只允许移动标签；数据点坐标保持原样。', 'NOT_A_LABEL');
  dxMm = Number(dxMm); dyMm = Number(dyMm);
  if (!finite([dxMm, dyMm]) || Math.abs(dxMm) > 2000 || Math.abs(dyMm) > 2000) fail('移动量必须是有限毫米值，且每轴不超过 2000 毫米。');
  const matrix = matrixFor(model, object.element), determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  const dx = (matrix.d * dxMm - matrix.c * dyMm) / determinant;
  const dy = (-matrix.b * dxMm + matrix.a * dyMm) / determinant;
  const old = object.element.getAttribute('transform');
  const oldGeometry = model.objects.map(item => ({ item, box: item.box, circle: item.circle }));
  object.element.setAttribute('transform', `${old || ''} translate(${dx} ${dy})`.trim());
  try { refresh(model); }
  catch (error) {
    if (old == null) object.element.removeAttribute('transform'); else object.element.setAttribute('transform', old);
    for (const geometry of oldGeometry) { geometry.item.box = geometry.box; geometry.item.circle = geometry.circle; }
    throw error;
  }
  return object;
}

export function serialize(model) {
  for (const object of model.objects) {
    if (object.kind === 'label' && object.association) {
      object.element.setAttribute('data-association', object.association);
      if (object.element.hasAttribute('data-associated')) object.element.setAttribute('data-associated', object.association);
      if (object.element.hasAttribute('data-for')) object.element.setAttribute('data-for', object.association);
    } else for (const attribute of ['data-association', 'data-associated', 'data-for']) object.element.removeAttribute(attribute);
  }
  return new XMLSerializer().serializeToString(model.svg);
}
