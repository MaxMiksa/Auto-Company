'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  extractFirstH1,
  extractFirstParagraph,
  titleFromFilename,
} = require('../src/markdown');

test('extracts an ATX H1', () => {
  assert.equal(extractFirstH1('# Hello World\n\nBody'), 'Hello World');
});

test('extracts an ATX H1 with a trailing closing hash', () => {
  assert.equal(extractFirstH1('# Hello World #\n'), 'Hello World');
});

test('extracts a Setext H1', () => {
  assert.equal(extractFirstH1('Hello World\n===\n\nBody'), 'Hello World');
});

test('ignores H2+ when looking for H1', () => {
  assert.equal(extractFirstH1('## Not an H1\n\n# Actual H1'), 'Actual H1');
});

test('returns null when there is no heading', () => {
  assert.equal(extractFirstH1('Just a plain paragraph.'), null);
  assert.equal(extractFirstH1(''), null);
});

test('extracts the first real paragraph, skipping badges and images', () => {
  const body = [
    '# Title',
    '',
    '[![Build Status](https://ci.example.com/badge.svg)](https://ci.example.com)',
    '![hero image](./hero.png)',
    '',
    'This is the real description that should be picked up.',
    '',
    'A second paragraph that should be ignored.',
  ].join('\n');

  assert.equal(
    extractFirstParagraph(body),
    'This is the real description that should be picked up.'
  );
});

test('skips code fences when looking for a description paragraph', () => {
  const body = ['```js', 'const notADescription = true;', '```', '', 'Real description here.'].join(
    '\n'
  );

  assert.equal(extractFirstParagraph(body), 'Real description here.');
});

test('truncates very long paragraphs', () => {
  const long = 'x'.repeat(300);
  const result = extractFirstParagraph(long);
  assert.ok(result.length <= 180);
  assert.ok(result.endsWith('…'));
});

test('strips inline markdown formatting from the description', () => {
  const body = 'This has **bold**, *italic*, `code`, and a [link](https://example.com).';
  assert.equal(
    extractFirstParagraph(body),
    'This has bold, italic, code, and a link.'
  );
});

test('derives a readable title from a kebab-case filename', () => {
  assert.equal(titleFromFilename('getting-started.md'), 'Getting Started');
});

test('derives a readable title from a snake_case filename', () => {
  assert.equal(titleFromFilename('api_reference.mdx'), 'Api Reference');
});
