'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseFrontmatter } = require('../src/frontmatter');

test('parses a well-formed frontmatter block', () => {
  const raw = [
    '---',
    'title: My Page',
    'description: A short description.',
    '---',
    '',
    '# Body heading',
    '',
    'Body text.',
  ].join('\n');

  const { data, content } = parseFrontmatter(raw);

  assert.equal(data.title, 'My Page');
  assert.equal(data.description, 'A short description.');
  assert.match(content, /^\n# Body heading/);
});

test('strips matching single and double quotes around values', () => {
  const raw = ['---', 'title: "Quoted Title"', "description: 'Single quoted'", '---', 'Body'].join(
    '\n'
  );

  const { data } = parseFrontmatter(raw);

  assert.equal(data.title, 'Quoted Title');
  assert.equal(data.description, 'Single quoted');
});

test('returns empty data and the original content when there is no frontmatter', () => {
  const raw = '# Just a heading\n\nSome text.';
  const { data, content } = parseFrontmatter(raw);

  assert.deepEqual(data, {});
  assert.equal(content, raw);
});

test('treats an unclosed frontmatter fence as ordinary body content, not a crash', () => {
  const raw = ['---', 'title: never closes', '', '# Real Heading', '', 'Body.'].join('\n');

  const { data, content } = parseFrontmatter(raw);

  assert.deepEqual(data, {});
  assert.equal(content, raw);
});

test('skips malformed lines inside a valid frontmatter block instead of throwing', () => {
  const raw = [
    '---',
    'title: Weird Lines',
    'this line has no colon and should be skipped',
    'description: still parses',
    '---',
    'Body.',
  ].join('\n');

  assert.doesNotThrow(() => parseFrontmatter(raw));
  const { data } = parseFrontmatter(raw);
  assert.equal(data.title, 'Weird Lines');
  assert.equal(data.description, 'still parses');
});

test('handles empty input without throwing', () => {
  assert.deepEqual(parseFrontmatter(''), { data: {}, content: '' });
  assert.deepEqual(parseFrontmatter(undefined), { data: {}, content: '' });
});
