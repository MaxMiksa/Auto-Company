import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, audit, toCSV, reportHTML, validateArchive } from '../core.js';

// Synthetic procurement evidence. These cases do not represent real purchases.
const spec = (changes = {}) => ({
  mpn: 'SYNTH-PUMP-1', parameter: 'pressure_limit', value: '10', unit: 'bar',
  revision: 'A', source: 'synthetic-datasheet.csv', locator: 'table 1, row 4',
  quote: 'Pressure limit: 10 bar', ...changes,
});
const requirement = (changes = {}) => ({
  mpn: 'SYNTH-PUMP-1', parameter: 'pressure_limit', operator: 'min', value: '8', unit: 'bar', ...changes,
});
const check = (old = [spec()], next = [spec()], requirements = [requirement()]) => audit(old, next, requirements);
const only = (findings) => {
  assert.equal(findings.length, 1, 'one MPN/parameter produces one traceable finding');
  assert.ok(findings[0].id);
  assert.ok(Array.isArray(findings[0].reasons));
  return findings[0];
};
const uncertain = (findings) => {
  assert.ok(findings.length > 0);
  assert.ok(findings.every((finding) => finding.severity !== 'clear'), 'ambiguous evidence cannot be clear');
};
const rejectedOrUncertain = (operation) => {
  let findings;
  try { findings = operation(); } catch (error) {
    assert.ok(error instanceof Error);
    assert.ok(error.message.trim(), 'rejected input explains the problem');
    return;
  }
  uncertain(findings);
};
const exportCells = (csv) => [...csv.matchAll(/"((?:[^"]|"")*)"/g)].map((match) => match[1].replace(/""/g, '"'));
const archive = (changes = {}) => ({
  version: 1, title: 'Synthetic audit',
  inputs: { old: 'mpn,parameter,value,unit,revision,source,locator,quote\nSYNTH-PUMP-1,pressure_limit,10,bar,A,fixture,row 1,10 bar',
    new: 'mpn,parameter,value,unit,revision,source,locator,quote\nSYNTH-PUMP-1,pressure_limit,6,bar,B,fixture,row 1,6 bar',
    requirements: 'mpn,parameter,operator,value,unit\nSYNTH-PUMP-1,pressure_limit,min,8,bar' },
  reviews: {}, savedAt: '2026-10-01T00:00:00.000Z', ...changes,
});

test('CSV preserves quoted commas, multiline evidence, BOM and escaped quotes', () => {
  const rows = parseCSV('\uFEFFmpn,parameter,value,unit,revision,source,locator,quote\r\nSYNTH-PUMP-1,pressure_limit,10,bar,A,"sheet, A","p. 3","line 1\nline 2: ""10 bar"""\r\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].mpn, 'SYNTH-PUMP-1');
  assert.equal(rows[0].source, 'sheet, A');
  assert.equal(rows[0].quote, 'line 1\nline 2: "10 bar"');
});

test('malformed CSV cannot silently discard evidence or invent columns', () => {
  for (const text of ['mpn,quote\nX,"unterminated', 'mpn,quote\nX,a,extra', 'mpn,mpn\nX,Y']) {
    assert.throws(() => parseCSV(text));
  }
});

test('unchanged complete evidence with an explicit satisfied requirement is clear', () => {
  const finding = only(check());
  assert.equal(finding.severity, 'clear');
  assert.deepEqual(finding.oldEvidence, { source: 'synthetic-datasheet.csv', locator: 'table 1, row 4', quote: 'Pressure limit: 10 bar' });
  assert.deepEqual(finding.newEvidence, finding.oldEvidence);
  assert.equal(finding.mpn, 'SYNTH-PUMP-1');
  assert.match(finding.requirement, /8/);
});

test('10 to 6 bar against 8 bar blocks even when the revision is unchanged', () => {
  const finding = only(check([spec()], [spec({ value: '6', quote: 'Pressure limit: 6 bar' })]));
  assert.equal(finding.severity, 'block');
  assert.equal(String(finding.oldValue), '10');
  assert.equal(String(finding.newValue), '6');
  assert.ok(finding.reasons.length > 0);
});

test('changed numerical value that still satisfies a requirement needs review', () => {
  assert.equal(only(check([spec()], [spec({ value: '9', quote: 'Pressure limit: 9 bar' })])).severity, 'review');
});

test('revision-only change stays visible and requires human review', () => {
  const finding = only(check([spec()], [spec({ revision: 'B' })]));
  assert.equal(finding.severity, 'review');
  assert.equal(finding.oldRevision, 'A');
  assert.equal(finding.newRevision, 'B');
});

test('known pressure units compare by quantity rather than raw digits', () => {
  const finding = only(check([spec()], [spec({ value: '1000', unit: 'kPa', quote: 'Pressure limit: 1000 kPa' })]));
  assert.equal(finding.severity, 'clear', '1000 kPa and 10 bar are physically equivalent');
  assert.equal(only(check([spec()], [spec({ value: '600', unit: 'kPa', quote: 'Pressure limit: 600 kPa' })])).severity, 'block');
});

test('max, min and equals requirements retain their distinct meanings', () => {
  assert.equal(only(check([spec()], [spec()], [requirement({ operator: 'max', value: '9' })])).severity, 'block');
  assert.equal(only(check([spec()], [spec()], [requirement({ operator: 'equals', value: '9' })])).severity, 'block');
  assert.equal(only(check([spec()], [spec()], [requirement({ operator: 'equals', value: '1000', unit: 'kPa' })])).severity, 'clear');
});

test('empty or missing new specification remains unknown rather than qualified', () => {
  uncertain(check([spec()], []));
  uncertain(check([spec()], [spec({ value: '', quote: '' })]));
});

test('requirement-only parameter appears even if absent from both spec tables', () => {
  uncertain(check([], [], [requirement()]));
});

test('different MPNs never become a matched before/after pair', () => {
  const findings = check([spec()], [spec({ mpn: 'SYNTH-PUMP-2' })]);
  uncertain(findings);
  assert.ok(findings.some((finding) => finding.mpn === 'SYNTH-PUMP-1'));
  assert.ok(findings.some((finding) => finding.mpn === 'SYNTH-PUMP-2'));
});

test('unknown or incompatible units do not pass on a raw numerical match', () => {
  uncertain(check([spec()], [spec({ unit: 'mystery-pressure' })]));
  uncertain(check([spec()], [spec({ unit: 'V' })]));
});

test('each missing evidence field prevents an unqualified clear result', () => {
  for (const field of ['source', 'locator', 'quote']) {
    uncertain(check([spec()], [spec({ [field]: '' })]));
    uncertain(check([spec({ [field]: '' })], [spec()]));
  }
});

test('no requirement means no claim of qualification', () => {
  uncertain(check([spec()], [spec()], []));
});

test('duplicate and conflicting rows cannot silently choose one answer', () => {
  uncertain(check([spec()], [spec(), spec()]));
  uncertain(check([spec()], [spec(), spec({ value: '6', quote: 'Pressure limit: 6 bar' })]));
  uncertain(check([spec(), spec({ value: '6' })], [spec()]));
});

test('all supplied constraints are evaluated, not just the first', () => {
  const finding = only(check([spec()], [spec()], [requirement(), requirement({ operator: 'max', value: '9' })]));
  assert.equal(finding.severity, 'block');
});

test('invalid numbers or unsupported operators cannot produce clear results', () => {
  rejectedOrUncertain(() => check([spec()], [spec({ value: '10-ish' })]));
  rejectedOrUncertain(() => check([spec()], [spec()], [requirement({ operator: 'approx' })]));
  rejectedOrUncertain(() => check([spec()], [spec()], [requirement({ value: 'eight' })]));
});

test('CSV exports carry evidence and human review without changing severity', () => {
  const findings = check([spec()], [spec({ value: '6', quote: 'Pressure limit: 6 bar' })]);
  const reviews = { [findings[0].id]: { decision: 'accepted', reviewer: 'Synthetic reviewer', note: 'Retain the block.' } };
  const csv = toCSV(findings, reviews);
  assert.ok(exportCells(csv).includes('block'));
  for (const text of ['accepted', 'Synthetic reviewer', 'Retain the block.', 'Pressure limit: 6 bar', 'table 1, row 4']) {
    assert.ok(csv.includes(text), `CSV retains ${text}`);
  }
  assert.equal(findings[0].severity, 'block');
});

test('CSV formula injection is neutralized for evidence and review fields', () => {
  const findings = check([spec()], [spec({ value: '6', source: '=HYPERLINK("https://example.invalid")', locator: '+1+1', quote: '@SUM(1,1)' })]);
  const csv = toCSV(findings, { [findings[0].id]: { decision: 'needs-info', reviewer: '-1+1', note: '\t=2+2' } });
  assert.ok(exportCells(csv).length > 20);
  for (const cell of exportCells(csv)) assert.doesNotMatch(cell, /^[\t\r\n ]*[=+@-]/);
});

test('print report escapes HTML in title, evidence and review notes', () => {
  const payload = '<img src=x onerror="globalThis.pwned=true">';
  const findings = check([spec()], [spec({ value: '6', quote: payload })]);
  const html = reportHTML(findings, { [findings[0].id]: { decision: 'needs-info', reviewer: 'Synthetic reviewer', note: payload } }, payload);
  assert.doesNotMatch(html, /<img\b/i);
  assert.ok(html.includes('&lt;img'));
  assert.match(html, /block|阻断/);
});

test('validated archive preserves inputs, reviews and optional attachment metadata', () => {
  const data = archive({ attachments: [] });
  const restored = validateArchive(data);
  assert.equal(restored.version, 1);
  assert.deepEqual(restored.inputs, data.inputs);
  assert.deepEqual(restored.reviews, {});
});

test('empty and unfinished draft archives preserve source text for later correction', () => {
  for (const inputs of [{ old: '', new: '', requirements: '' }, { old: 'unfinished CSV', new: '', requirements: '' }]) {
    const restored = validateArchive(archive({ inputs }));
    assert.deepEqual(restored.inputs, inputs);
    assert.deepEqual(restored.reviews, {});
  }
});

test('archive reviews must cite a current finding and preserve its original severity', () => {
  const data = archive();
  const findings = audit(parseCSV(data.inputs.old), parseCSV(data.inputs.new), parseCSV(data.inputs.requirements));
  const id = only(findings).id;
  data.reviews = { [id]: { decision: 'accepted', reviewer: 'Synthetic reviewer', note: 'Record acceptance; retain risk.' } };
  const restored = validateArchive(data);
  assert.deepEqual(restored.reviews, data.reviews);
  assert.equal(only(audit(parseCSV(restored.inputs.old), parseCSV(restored.inputs.new), parseCSV(restored.inputs.requirements))).severity, 'block');
  assert.throws(() => validateArchive(archive({ reviews: { missing: data.reviews[id] } })));
});

test('attachment metadata keeps valid text and rejects unsafe names or corrupt encoding', () => {
  const attachment = { name: 'synthetic-evidence.txt', type: 'text/plain', size: 5,
    sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824', data: 'aGVsbG8=' };
  assert.deepEqual(validateArchive(archive({ attachments: [attachment] })).attachments, [attachment]);
  for (const change of [{ name: '../secret.txt' }, { size: 4 }, { type: 'text/html' }, { data: 'not base64?' }, { sha256: 'bad' }]) {
    assert.throws(() => validateArchive(archive({ attachments: [{ ...attachment, ...change }] })));
  }
});

test('corrupt or incompatible archives reject before restore can mutate work', () => {
  const corrupt = [null, [], {}, archive({ version: 2 }), archive({ inputs: { old: '', new: '' } }),
    archive({ inputs: { old: 7, new: '', requirements: '' } }), archive({ reviews: [] }),
    archive({ reviews: { row: { decision: 'approved', reviewer: 'X', note: '' } } }),
    archive({ reviews: { row: { decision: 'accepted', reviewer: 42, note: '' } } })];
  for (const data of corrupt) assert.throws(() => validateArchive(data));
});
