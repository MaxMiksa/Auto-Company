import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBatch, csvRows } from '../core.js';

test('English CSV translates every generated issue while preserving file identity', () => {
  const rules = { minWidth: 1200, minHeight: 1200, maxBytes: 50, formats: ['jpeg'], nameStyle: 'slug', prefix: 'product-' };
  const items = [
    { name: 'Large Name.png', format: 'png', width: 720, height: 720, bytes: 100 },
    { name: 'Large Name.png', format: 'png', width: 720, height: 720, bytes: 100 },
    { name: 'bad.png', format: null, width: null, height: null, bytes: 10 },
  ];
  evaluateBatch(items, rules);
  const exported = csvRows(items, rules, 'en');
  assert.doesNotMatch(exported, /[\u3400-\u9fff]/);
  for (const expected of ['minimum 1200 × 1200 px', 'maximum 50 B', 'PNG is not an allowed format', 'Duplicate filename', 'Filename is missing the prefix', 'Unable to check']) assert.ok(exported.includes(expected));
  assert.ok(exported.includes('Large Name.png'));
  assert.match(csvRows(items, rules), /本次检查规则/);
});

test('English export preserves Chinese user filenames and quoted text', () => {
  const rules = { minWidth: 0, minHeight: 0, maxBytes: Infinity, formats: ['png'], nameStyle: 'none', prefix: '' };
  const items = [{ name: '用户"原名.png', format: 'png', width: 10, height: 10, bytes: 100 }];
  evaluateBatch(items, rules);
  const exported = csvRows(items, rules, 'en');
  assert.match(exported, /用户""原名\.png/);
  assert.match(exported, /"Pass"/);
  assert.match(exported, /size<=not set/);
});
