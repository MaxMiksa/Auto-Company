'use strict';

const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('./frontmatter');
const { extractFirstH1, extractFirstParagraph, titleFromFilename } = require('./markdown');

/**
 * Read a markdown file and derive title/description using this priority:
 *   1. Frontmatter `title` / `description`
 *   2. First H1 in the body / first paragraph
 *   3. Filename-derived title / no description
 *
 * Never throws on a malformed or unreadable file — degrades to the
 * filename-based fallback instead, since a best-effort manifest is more
 * useful than a crashed CLI.
 *
 * @param {string} absPath
 * @param {string} rootDir
 * @returns {{ absPath: string, relPath: string, title: string, description: string|null, section: string|null }}
 */
function buildPageInfo(absPath, rootDir) {
  const relPath = path.relative(rootDir, absPath).split(path.sep).join('/');
  const filename = path.basename(absPath);

  let raw = '';
  try {
    raw = fs.readFileSync(absPath, 'utf8');
  } catch {
    raw = '';
  }

  let data = {};
  let body = raw;
  try {
    ({ data, content: body } = parseFrontmatter(raw));
  } catch {
    data = {};
    body = raw;
  }

  const title = firstNonEmpty([
    data.title,
    extractFirstH1(body),
    titleFromFilename(filename),
  ]);

  const description = firstNonEmpty([
    data.description,
    data.summary,
    extractFirstParagraph(body),
  ]);

  const section = firstNonEmpty([data.section, data.category]);

  return {
    absPath,
    relPath,
    title,
    description: description || null,
    section: section || null,
  };
}

function firstNonEmpty(values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

module.exports = { buildPageInfo };
