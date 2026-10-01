import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LIMITS, DEFAULT_RULES, parseTime, formatTime, parseSrt, validateRules, analyze, serializeSrt, createReport } from '../core.js';

const block = (number = '1', start = '00:00:00,000', end = '00:00:02,000', text = '你好') => `${number}\n${start} --> ${end}\n${text}`;
const cue = (id, startMs, endMs, text = '你好') => ({ id, sourceNumber: String(id * 10), line: id * 4 - 3, startMs, endMs, text });
const codes = (result) => result.issues.map((issue) => issue.code);

test('毫秒时码完整往返，包括两端边界', () => {
  for (const milliseconds of [0, 1, 999, 1000, 60000, 3600000, 359999999]) assert.equal(parseTime(formatTime(milliseconds)), milliseconds);
  assert.equal(formatTime(3723004), '01:02:03,004');
});

test('时码拒绝越界、非标准格式和非整数', () => {
  for (const value of ['0:00:00,000', '100:00:00,000', '00:60:00,000', '00:00:60,000', '00:00:00.000', '00:00:00,00', '00:00:00,000 ', '', 100]) assert.throws(() => parseTime(value));
  for (const value of [-1, 0.5, 360000000, NaN, Infinity, '100']) assert.throws(() => formatTime(value));
});

test('解析 BOM / CRLF，保留序号、物理行位置和原文空白', () => {
  const input = '\uFEFF\r\n' + block('009', '00:00:01,234', '00:00:03,456', '  <i>你好</i>  \n\t第二行').replaceAll('\n', '\r\n');
  const result = parseSrt(input);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.cues, [{ id: 1, sourceNumber: '009', line: 2, startMs: 1234, endMs: 3456, text: '  <i>你好</i>  \n\t第二行' }]);
});

test('空白分隔、末尾换行与无末尾换行均可解析', () => {
  const source = '\n\n' + block('0') + '\n\n\n' + block('999');
  for (const suffix of ['', '\n', '\n\n']) {
    const result = parseSrt(source + suffix);
    assert.equal(result.cues.length, 2);
    assert.deepEqual(result.cues.map((item) => item.id), [1, 2]);
  }
});

test('空文件与非法字符拒绝，错误行号准确', () => {
  for (const source of ['', '\n\n', '\uFEFF']) assert.equal(parseSrt(source).errors[0].code, 'empty_file');
  for (const character of ['\r', '\0', '\uD800']) {
    const result = parseSrt(block() + '\n' + character);
    assert.deepEqual(result.cues, []);
    assert.equal(result.errors[0].line, 4);
    assert.equal(result.errors[0].code, 'invalid_character');
  }
});

test('结构损坏 fail closed，不导出部分成功或丢弃尾部', () => {
  for (const bad of ['坏序号\n00:00:00,000 --> 00:00:02,000\n正文', '2\n00:00:00.000 --> 00:00:02,000\n正文', '残留正文', '2']) {
    const result = parseSrt(block() + '\n\n' + bad);
    assert.equal(result.cues.length, 0);
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors[0].line >= 5);
  }
});

test('缺空行导致的粘连字幕不伪装成成功正文', () => {
  const result = parseSrt(block() + '\n' + block('2'));
  assert.equal(result.cues.length, 0);
  assert.equal(result.errors[0].code, 'missing_separator');
  assert.equal(result.errors[0].line, 4);
});

test('保留没有正文的字幕，交由检查器报硬错误', () => {
  const result = parseSrt(block('1', '00:00:00,000', '00:00:02,000', '') + '\n\n' + block('2'));
  assert.equal(result.cues.length, 2);
  assert.equal(result.cues[0].text, '');
  assert.ok(codes(analyze(result.cues)).includes('empty_text'));
});

test('2 MiB 按 UTF-8 字节数严格执行，等于上限允许', () => {
  const prefix = block('1', '00:00:00,000', '00:00:02,000', '');
  const available = LIMITS.maxBytes - Buffer.byteLength(prefix);
  const text = '中'.repeat(Math.floor(available / 3)) + 'a'.repeat(available % 3);
  assert.equal(Buffer.byteLength(prefix + text), LIMITS.maxBytes);
  assert.equal(parseSrt(prefix + text).cues.length, 1);
  assert.equal(parseSrt(prefix + text + 'a').errors[0].code, 'size_limit');
});

test('5,000 条限制允许边界并拒绝第 5,001 条', () => {
  const input = Array.from({ length: LIMITS.maxCues }, (_, index) => block(String(index + 1))).join('\n\n');
  assert.equal(parseSrt(input).cues.length, LIMITS.maxCues);
  const result = parseSrt(input + '\n\n' + block('5001'));
  assert.equal(result.errors[0].code, 'cue_limit');
  assert.deepEqual(result.cues, []);
});

test('阈值校验拒绝 NaN、范围外、缺字段和非整数行数', () => {
  for (const update of [{ minDuration: 0 }, { maxDuration: 61 }, { minDuration: 8, maxDuration: 7 }, { maxCps: 0 }, { maxCps: 101 }, { maxCps: NaN }, { maxLines: 0 }, { maxLines: 11 }, { maxLines: 2.5 }, { minDuration: '0.8' }]) assert.throws(() => validateRules({ ...DEFAULT_RULES, ...update }));
  assert.throws(() => validateRules({}));
  assert.throws(() => validateRules(null));
  assert.deepEqual(validateRules({ minDuration: 0.1, maxDuration: 60, maxCps: 100, maxLines: 10, ignored: true }), { minDuration: 0.1, maxDuration: 60, maxCps: 100, maxLines: 10 });
});

test('时长、CPS 与行数阈值相等不报提示', () => {
  const cues = [cue(1, 0, 800, '好'), cue(2, 800, 7800, '你\n好'), cue(3, 8000, 9000, 'abcdefghijkl')];
  assert.equal(analyze(cues).issues.length, 0);
});

test('时长、CPS 与行数超过阈值才提示', () => {
  const result = analyze([cue(1, 0, 799), cue(2, 1000, 8001), cue(3, 9000, 10000, 'abcdefghijklm'), cue(4, 11000, 13000, '一\n二\n三')]);
  assert.deepEqual(codes(result), ['too_short', 'too_long', 'high_cps', 'too_many_lines']);
  assert.equal(result.stats.errors, 0);
});

test('字符采用 Unicode 码点、排除空白并保留标签计数', () => {
  assert.equal(analyze([cue(1, 0, 1000, '😀 😀\n好')], { ...DEFAULT_RULES, maxCps: 3 }).issues.length, 0);
  assert.ok(codes(analyze([cue(1, 0, 1000, '<b>好</b>')], { ...DEFAULT_RULES, maxCps: 7 })).includes('high_cps'));
});

test('零时长、负时长和空正文为错误', () => {
  const result = analyze([cue(1, 1000, 1000), cue(2, 2000, 1000), cue(3, 3000, 4000, ' \t')]);
  assert.equal(result.stats.errors, 3);
  assert.equal(result.stats.affected, 3);
  assert.equal(codes(result).filter((code) => code === 'nonpositive_duration').length, 2);
  assert.ok(!codes(result).includes('high_cps'));
});

test('非法时码、正文空行、控制字符与结构歧义均阻止导出', () => {
  const cases = [cue(1, -1, 2000), cue(1, 0, 360000000), cue(1, 0, 2.5), cue(1, 0, 2000, 'a\n\nb'), cue(1, 0, 2000, '\na'), cue(1, 0, 2000, 'a\n'), cue(1, 0, 2000, 'a\rb'), cue(1, 0, 2000, 'a\0b'), cue(1, 0, 2000, '\uD800'), cue(1, 0, 2000, '123\n00:00:00,000 --> 00:00:01,000')];
  for (const item of cases) {
    assert.ok(analyze([item]).stats.errors > 0);
    assert.throws(() => serializeSrt([item]));
  }
});

test('非相邻嵌套重叠检查覆盖每一条参与字幕', () => {
  const result = analyze([cue(1, 0, 10000), cue(2, 1000, 2000), cue(3, 3000, 4000), cue(4, 5000, 6000)]);
  assert.deepEqual(result.issues.filter((issue) => issue.code === 'overlap').map((issue) => issue.cueId), [1, 2, 3, 4]);
});

test('无序字幕也检测重叠，且不改变输入顺序', () => {
  const cues = [cue(1, 5000, 7000), cue(2, 0, 10000), cue(3, 3000, 4000)];
  const before = JSON.stringify(cues);
  const result = analyze(cues);
  assert.deepEqual(result.issues.filter((issue) => issue.code === 'out_of_order').map((issue) => issue.cueId), [2, 3]);
  assert.deepEqual(result.issues.filter((issue) => issue.code === 'overlap').map((issue) => issue.cueId), [1, 2, 3]);
  assert.equal(JSON.stringify(cues), before);
});

test('相接时间不重叠、相同开始时间会重叠', () => {
  assert.ok(!codes(analyze([cue(1, 0, 1000), cue(2, 1000, 2000)])).includes('overlap'));
  assert.equal(analyze([cue(1, 0, 1000), cue(2, 0, 2000)]).issues.filter((issue) => issue.code === 'overlap').length, 2);
});

test('统计按问题项计数，受影响条数去重，时长取最大结束值', () => {
  const result = analyze([cue(1, 10000, 11000), cue(2, 0, 500, 'abcdefghijklmnopqrstuvwxyz')]);
  assert.equal(result.stats.cues, 2);
  assert.equal(result.stats.durationMs, 11000);
  assert.equal(result.stats.warnings, 3);
  assert.equal(result.stats.affected, 1);
});

test('导出按原顺序连续编号，精确保留时码、标签、Unicode 和空白', () => {
  const input = [cue(1, 5000, 7000, ' <script>alert(1)</script> 😀  \n第二行\t'), cue(2, 1000, 4000, '后置的早字幕')];
  const exported = serializeSrt(input);
  assert.ok(exported.startsWith('1\n00:00:05,000'));
  assert.ok(exported.includes('\n\n2\n00:00:01,000'));
  assert.ok(!exported.includes('\r'));
  const reimported = parseSrt(exported);
  assert.deepEqual(reimported.errors, []);
  const content = (item) => ({ startMs: item.startMs, endMs: item.endMs, text: item.text });
  assert.deepEqual(reimported.cues.map(content), input.map(content));
});

test('空字幕列表、硬错误和超过大小的修改均拒绝导出', () => {
  assert.throws(() => serializeSrt([]));
  assert.throws(() => serializeSrt([cue(1, 0, 1000, '')]));
  assert.throws(() => serializeSrt([cue(1, 0, 1000, '中'.repeat(700000))]), /2 MiB/);
});

test('JSON 报告包含真实统计、规则、原始行位置与当前时码，不含正文', () => {
  const input = [cue(1, 1000, 1500, '一条私密字幕内容')];
  const report = createReport(input, DEFAULT_RULES, '测试.srt');
  const encoded = JSON.stringify(report);
  assert.ok(!encoded.includes(input[0].text));
  assert.equal(report.fileName, '测试.srt');
  assert.equal(report.version, '1.0');
  assert.deepEqual(report.stats, analyze(input).stats);
  assert.deepEqual(report.rules, DEFAULT_RULES);
  assert.equal(report.issues[0].sourceLine, 1);
  assert.equal(report.issues[0].sourceNumber, '10');
  assert.equal(report.issues[0].startTime, '00:00:01,000');
  assert.ok(report.counting.characters.includes('Unicode'));
});

test('问题样例覆盖全部提示类别且可导出，干净样例无问题', () => {
  const problem = parseSrt(readFileSync(new URL('../examples/problem.srt', import.meta.url), 'utf8'));
  const clean = parseSrt(readFileSync(new URL('../examples/clean.srt', import.meta.url), 'utf8'));
  assert.deepEqual(problem.errors, []);
  assert.equal(problem.cues.length, 8);
  assert.equal(analyze(problem.cues).stats.errors, 0);
  assert.deepEqual(new Set(codes(analyze(problem.cues))), new Set(['too_short', 'too_long', 'overlap', 'high_cps', 'too_many_lines', 'out_of_order']));
  assert.equal(parseSrt(serializeSrt(problem.cues)).cues.length, 8);
  assert.equal(clean.cues.length, 4);
  assert.deepEqual(analyze(clean.cues).issues, []);
});
