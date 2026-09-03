'use strict';

const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');

const FIXTURES = path.join(__dirname, 'fixtures');

test('returns null when no config file exists', () => {
  assert.equal(loadConfig(path.join(FIXTURES, 'basic-repo')), null);
});

test('loads and normalizes a valid config file', () => {
  const config = loadConfig(path.join(FIXTURES, 'config-repo'));
  assert.equal(config.title, 'Config-Driven Repo');
  assert.equal(config.baseUrl, 'https://example.com');
  assert.equal(config.sections.length, 2);
  assert.equal(config.sections[0].name, 'Docs');
  assert.equal(config.sections[0].pages[0].path, 'docs/page-a.md');
});

test('throws a descriptive error on invalid JSON', () => {
  assert.throws(
    () => loadConfig(path.join(FIXTURES, 'invalid-json-repo')),
    /Failed to parse .llms-txt.config.json/
  );
});

test('rejects a config file that is not a JSON object', () => {
  const { normalizeConfig } = require('../src/config');
  assert.throws(() => normalizeConfig([1, 2, 3]), /must contain a JSON object/);
  assert.throws(() => normalizeConfig(null), /must contain a JSON object/);
});

test('rejects a section missing a name', () => {
  const { normalizeConfig } = require('../src/config');
  assert.throws(
    () => normalizeConfig({ sections: [{ pages: [] }] }),
    /missing a "name" string/
  );
});
