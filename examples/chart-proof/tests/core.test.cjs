const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../core.js');

const csv = 'series,x,y,kind,evidence,note\n甲,1,10,observed,公开表格第1行,\n甲,2,,missing,原图明确缺测,\n甲,3,20,approximate,原图读取,约值\n乙,1,30,interpolated,插值说明,人工插值';
const make = () => core.createProject(core.parseCSV(csv), {
  title: '季度图表', source: '公开材料', xLabel: '季度', yLabel: '数值',
  xScale: 'linear', yScale: 'linear', description: '供离线阅读'
});

test('导入真实CSV：保留五种数值身份与显式缺测', () => {
  const points = core.parseCSV(csv + '\n乙,2,35,,待复核来源,');
  assert.equal(points.length, 5);
  assert.deepEqual(points.map((point) => point.kind), ['observed', 'missing', 'approximate', 'interpolated', 'unconfirmed']);
  assert.equal(points[1].y, null);
  assert.equal(points[2].y, 20);
  assert.equal(points[2].note, '约值');
});

test('CSV支持BOM、CRLF、逗号、双引号及引号内换行', () => {
  const points = core.parseCSV('\uFEFFseries,x,y,kind,evidence,note\r\n"甲,乙",1,4,approximate,"图表""A""","第一行\n第二行"\r\n');
  assert.equal(points.length, 1);
  assert.equal(points[0].series, '甲,乙');
  assert.equal(points[0].evidence, '图表"A"');
  assert.equal(points[0].note, '第一行\n第二行');
});

test('中文表头与数字科学计数可用，负数在线性轴正常保留', () => {
  const points = core.parseCSV('系列,横轴,纵轴,类型,出处,备注\n甲,1e2,-2.5,观测,原始数据,负值有效');
  assert.equal(points[0].x, 100);
  assert.equal(points[0].y, -2.5);
  assert.equal(points[0].kind, 'observed');
});

test('输入上限实际接受5000点，超过上限明确拒绝', () => {
  const rows = Array.from({ length: 5000 }, (_, index) => `甲,${index},${index + 1}`);
  const input = 'series,x,y\n' + rows.join('\n');
  assert.equal(core.parseCSV(input).length, 5000);
  assert.throws(() => core.parseCSV(input + '\n甲,5000,5001'));
});

test('CSV拒绝无法解释和自相矛盾的输入', () => {
  for (const input of [
    '', 'series,x\n甲,1', 'series,x,y\n甲,no,3', 'series,x,y\n甲,1,Infinity',
    'series,x,y\n甲,1,NaN', 'series,x,y,kind\n甲,1,3,missing',
    'series,x,y,kind\n甲,1,,observed', 'series,x,y,kind\n甲,1,3,unknown',
    'series,x,y\n甲,1,3\n甲,1,4', 'series,x,y\n"甲,1,3'
  ]) assert.throws(() => core.parseCSV(input), undefined, input);
});

test('缺测分段不跨越空值产生趋势结论', () => {
  const summary = core.getSummary(make());
  assert.equal(summary.total, 4);
  assert.equal(summary.counts.missing, 1);
  const series = summary.series.find((item) => item.name === '甲');
  assert.equal(series.segments.length, 2);
  assert.deepEqual(series.segments.map((segment) => segment.count), [1, 1]);
  assert.ok(series.segments.every((segment) => segment.delta === 0 || segment.delta === null));
});

test('摘要按横轴排序，但不把未列出的横轴自动虚构为缺测', () => {
  const project = core.createProject(core.parseCSV('series,x,y\n甲,3,30\n甲,1,10'));
  const summary = core.getSummary(project);
  assert.equal(summary.counts.missing, 0);
  assert.equal(summary.series[0].segments.length, 1);
  assert.deepEqual(summary.series[0].segments[0].points.map((point) => point.x), [1, 3]);
});

test('复核要求责任人与证据，修改值后撤销复核并保留审计前后值', () => {
  const original = make();
  assert.throws(() => core.reviewPoint(original, 'p1', ''));
  const noEvidence = core.createProject(core.parseCSV('series,x,y\n甲,1,8'));
  assert.throws(() => core.reviewPoint(noEvidence, 'p1', '测试复核员'));
  const reviewed = core.reviewPoint(original, 'p1', '测试复核员', '依据来源核对');
  assert.equal(core.getSummary(reviewed).reviewed, 1);
  assert.equal(original.points[0].review.name, '');
  const changed = core.updatePoint(reviewed, 'p1', { y: 12, note: '更正' }, '测试复核员');
  assert.equal(changed.points[0].y, 12);
  assert.equal(changed.points[0].review.name, '');
  assert.equal(core.getSummary(changed).reviewed, 0);
  assert.equal(changed.history.length, 2);
  assert.equal(changed.history[1].before.y, 10);
  assert.equal(changed.history[1].after.y, 12);
  assert.equal(changed.history[1].actor, '测试复核员');
  assert.equal(reviewed.points[0].y, 10);
});

test('保存恢复保留复核、审计与元数据，修改导入对象不会污染原值', () => {
  const project = core.reviewPoint(make(), 'p1', '测试复核员', '已核验');
  const restored = core.importProject(JSON.stringify(project));
  assert.deepEqual(restored, project);
  restored.meta.title = '其他标题';
  assert.equal(project.meta.title, '季度图表');
});

test('项目恢复拒绝非法版本、重复ID、空点及非有限值', () => {
  for (const mutate of [
    (project) => { project.version = 999; },
    (project) => { project.points[1].id = project.points[0].id; },
    (project) => { project.points = []; },
    (project) => { project.points[0].y = 'wrong'; },
    (project) => { project.points[0].kind = 'missing'; },
    (project) => { project.meta.xScale = 'unknown'; },
    (project) => { project.history = [{ action: 'forged' }]; }
  ]) {
    const project = make(); mutate(project);
    assert.throws(() => core.importProject(JSON.stringify(project)));
  }
  assert.throws(() => core.importProject('{bad json'));
});

test('对数轴不能接受零与负值，失败修改不改变原项目', () => {
  const project = make();
  project.meta.xScale = 'log';
  project.points[0].x = 0;
  assert.throws(() => core.validateProject(project));
  const original = make();
  assert.throws(() => core.updatePoint(original, 'p1', { y: Infinity }));
  assert.equal(original.points[0].y, 10);
});

test('修改来源或轴尺度撤销复核，留下元数据审计记录', () => {
  const reviewed = core.reviewPoint(make(), 'p1', '测试复核员', '核对通过');
  const changed = core.updateMeta(reviewed, { ...reviewed.meta, source: '更正后的公开材料', yScale: 'log' }, '资料制作者');
  assert.equal(changed.meta.source, '更正后的公开材料');
  assert.equal(changed.meta.yScale, 'log');
  assert.equal(core.getSummary(changed).reviewed, 0);
  assert.equal(changed.history.at(-1).actor, '资料制作者');
  assert.equal(reviewed.meta.source, '公开材料');
});

test('独立HTML转义用户输入，包含数据、责任与缺测解释且无执行脚本', () => {
  const project = make();
  project.meta.title = '<img src=x onerror="alert(1)">';
  project.meta.source = '<script>alert(2)</script>';
  project.points[0].evidence = '<svg onload="alert(3)">';
  const html = core.exportHTML(project);
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /lang="zh-CN"/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script/);
  assert.doesNotMatch(html, /<script\b|<img src=x|<svg onload/i);
  assert.match(html, /缺测/);
  assert.match(html, /近似/);
  assert.match(html, /未复核/);
  assert.match(html, /<table\b/);
});

test('CSV导出抵御公式注入并保留缺测与中文来源', () => {
  const project = make();
  project.points[0].series = '=1+1';
  project.points[0].evidence = '@SUM(1,1)';
  project.points[0].note = '+危险';
  const output = core.exportCSV(project);
  assert.match(output, /'=1\+1/);
  assert.match(output, /'@SUM\(1,1\)/);
  assert.match(output, /'\+危险/);
  const points = core.parseCSV(output);
  assert.equal(points[1].kind, 'missing');
  assert.equal(points[1].y, null);
});

test('Markdown导出保留来源、近似和审计责任', () => {
  const project = core.reviewPoint(make(), 'p1', '测试复核员', '已核验');
  const markdown = core.exportMarkdown(project);
  assert.match(markdown, /公开材料/);
  assert.match(markdown, /近似/);
  assert.match(markdown, /缺测/);
  assert.match(markdown, /测试复核员/);
});
