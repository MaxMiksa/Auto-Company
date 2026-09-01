'use strict';

/**
 * Minimal YAML frontmatter parser.
 *
 * We deliberately do NOT pull in `gray-matter` or a YAML library: the only
 * shape we need to support is a flat block of `key: value` pairs between
 * `---` fences at the top of a markdown file. That covers the overwhelming
 * majority of real-world frontmatter (title, description, order, section).
 *
 * Anything we don't understand (nested objects, arrays, multi-line
 * scalars) is left as a raw string value rather than crashing — this is a
 * best-effort extraction tool, not a YAML validator.
 *
 * @param {string} raw - full file contents
 * @returns {{ data: Record<string, string>, content: string }}
 */
function parseFrontmatter(raw) {
  if (typeof raw !== 'string') {
    return { data: {}, content: '' };
  }

  // Frontmatter must start at the very top of the file with `---` on its
  // own line, optionally preceded by a UTF-8 BOM.
  const withoutBom = raw.replace(/^﻿/, '');
  const match = withoutBom.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);

  if (!match) {
    return { data: {}, content: withoutBom };
  }

  const block = match[1];
  const content = withoutBom.slice(match[0].length);
  const data = {};

  for (const line of block.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const sepIndex = trimmed.indexOf(':');
    if (sepIndex === -1) continue; // malformed line — skip, don't throw

    const key = trimmed.slice(0, sepIndex).trim();
    let value = trimmed.slice(sepIndex + 1).trim();

    if (!key) continue;

    // Strip matching surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }

    data[key] = value;
  }

  return { data, content };
}

module.exports = { parseFrontmatter };
