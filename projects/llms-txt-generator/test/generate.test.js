'use strict';

const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateLlmsTxt } = require('../src/generate');

const FIXTURES = path.join(__dirname, 'fixtures');

test('zero-config: generates a reasonable llms.txt from plain markdown files', () => {
  const dir = path.join(FIXTURES, 'basic-repo');
  const { content, warnings } = generateLlmsTxt(dir);

  assert.deepEqual(warnings, []);
  assert.match(content, /^# Basic Repo\n/);
  assert.match(content, /> This is a sample project used to test/);

  // README.md (root) and docs/guide.md (parent dir "docs") share the "Docs" section.
  assert.match(content, /## Docs/);
  assert.match(content, /\[Getting Started Guide\]\(\.\/docs\/guide\.md\): Everything you need/);

  // docs/advanced/topic.md gets its own "Advanced" section from its parent dir.
  assert.match(content, /## Advanced/);
  assert.match(content, /\[Advanced Topic\]\(\.\/docs\/advanced\/topic\.md\): Only frontmatter title is set here/);

  // Frontmatter title wins over the file's own H1.
  assert.doesNotMatch(content, /This heading should be ignored/);
});

test('zero-config: relative links are used when no baseUrl is configured', () => {
  const dir = path.join(FIXTURES, 'basic-repo');
  const { content } = generateLlmsTxt(dir);
  assert.match(content, /\]\(\.\/README\.md\)|\]\(\.\/docs/);
  assert.doesNotMatch(content, /\]\(https?:\/\//);
});

test('config-driven: explicit sections and page order from .llms-txt.config.json', () => {
  const dir = path.join(FIXTURES, 'config-repo');
  const { content, warnings } = generateLlmsTxt(dir);

  assert.deepEqual(warnings, []);
  assert.match(content, /^# Config-Driven Repo\n/);
  assert.match(content, /> A repo whose llms\.txt is fully controlled by config\.\n/);

  // Section ordering follows the config, not alphabetical discovery order.
  const docsIndex = content.indexOf('## Docs');
  const optionalIndex = content.indexOf('## Optional');
  assert.ok(docsIndex > -1 && optionalIndex > -1 && docsIndex < optionalIndex);

  // baseUrl is applied to file-backed pages.
  assert.match(content, /\[Page A\]\(https:\/\/example\.com\/docs\/page-a\.md\): The first page/);

  // Explicit title override wins over the file's own H1.
  assert.match(content, /\[Page B \(Overridden Title\)\]\(https:\/\/example\.com\/docs\/page-b\.md\)/);
  assert.doesNotMatch(content, /Page B Heading/);

  // URL-only entries (no local file) are supported.
  assert.match(content, /\[Changelog\]\(https:\/\/example\.com\/changelog\): Release history\./);
});

test('edge case: no markdown files and no sitemap.xml produces a minimal file with a warning', () => {
  const dir = path.join(FIXTURES, 'empty-repo');
  const { content, warnings } = generateLlmsTxt(dir);

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /No markdown files or sitemap\.xml found/);
  assert.match(content, /^# empty-repo\n/);
  assert.match(content, /> Reference index for empty-repo\.\n/);
  assert.doesNotMatch(content, /^## /m);
});

test('edge case: malformed frontmatter degrades gracefully instead of throwing', () => {
  const dir = path.join(FIXTURES, 'malformed-repo');

  assert.doesNotThrow(() => generateLlmsTxt(dir));

  const { content, warnings } = generateLlmsTxt(dir);
  assert.deepEqual(warnings, []);

  // Unclosed fence: title falls back to the first real H1 found in the body.
  assert.match(content, /\[Real Heading\]/);

  // Well-formed frontmatter surrounded by one bad line still parses the good keys.
  assert.match(content, /\[Weird Lines\]\([^)]+\): Still parses the valid keys around the bad line\./);
});

test('overrides: explicit title/summary/baseUrl options win over everything else', () => {
  const dir = path.join(FIXTURES, 'basic-repo');
  const { content } = generateLlmsTxt(dir, {
    title: 'Overridden Title',
    summary: 'Overridden summary.',
    baseUrl: 'https://cdn.example.com',
  });

  assert.match(content, /^# Overridden Title\n/);
  assert.match(content, /> Overridden summary\.\n/);
  assert.match(content, /\]\(https:\/\/cdn\.example\.com\/docs\/guide\.md\)/);
});

test('zero-config: known acronym directory names are upper-cased in section headings', () => {
  const dir = path.join(FIXTURES, 'acronym-repo');
  const { content } = generateLlmsTxt(dir);
  assert.match(content, /## CEO/);
  assert.doesNotMatch(content, /## Ceo/);
});

test('output always ends with exactly one trailing newline', () => {
  const dir = path.join(FIXTURES, 'basic-repo');
  const { content } = generateLlmsTxt(dir);
  assert.ok(content.endsWith('\n'));
  assert.ok(!content.endsWith('\n\n'));
});
