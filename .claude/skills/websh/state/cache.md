---
role: cache-management
summary: |
  How websh caches pages and extracts content. Includes the iterative extraction
  prompt that drives the haiku subagent, cache directory structure, and
  graceful degradation when extraction is incomplete.
see-also:
  - ../shell.md: Shell semantics
  - ../commands.md: Command reference
  - crawl.md: Eager crawl agent
---

# websh Cache Management

When you `cd` to a URL, websh fetches the HTML and spawns an async haiku subagent to extract rich content into a markdown file. This document defines the cache structure and extraction process.

---

## Directory Structure

```
.websh/
├── session.md                    # Current session state
├── cache/
│   ├── index.md                  # URL → slug mapping
│   ├── {slug}.html               # Raw HTML
│   └── {slug}.parsed.md          # Extracted content (by haiku)
├── history.md                    # Command history
└── bookmarks.md                  # Saved URLs
```

---

## URL to Slug Conversion

URLs become readable filenames:

**Algorithm:**
1. Remove protocol (`https://`)
2. Replace `/` with `-`
3. Replace special chars with `-`
4. Collapse multiple `-` to single
5. Trim to reasonable length (100 chars max)
6. Lowercase

**Examples:**

| URL | Slug |
|-----|------|
| `https://news.ycombinator.com` | `news-ycombinator-com` |
| `https://x.com/deepfates/status/123` | `x-com-deepfates-status-123` |
| `https://techcrunch.com/2024/06/25/smashing/` | `techcrunch-com-2024-06-25-smashing` |
| `https://example.com/path?q=test&a=1` | `example-com-path-q-test-a-1` |

---

## index.md

Tracks all cached URLs:

```markdown
# websh cache index

## Entries

| Slug | URL | Fetched | Status |
|------|-----|---------|--------|
| news-ycombinator-com | https://news.ycombinator.com | 2026-01-24T10:30:00Z | extracted |
| x-com-deepfates-status-123 | https://x.com/deepfates/status/123 | 2026-01-24T10:35:00Z | extracting |
| techcrunch-com-article | https://techcrunch.com/... | 2026-01-24T10:40:00Z | fetched |
```

**Status values:**
- `fetched` — HTML saved, extraction not started
- `extracting` — Haiku agent running
- `extracted` — Extraction complete

---

## Extraction: The Haiku Subagent

When `cd` completes the fetch, spawn an extraction agent:

```
Task({
  description: "websh: extract page content",
  prompt: <EXTRACTION_PROMPT>,
  subagent_type: "general-purpose",
  model: "haiku",
  run_in_background: true
})
```

### Extraction Prompt

````markdown
# websh Page Extraction

You are extracting useful content from a webpage for the websh cache.

## Input

URL: {url}
HTML file: {html_path}
Output file: {output_path}

## Task

Perform an **iterative intelligent parse** of the HTML. Make multiple passes,
each time extracting more useful detail. Write your findings to the output
markdown file, updating it as you go.

## Process

```
loop until extraction is thorough (typically 2-4 passes):
  1. Read the HTML file
  2. Read your current output (if exists)
  3. Identify what's missing or could be richer
  4. Update the output file with new findings
  5. Assess: is there more useful content to extract?
```

## Pass Focus

- **Pass 1**: Basic structure
  - Page title, main heading
  - All links (text + href)
  - Basic metadata (description, og tags)

- **Pass 2**: Content extraction
  - Main article/content text
  - Comments or discussion (if present)
  - Key quotes or highlights
  - Author, date, source info

- **Pass 3**: Structure and patterns
  - Navigation elements
  - Forms and inputs
  - Repeated patterns (list items, cards, etc.)
  - Site-specific structures (tweets, posts, stories)

- **Pass 4+**: Refinement
  - Clean up extracted text
  - Add context and relationships
  - Note anything unusual or interesting

## Output Format

Write to {output_path} in this format:

```markdown
# {url}

Fetched: {timestamp}
Passes: {n}
Status: {extracting|complete}

## Summary

{2-3 sentence summary of what this page is}

## Links

| # | Text | Href | Notes |
|---|------|------|-------|
| 0 | ... | ... | ... |
| 1 | ... | ... | ... |
...

## Content

### Main Content

{extracted article text, cleaned and readable}

### Comments/Discussion

{if applicable}

### Sidebar/Navigation

{notable navigation or related links}

## Structure

Page type: {article, list, profile, search results, etc.}

Key patterns:
- {selector} → {what it contains}
- ...

## Forms

### {form name/action}
- {field name} ({type})
- ...

## Media

- {images, videos, embeds}

## Metadata

- title: ...
- description: ...
- og:image: ...
- ...

## Extraction Notes

Pass 1: {what was extracted}
Pass 2: {what was added}
...
```

## Guidelines

1. **Be thorough but efficient** — Extract everything useful, skip boilerplate
2. **Preserve structure** — Keep hierarchy from the page
3. **Clean text** — Remove HTML artifacts, extra whitespace
4. **Index links** — Number them for easy `follow N` navigation
5. **Note patterns** — Identify site-specific structures
6. **Stay readable** — Output should be useful to both humans and grep

## Completion

After each pass, assess:
- Have I captured the main content?
- Are links properly indexed?
- Is there significant content I haven't extracted?
- Would another pass add meaningful value?

When extraction is thorough, update Status to `complete` and finish.

Write your final confirmation:
```
Extraction complete: {output_path}
Passes: {n}
Links: {count}
Content: {brief description}
```
````

---

## Graceful Degradation

Commands work even if extraction is incomplete:

| Command | If extracted | If only HTML |
|---------|--------------|--------------|
| `ls` | Rich links from markdown | Basic `<a>` tag parsing |
| `cat .selector` | From extracted content | Direct HTML parsing |
| `grep "pattern"` | Search extracted text | Search raw text |
| `stat` | Full metadata | Basic info |

### Checking extraction status

Before executing a command, check:

1. Does `{slug}.parsed.md` exist?
2. Does it contain `Status: complete`?

If complete, use the rich extracted content. Otherwise, fall back to HTML parsing or show what's available.

---

## Cache Files

### {slug}.html

Raw HTML exactly as fetched. Kept for:
- Fallback when extraction incomplete
- CSS selector queries that need full DOM
- Re-extraction if needed

### {slug}.parsed.md

The rich extracted content. Example:

```markdown
# https://news.ycombinator.com

Fetched: 2026-01-24T10:30:00Z
Passes: 3
Status: complete

## Summary

Hacker News front page. A tech-focused link aggregator showing 30 user-submitted
stories ranked by points. Mix of Show HN projects, technical articles, and
industry news.

## Links

| # | Text | Href | Notes |
|---|------|------|-------|
| 0 | Show HN: I built a tool for... | /item?id=41234567 | 142 pts, 87 comments |
| 1 | The State of AI in 2026 | /item?id=41234568 | 891 pts, 432 comments |
| 2 | Why Rust is eating the world | /item?id=41234569 | 234 pts, 156 comments |
| 3 | A deep dive into WebAssembly | /item?id=41234570 | 167 pts, 89 comments |
...

## Content

### Main Content

This is a link aggregator. Stories are displayed in a ranked list with:
- Title linking to external article or internal discussion
- Point count showing community votes
- Comment count linking to discussion

### Navigation

- [new](/newest) - Newest submissions
- [past](/front) - Previous front pages
- [comments](/newcomments) - Recent comments
- [ask](/ask) - Ask HN questions
- [show](/show) - Show HN projects
- [jobs](/jobs) - Job postings

## Structure

Page type: Link aggregator / News feed

Key patterns:
- .titleline → Story titles
- .score → Point counts
- .hnuser → Usernames
- .age → Submission time
- .subtext → Metadata row (points, user, time, comments)

## Forms

### Search (external)
- q (text) → Algolia HN search

### Login (/login)
- acct (text)
- pw (password)

## Media

None (text-only design)

## Metadata

- title: Hacker News
- (no meta description)
- (no og tags)

## Extraction Notes

Pass 1: Found 30 story links, basic structure
Pass 2: Extracted navigation, identified patterns
Pass 3: Added metadata, cleaned up content descriptions
```

---

## Session State

### session.md

```markdown
# websh session

started: 2026-01-24T10:30:00Z
pwd: https://news.ycombinator.com
pwd_slug: news-ycombinator-com

## Navigation Stack

- https://news.ycombinator.com

## Recent Commands

1. cd https://news.ycombinator.com
2. ls | head 5
3. grep "AI"
```

Updated after each command.

---

## Cache Expiration

Currently, cache does not auto-expire. Use `refresh` to re-fetch.

Future consideration: TTL-based expiration, staleness warnings.

---

## Initialization

On first websh command, if `.websh/` doesn't exist:

```bash
mkdir -p .websh/cache
touch .websh/session.md
touch .websh/history.md
touch .websh/bookmarks.md
echo "# websh cache index\n\n## Entries\n\n| Slug | URL | Fetched | Status |\n|------|-----|---------|--------|" > .websh/cache/index.md
```

Write initial session state:

```markdown
# websh session

started: {now}
pwd: (none)

## Navigation Stack

(empty)

## Recent Commands

(none)
```
