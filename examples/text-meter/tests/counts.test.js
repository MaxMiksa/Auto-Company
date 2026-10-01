import test from 'node:test';
import assert from 'node:assert/strict';
import { countText } from '../counts.js';

test('counts empty text as zero in every category', () => {
  assert.deepEqual(countText(''), {
    characters: 0,
    nonWhitespaceCharacters: 0,
    words: 0,
    lines: 0,
  });
});

test('counts whitespace while excluding it from non-whitespace characters and words', () => {
  assert.deepEqual(countText('  \t  '), {
    characters: 5,
    nonWhitespaceCharacters: 0,
    words: 0,
    lines: 1,
  });
});

test('counts multiple lines including a deliberate blank line', () => {
  assert.deepEqual(countText('first\n\nthird'), {
    characters: 12,
    nonWhitespaceCharacters: 10,
    words: 2,
    lines: 3,
  });
});

test('treats punctuation as characters within whitespace-separated English words', () => {
  assert.deepEqual(countText('Hello, world!'), {
    characters: 13,
    nonWhitespaceCharacters: 12,
    words: 2,
    lines: 1,
  });
});

test('counts Chinese Unicode characters without requiring spaces', () => {
  assert.deepEqual(countText('你好，世界'), {
    characters: 5,
    nonWhitespaceCharacters: 5,
    words: 1,
    lines: 1,
  });
});
