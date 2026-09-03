'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Extract `<loc>` URLs from a sitemap.xml. Hand-rolled with a regex
 * rather than a full XML parser dependency — sitemap.xml has a
 * predictable, flat structure and we only need the URL list, not a DOM.
 *
 * @param {string} xml
 * @returns {string[]}
 */
function parseSitemapUrls(xml) {
  if (!xml) return [];
  const matches = [...xml.matchAll(/<loc>\s*([^<\s][^<]*?)\s*<\/loc>/gi)];
  return matches
    .map((m) => decodeXmlEntities(m[1].trim()))
    .filter(Boolean);
}

/**
 * Look for a sitemap.xml at the root of the target directory and return
 * its URLs, or an empty array if none exists / it can't be parsed.
 *
 * @param {string} rootDir
 * @returns {string[]}
 */
function findSitemapUrls(rootDir) {
  const sitemapPath = path.join(rootDir, 'sitemap.xml');
  if (!fs.existsSync(sitemapPath)) return [];

  try {
    const xml = fs.readFileSync(sitemapPath, 'utf8');
    return parseSitemapUrls(xml);
  } catch {
    return [];
  }
}

/**
 * Derive a human-ish title from a URL when no other metadata is
 * available (sitemap.xml carries no titles).
 *
 * @param {string} url
 * @returns {string}
 */
function titleFromUrl(url) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length === 0) return parsed.hostname;
    const last = segments[segments.length - 1].replace(/\.(html?|php)$/i, '');
    return last
      .split(/[-_]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ') || parsed.hostname;
  } catch {
    return url;
  }
}

function decodeXmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

module.exports = { parseSitemapUrls, findSitemapUrls, titleFromUrl };
