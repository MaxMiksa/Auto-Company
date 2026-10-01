export const LIMITS = Object.freeze({ maxBytes: 2097152, maxCues: 5000 });
export const DEFAULT_RULES = Object.freeze({ minDuration: 0.8, maxDuration: 7, maxCps: 12, maxLines: 2 });

const MAX_TIME = 359999999;
const TIME = /^(\d{2}):([0-5]\d):([0-5]\d),(\d{3})$/;
const TIMING_LINE = /^(\d{2}:[0-5]\d:[0-5]\d,\d{3})[ \t]+-->[ \t]+(\d{2}:[0-5]\d:[0-5]\d,\d{3})$/;
const byteLength = (value) => new TextEncoder().encode(value).length;
const validTime = (value) => Number.isInteger(value) && value >= 0 && value <= MAX_TIME;
const invalidUnicode = (value) => /[\uD800-\uDFFF]/u.test(value);

export function parseTime(value) {
  const match = typeof value === 'string' && TIME.exec(value);
  if (!match) throw new Error('时码须为 HH:MM:SS,mmm，小时 00–99，分秒 00–59。');
  return Number(match[1]) * 3600000 + Number(match[2]) * 60000 + Number(match[3]) * 1000 + Number(match[4]);
}

export function formatTime(ms) {
  if (!validTime(ms)) throw new Error('时码必须是 0 至 99:59:59,999 范围内的整数毫秒。');
  const pad = (value, width = 2) => String(value).padStart(width, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

export function parseSrt(text) {
  const fail = (line, code, message) => ({ cues: [], errors: [{ line, code, message }] });
  if (typeof text !== 'string') return fail(1, 'invalid_input', '请输入 UTF-8 SRT 文本。');
  if (byteLength(text) > LIMITS.maxBytes) return fail(1, 'size_limit', '文件超过 2 MiB 上限。');
  const illegal = /\r(?!\n)|\0|[\uD800-\uDFFF]/u.exec(text);
  if (illegal) return fail(text.slice(0, illegal.index).split('\n').length, 'invalid_character', '文本含孤立 CR、NUL 或无效 Unicode 字符。');
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  const cues = [];
  const errors = [];
  let cursor = 0;
  while (cursor < lines.length) {
    if (lines[cursor] === '') { cursor++; continue; }
    const begin = cursor;
    while (cursor < lines.length && lines[cursor] !== '') cursor++;
    const block = lines.slice(begin, cursor);
    if (!/^\d+$/.test(block[0])) {
      errors.push({ line: begin + 1, code: 'invalid_number', message: '字幕块须以独立数字序号开头；请检查空行分隔。' });
      continue;
    }
    const timing = TIMING_LINE.exec(block[1] ?? '');
    if (!timing) {
      errors.push({ line: begin + 2, code: 'invalid_timing', message: '时间行须为 HH:MM:SS,mmm --> HH:MM:SS,mmm。' });
      continue;
    }
    for (let index = 2; index < block.length - 1; index++) {
      if (/^\d+$/.test(block[index]) && block[index + 1].includes('-->')) {
        errors.push({ line: begin + index + 1, code: 'missing_separator', message: '相邻字幕之间缺少空行，无法安全区分正文。' });
      }
    }
    cues.push({ id: cues.length + 1, sourceNumber: block[0], line: begin + 1, startMs: parseTime(timing[1]), endMs: parseTime(timing[2]), text: block.slice(2).join('\n') });
    if (cues.length > LIMITS.maxCues) return fail(begin + 1, 'cue_limit', '字幕超过 5,000 条上限。');
  }
  if (!cues.length && !errors.length) return fail(1, 'empty_file', '文件中没有字幕。');
  return { cues: errors.length ? [] : cues, errors };
}

export function validateRules(rules) {
  if (!rules || typeof rules !== 'object') throw new Error('请填写完整的检查阈值。');
  const { minDuration, maxDuration, maxCps, maxLines } = rules;
  if (![minDuration, maxDuration].every((value) => Number.isFinite(value) && value >= 0.1 && value <= 60)) throw new Error('最短和最长时长须在 0.1–60 秒之间。');
  if (minDuration > maxDuration) throw new Error('最短时长不能大于最长时长。');
  if (!Number.isFinite(maxCps) || maxCps < 1 || maxCps > 100) throw new Error('每秒字符上限须在 1–100 之间。');
  if (!Number.isInteger(maxLines) || maxLines < 1 || maxLines > 10) throw new Error('行数上限须为 1–10 之间的整数。');
  return { minDuration, maxDuration, maxCps, maxLines };
}

export function analyze(cues, rules = DEFAULT_RULES) {
  const normalized = validateRules(rules);
  const issues = [];
  const add = (cue, code, severity, message) => issues.push({ cueId: cue.id, code, severity, message });
  let latestStart = -1;
  for (const cue of cues) {
    const timingValid = validTime(cue.startMs) && validTime(cue.endMs);
    if (!timingValid) add(cue, 'invalid_time', 'error', '时码超出有效范围或不是整数毫秒。');
    const duration = (cue.endMs - cue.startMs) / 1000;
    if (timingValid && duration <= 0) add(cue, 'nonpositive_duration', 'error', '结束时间必须晚于开始时间。');
    const textValid = typeof cue.text === 'string';
    if (!textValid || !cue.text.trim()) add(cue, 'empty_text', 'error', '字幕正文不能为空。');
    if (textValid && (cue.text.includes('\r') || cue.text.includes('\0') || invalidUnicode(cue.text))) add(cue, 'invalid_text', 'error', '正文含不支持的控制字符或无效 Unicode。');
    if (textValid && cue.text !== '' && cue.text.split('\n').includes('')) add(cue, 'blank_text_line', 'error', '正文不能含空行；空行是 SRT 字幕块的分隔符。');
    if (textValid && cue.text.split('\n').some((line, index, lines) => /^\d+$/.test(line) && (lines[index + 1] ?? '').includes('-->'))) add(cue, 'ambiguous_text', 'error', '正文含数字序号与时间箭头组合，重新导入时无法安全区分字幕块。');
    if (timingValid) {
      if (cue.startMs < latestStart) add(cue, 'out_of_order', 'warning', '开始时间早于前序字幕，请复核顺序。');
      latestStart = Math.max(latestStart, cue.startMs);
      if (duration > 0 && duration < normalized.minDuration) add(cue, 'too_short', 'warning', `显示时长 ${duration.toFixed(3)} 秒，低于 ${normalized.minDuration} 秒。`);
      if (duration > normalized.maxDuration) add(cue, 'too_long', 'warning', `显示时长 ${duration.toFixed(3)} 秒，超过 ${normalized.maxDuration} 秒。`);
    }
    if (textValid) {
      const lineCount = cue.text.split('\n').length;
      if (lineCount > normalized.maxLines) add(cue, 'too_many_lines', 'warning', `正文 ${lineCount} 行，超过 ${normalized.maxLines} 行。`);
      const characters = [...cue.text].filter((character) => !/\s/u.test(character)).length;
      if (timingValid && duration > 0 && characters / duration > normalized.maxCps) add(cue, 'high_cps', 'warning', `每秒 ${Number((characters / duration).toFixed(1))} 个字符，超过 ${normalized.maxCps}。`);
    }
  }
  // 按时间扫描最大结束点，覆盖嵌套区间，同时保持输出字幕顺序。
  const chronological = cues.filter((cue) => validTime(cue.startMs) && validTime(cue.endMs) && cue.endMs > cue.startMs).slice().sort((a, b) => a.startMs - b.startMs);
  const overlapping = new Set();
  let furthest = null;
  for (const cue of chronological) {
    if (furthest && cue.startMs < furthest.endMs) { overlapping.add(furthest.id); overlapping.add(cue.id); }
    if (!furthest || cue.endMs > furthest.endMs) furthest = cue;
  }
  for (const cue of cues) if (overlapping.has(cue.id)) add(cue, 'overlap', 'warning', '与其他字幕的显示时间重叠，请复核。');
  const order = new Map(cues.map((cue, index) => [cue.id, index]));
  issues.sort((a, b) => order.get(a.cueId) - order.get(b.cueId));
  return {
    issues,
    stats: { cues: cues.length, durationMs: cues.reduce((max, cue) => validTime(cue.endMs) ? Math.max(max, cue.endMs) : max, 0), errors: issues.filter((issue) => issue.severity === 'error').length, warnings: issues.filter((issue) => issue.severity === 'warning').length, affected: new Set(issues.map((issue) => issue.cueId)).size },
    rules: normalized,
  };
}

export function serializeSrt(cues) {
  if (!Array.isArray(cues) || !cues.length) throw new Error('没有可导出的字幕。');
  if (cues.length > LIMITS.maxCues) throw new Error('字幕超过 5,000 条上限。');
  if (analyze(cues).stats.errors) throw new Error('请先修复全部错误，再导出 SRT。');
  const result = cues.map((cue, index) => `${index + 1}\n${formatTime(cue.startMs)} --> ${formatTime(cue.endMs)}\n${cue.text}`).join('\n\n') + '\n';
  if (byteLength(result) > LIMITS.maxBytes) throw new Error('导出内容超过 2 MiB 上限，请缩减正文。');
  return result;
}

export function createReport(cues, rules = DEFAULT_RULES, fileName = '') {
  const result = analyze(cues, rules);
  const byId = new Map(cues.map((cue) => [cue.id, cue]));
  return {
    version: '1.0',
    tool: 'CueCheck',
    fileName,
    rules: result.rules,
    counting: { characters: 'Unicode 码点数，排除空白，标签按原文计数；并非精准阅读难度。', errorsAndWarnings: '按问题项计数，同一字幕可有多个问题。', duration: '最大结束时码；不是显示时长之和。', overlap: '每条参与重叠的字幕记一个提示，相接边界不算重叠。' },
    scope: '仅检查本工具覆盖的问题，不检查翻译和音视频同步，不代表平台合规认证。',
    stats: result.stats,
    issues: result.issues.map((issue) => {
      const cue = byId.get(issue.cueId);
      return { ...issue, sourceNumber: cue.sourceNumber, sourceLine: cue.line, startMs: cue.startMs, endMs: cue.endMs, startTime: validTime(cue.startMs) ? formatTime(cue.startMs) : null, endTime: validTime(cue.endMs) ? formatTime(cue.endMs) : null };
    }),
  };
}
