'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.github',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'vendor',
  'coverage',
  '.cache',
  '.turbo',
]);

const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx', '.markdown']);

/**
 * Recursively find markdown files under `rootDir`.
 *
 * @param {string} rootDir
 * @param {{ ignoredDirs?: Set<string>, maxDepth?: number }} [options]
 * @returns {string[]} absolute file paths, sorted
 */
function findMarkdownFiles(rootDir, options = {}) {
  const ignoredDirs = options.ignoredDirs || DEFAULT_IGNORED_DIRS;
  const maxDepth = options.maxDepth ?? 12;
  const results = [];

  function walk(dir, depth) {
    if (depth > maxDepth) return;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory — skip rather than crash
    }

    for (const entry of entries) {
      // Skip dotfiles/dotdirs (.git, .env, .llms-txt.config.json, ...).
      // The config file is read separately by config.js — it's never a
      // markdown file, so excluding it here changes nothing besides
      // avoiding an unnecessary readdir/stat on `.git` etc.
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (ignoredDirs.has(entry.name)) continue;
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (MARKDOWN_EXTENSIONS.has(ext)) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(rootDir, 0);
  return results.sort();
}

module.exports = { findMarkdownFiles, DEFAULT_IGNORED_DIRS, MARKDOWN_EXTENSIONS };
