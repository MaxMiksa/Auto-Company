'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_FILENAME = '.llms-txt.config.json';

/**
 * Load `.llms-txt.config.json` from `rootDir`, if present.
 *
 * Returns `null` when no config file exists — that's the normal,
 * expected zero-config path, not an error.
 *
 * Throws a descriptive error only when a config file exists but is not
 * valid JSON, since that's a real authoring mistake the user should fix.
 *
 * @param {string} rootDir
 * @param {string} [configPath] - explicit path override
 * @returns {object|null}
 */
function loadConfig(rootDir, configPath) {
  const targetPath = configPath || path.join(rootDir, CONFIG_FILENAME);

  if (!fs.existsSync(targetPath)) {
    return null;
  }

  const raw = fs.readFileSync(targetPath, 'utf8');

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse ${path.relative(rootDir, targetPath) || targetPath}: ${err.message}`
    );
  }

  return normalizeConfig(parsed);
}

/**
 * Fill in defaults and shallow-validate shape so downstream code doesn't
 * need defensive checks scattered everywhere.
 */
function normalizeConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('.llms-txt.config.json must contain a JSON object.');
  }

  const normalized = {
    title: typeof config.title === 'string' ? config.title : null,
    summary: typeof config.summary === 'string' ? config.summary : null,
    description: typeof config.description === 'string' ? config.description : null,
    output: typeof config.output === 'string' ? config.output : 'llms.txt',
    baseUrl: typeof config.baseUrl === 'string' ? config.baseUrl.replace(/\/+$/, '') : null,
    include: Array.isArray(config.include) ? config.include : null,
    exclude: Array.isArray(config.exclude) ? config.exclude : null,
    sections: null,
  };

  if (Array.isArray(config.sections)) {
    normalized.sections = config.sections.map((section, i) => {
      if (!section || typeof section !== 'object') {
        throw new Error(`.llms-txt.config.json sections[${i}] must be an object.`);
      }
      if (typeof section.name !== 'string' || !section.name.trim()) {
        throw new Error(`.llms-txt.config.json sections[${i}] is missing a "name" string.`);
      }
      const pages = Array.isArray(section.pages) ? section.pages : [];
      return {
        name: section.name.trim(),
        pages: pages.map((page, j) => {
          if (typeof page === 'string') {
            return { path: page, title: null, description: null, url: null };
          }
          if (!page || typeof page !== 'object') {
            throw new Error(
              `.llms-txt.config.json sections[${i}].pages[${j}] must be a string or object.`
            );
          }
          return {
            path: typeof page.path === 'string' ? page.path : null,
            url: typeof page.url === 'string' ? page.url : null,
            title: typeof page.title === 'string' ? page.title : null,
            description: typeof page.description === 'string' ? page.description : null,
          };
        }),
      };
    });
  }

  return normalized;
}

module.exports = { loadConfig, normalizeConfig, CONFIG_FILENAME };
