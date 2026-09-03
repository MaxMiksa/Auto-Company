'use strict';

const fs = require('fs');
const path = require('path');

const { findMarkdownFiles } = require('./scan');
const { buildPageInfo } = require('./page');
const { loadConfig } = require('./config');
const { findSitemapUrls, titleFromUrl } = require('./sitemap');
const { matchesAny } = require('./glob');
const { parseFrontmatter } = require('./frontmatter');
const { extractFirstH1, extractFirstParagraph } = require('./markdown');

const README_CANDIDATES = ['README.md', 'README.mdx', 'Readme.md', 'readme.md'];

function findReadmePath(rootDir) {
  for (const name of README_CANDIDATES) {
    const p = path.join(rootDir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function readReadmeTitle(rootDir) {
  const readmePath = findReadmePath(rootDir);
  if (!readmePath) return null;
  try {
    const { data, content } = parseFrontmatter(fs.readFileSync(readmePath, 'utf8'));
    return firstNonEmpty([data.title, extractFirstH1(content)]);
  } catch {
    return null;
  }
}

function readReadmeSummary(rootDir) {
  const readmePath = findReadmePath(rootDir);
  if (!readmePath) return null;
  try {
    const { data, content } = parseFrontmatter(fs.readFileSync(readmePath, 'utf8'));
    return firstNonEmpty([data.description, data.summary, extractFirstParagraph(content)]);
  } catch {
    return null;
  }
}

/**
 * Generate an llms.txt document for `rootDir`.
 *
 * @param {string} rootDir - directory to scan
 * @param {object} [opts]
 * @param {object|null} [opts.config] - pre-loaded config (skips disk read); pass `undefined` to auto-load
 * @param {string} [opts.configPath] - explicit config file path
 * @param {string} [opts.title]
 * @param {string} [opts.summary]
 * @param {string} [opts.baseUrl]
 * @returns {{ content: string, warnings: string[], config: object|null }}
 */
function generateLlmsTxt(rootDir, opts = {}) {
  const warnings = [];
  const config = opts.config !== undefined ? opts.config : loadConfig(rootDir, opts.configPath);

  const pkg = readPackageJson(rootDir);

  const title = firstNonEmpty([
    opts.title,
    config?.title,
    pkg?.name,
    readReadmeTitle(rootDir),
    path.basename(path.resolve(rootDir)),
  ]);

  const summary = firstNonEmpty([
    opts.summary,
    config?.summary,
    pkg?.description,
    readReadmeSummary(rootDir),
    `Reference index for ${title}.`,
  ]);

  const description = firstNonEmpty([config?.description]);
  const baseUrl = firstNonEmpty([opts.baseUrl, config?.baseUrl]);

  let sections;
  if (config?.sections) {
    sections = buildSectionsFromConfig(config.sections, rootDir, baseUrl, warnings);
  } else {
    sections = discoverSections(rootDir, config, baseUrl, warnings);
  }

  const content = renderLlmsTxt({ title, summary, description, sections });
  return { content, warnings, config };
}

function buildSectionsFromConfig(configSections, rootDir, baseUrl, warnings) {
  return configSections.map((section) => {
    const links = [];
    for (const page of section.pages) {
      if (page.url) {
        links.push({
          title: page.title || titleFromUrl(page.url),
          description: page.description || null,
          href: page.url,
        });
        continue;
      }

      if (!page.path) {
        warnings.push(`Skipped a page in section "${section.name}": missing both "path" and "url".`);
        continue;
      }

      const absPath = path.resolve(rootDir, page.path);
      if (!fs.existsSync(absPath)) {
        warnings.push(`Skipped "${page.path}" in section "${section.name}": file not found.`);
        continue;
      }

      const info = buildPageInfo(absPath, rootDir);
      links.push({
        title: page.title || info.title,
        description: page.description || info.description,
        href: buildHref(info.relPath, baseUrl),
      });
    }
    return { name: section.name, links };
  });
}

function discoverSections(rootDir, config, baseUrl, warnings) {
  let files = findMarkdownFiles(rootDir);

  if (config?.include?.length) {
    files = files.filter((f) => matchesAny(relPathOf(f, rootDir), config.include));
  }
  if (config?.exclude?.length) {
    files = files.filter((f) => !matchesAny(relPathOf(f, rootDir), config.exclude));
  }

  if (files.length === 0) {
    const sitemapUrls = findSitemapUrls(rootDir);
    if (sitemapUrls.length === 0) {
      warnings.push(`No markdown files or sitemap.xml found under ${rootDir}.`);
      return [];
    }

    warnings.push('No markdown files found — falling back to sitemap.xml (titles are derived from URLs, so they may be imprecise).');
    return [
      {
        name: 'Pages',
        links: sitemapUrls.map((url) => ({ title: titleFromUrl(url), description: null, href: url })),
      },
    ];
  }

  const pages = files.map((f) => buildPageInfo(f, rootDir));
  const grouped = new Map(); // sectionName -> pages[]

  for (const page of pages) {
    const sectionName = page.section || deriveSectionName(page.relPath);
    if (!grouped.has(sectionName)) grouped.set(sectionName, []);
    grouped.get(sectionName).push(page);
  }

  const sectionNames = [...grouped.keys()].sort((a, b) => {
    if (a === 'Docs') return -1;
    if (b === 'Docs') return 1;
    if (a.toLowerCase() === 'optional') return 1;
    if (b.toLowerCase() === 'optional') return -1;
    return a.localeCompare(b);
  });

  return sectionNames.map((name) => {
    const sectionPages = grouped.get(name).slice().sort((a, b) => a.title.localeCompare(b.title));
    return {
      name,
      links: sectionPages.map((page) => ({
        title: page.title,
        description: page.description,
        href: buildHref(page.relPath, baseUrl),
      })),
    };
  });
}

/**
 * Section name for a discovered file: the immediate parent directory,
 * Title Cased. Root-level files (README.md, CONTRIBUTING.md, ...) land
 * in a "Docs" section since they have no parent directory to name them.
 */
function deriveSectionName(relPath) {
  const segments = relPath.split('/');
  if (segments.length <= 1) return 'Docs';
  const parent = segments[segments.length - 2];
  return titleCase(parent);
}

// Common short acronyms that look wrong Title Cased (e.g. "Ceo", "Qa").
// A small, boring lookup table beats a real acronym-detection algorithm
// for a section-heading cosmetic fix.
const KNOWN_ACRONYMS = new Set([
  'ai', 'api', 'ceo', 'cfo', 'cto', 'css', 'faq', 'html', 'id',
  'js', 'ml', 'qa', 'sdk', 'seo', 'sql', 'ui', 'url', 'ux',
]);

function titleCase(str) {
  return str
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => (KNOWN_ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

function buildHref(relPath, baseUrl) {
  if (baseUrl) return `${baseUrl}/${relPath}`;
  return `./${relPath}`;
}

function relPathOf(absPath, rootDir) {
  return path.relative(rootDir, absPath).split(path.sep).join('/');
}

function readPackageJson(rootDir) {
  const pkgPath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch {
    return null;
  }
}

function firstNonEmpty(values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function renderLlmsTxt({ title, summary, description, sections }) {
  const lines = [`# ${title}`, ''];

  if (summary) {
    lines.push(`> ${summary}`, '');
  }

  if (description) {
    lines.push(description, '');
  }

  for (const section of sections) {
    if (section.links.length === 0) continue;
    lines.push(`## ${section.name}`, '');
    for (const link of section.links) {
      const desc = link.description ? `: ${link.description}` : '';
      lines.push(`- [${link.title}](${link.href})${desc}`);
    }
    lines.push('');
  }

  // Trim trailing blank lines, then ensure exactly one final newline.
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n') + '\n';
}

module.exports = { generateLlmsTxt };
