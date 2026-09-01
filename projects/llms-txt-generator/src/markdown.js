'use strict';

const MAX_DESCRIPTION_LENGTH = 180;

/**
 * Find the first ATX (`# Heading`) or Setext (`Heading\n===`) H1 in a
 * markdown body. Returns null if none is found.
 *
 * @param {string} body
 * @returns {string|null}
 */
function extractFirstH1(body) {
  if (!body) return null;
  const lines = body.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const atx = line.match(/^#\s+(.+?)\s*#*\s*$/);
    if (atx) return atx[1].trim();

    const next = lines[i + 1];
    if (next && /^=+\s*$/.test(next) && line.trim()) {
      return line.trim();
    }
  }

  return null;
}

/**
 * Best-effort "one line description" fallback: the first non-empty,
 * non-heading, non-code-fence paragraph line, trimmed to a sane length.
 * Used only when frontmatter provides no `description`.
 *
 * @param {string} body
 * @returns {string|null}
 */
function extractFirstParagraph(body) {
  if (!body) return null;
  const lines = body.split(/\r?\n/);
  let inCodeFence = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.startsWith('```') || line.startsWith('~~~')) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;
    if (!line) continue;
    if (line.startsWith('#')) continue;
    if (/^=+$/.test(line) || /^-+$/.test(line)) continue; // setext underline
    if (line.startsWith('>')) continue; // skip blockquotes (often badges/notes)
    if (line.startsWith('![')) continue; // skip bare image lines
    if (/^\[!\[/.test(line)) continue; // badge shields
    if (/^\|/.test(line)) continue; // table rows

    const cleaned = stripMarkdownInline(line);
    if (!cleaned) continue;

    return truncate(cleaned, MAX_DESCRIPTION_LENGTH);
  }

  return null;
}

function stripMarkdownInline(text) {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Turn a filename like `getting-started_v2.md` into `Getting Started V2`.
 * Used as the last-resort title fallback.
 *
 * @param {string} filename
 * @returns {string}
 */
function titleFromFilename(filename) {
  const base = filename.replace(/\.(md|mdx|markdown)$/i, '');
  return base
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

module.exports = {
  extractFirstH1,
  extractFirstParagraph,
  titleFromFilename,
  MAX_DESCRIPTION_LENGTH,
};
