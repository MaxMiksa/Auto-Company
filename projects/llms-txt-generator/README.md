# llms-txt-generator

[![Test](https://github.com/thedarkbeet/llms-txt-generator/actions/workflows/test.yml/badge.svg)](https://github.com/thedarkbeet/llms-txt-generator/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](#)

Generate a spec-compliant [`llms.txt`](https://llmstxt.org) manifest from the
markdown files already in your repo. Works as a CLI or a GitHub Action.
Zero API keys, zero servers, zero npm dependencies.

## What is `llms.txt`, honestly

`llms.txt` is a proposed convention (see [llmstxt.org](https://llmstxt.org))
for a markdown file at your site's root that gives AI agents/crawlers a
curated map of your most important pages, so they don't have to crawl and
parse your whole HTML site to find them. It's modeled on `robots.txt` and
`sitemap.xml`.

**Be honest with yourself about where this stands today:** as of this
writing, no major AI crawler (GPTBot, ClaudeBot, Google-Extended,
PerplexityBot, etc.) has publicly confirmed that it fetches or parses
`llms.txt`. Some doc-generator plugins and AI dev tools already *produce*
it; it is not yet established that anything at scale *consumes* it. Adding
this file to your repo costs nothing and might matter a lot in a year — or
might quietly go nowhere, the way plenty of proposed web conventions do.
This tool treats it as a cheap, reversible bet, not a guaranteed win. Ship
it because it's free, not because it's proven.

## What this tool actually does

Given a directory, it:

1. Recursively scans for markdown files (`.md`, `.mdx`, `.markdown`),
   skipping the usual noise (`node_modules`, `.git`, `dist`, `build`, etc.).
2. For each file, pulls a title and description from:
   - YAML frontmatter (`title:` / `description:`), if present, else
   - the first `# H1` heading and first real paragraph in the body, else
   - the filename, turned into a readable title (`getting-started.md` →
     "Getting Started").
3. Groups pages into sections by their parent directory (`docs/ceo/*.md` →
   a "CEO" section; root-level files like `README.md` → a "Docs" section).
4. Falls back to `sitemap.xml` (parsing `<loc>` URLs) if no markdown files
   are found at all — titles in that case are derived from the URL slug,
   since sitemaps don't carry titles.
5. Writes a spec-shaped `llms.txt`:

   ```
   # Title

   > One-sentence summary

   ## Section Name

   - [Page Title](./relative/or/absolute/link.md): one-line description
   ```

Zero-config is the default: run it in a repo with markdown files and you
get a reasonable `llms.txt` with no setup. If you want more control, add a
`.llms-txt.config.json` (see below).

### What this tool deliberately does not do

- No OG/social-preview image generation. That's a separate, larger idea
  that's explicitly parked pending real adoption signal on this tool —
  see the project's internal decision docs if you're on the team that
  built this. Don't bolt it on here.
- No paid tier, license key, or "pro" gate of any kind. This is a free
  utility, distributed under the MIT license, full stop.
- No JavaScript rendering / SPA crawling. It reads markdown files and
  `sitemap.xml` from disk — it does not fetch or render your live site.
- No heavy YAML parser. Frontmatter parsing is hand-rolled and only
  understands flat `key: value` pairs, which is what the vast majority of
  real-world frontmatter looks like. Nested YAML structures in frontmatter
  are ignored, not crashed on.

## How this differs from crawler-based generators

Most other `llms.txt` generators (Firecrawl's, Apify's actor, and similar)
work by crawling your *live, deployed* site — fetching rendered HTML pages
over HTTP and summarizing them. That approach works on any website
regardless of source, but it means: your site has to be live and public
first, each run costs a crawl (often through a paid API), and the output
tracks whatever HTML got rendered, not your actual source of truth.

This tool reads your **markdown source directly from the filesystem** —
no HTTP, no rendering, no crawl budget. Consequences of that trade-off:

- It only works for repos that keep docs as markdown (which describes most
  documentation sites, READMEs, and static-site generators). It can't
  summarize a site with no markdown source, e.g. a CMS-backed blog with no
  local files.
- It runs in CI before you've deployed anything — `llms.txt` can be
  generated and committed in the same PR that adds the docs.
- It's exact, not summarized: titles/descriptions come from frontmatter or
  the file's own H1 and first paragraph, not an LLM's guess at what the
  page is about.
- It's free and offline: no API key, no per-crawl cost, no network call at
  all beyond `git clone`.

If your content lives outside markdown (a database-backed CMS, for
example), a crawler-based tool is the right choice. If your docs are
already markdown files in your repo, this tool skips the crawl entirely.

## Install / run as a CLI

No published npm package yet (this tool ships via GitHub, not npm — see
"Why no npm package" below). Run it directly from the GitHub repo with
`npx`:

```bash
npx github:thedarkbeet/llms-txt-generator
```

Or clone it and run locally:

```bash
git clone https://github.com/thedarkbeet/llms-txt-generator.git
cd llms-txt-generator
node bin/llms-txt-gen.js --dir /path/to/your/repo
```

### CLI options

```
llms-txt-gen [options]

  --dir <path>       Directory to scan (default: current directory)
  --output <path>    Where to write the file (default: llms.txt in --dir)
  --config <path>    Path to a config file (default: <dir>/.llms-txt.config.json)
  --base-url <url>   Prefix for generated links, e.g. https://example.com
  --title <string>   Override the top-level title
  --summary <string> Override the one-line blockquote summary
  --check            Exit 1 if the generated file would differ from what's on
                      disk (a CI drift check). Does not write anything.
  --stdout           Print the generated file instead of writing it
  -h, --help         Show help
```

Example:

```bash
node bin/llms-txt-gen.js --dir ./docs --base-url https://example.com
```

## Use as a GitHub Action

Add a workflow step that regenerates `llms.txt` whenever docs change:

```yaml
name: Update llms.txt

on:
  push:
    branches: [main]
    paths:
      - '**/*.md'
      - '**/*.mdx'

permissions:
  contents: write

jobs:
  update-llms-txt:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Generate llms.txt
        uses: thedarkbeet/llms-txt-generator@main
        with:
          dir: '.'
          base-url: 'https://example.com'

      - name: Commit changes
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add llms.txt
          git diff --staged --quiet || git commit -m "chore: update llms.txt"
          git push
```

Or use it as a CI gate that fails the build if `llms.txt` is stale, without
writing anything:

```yaml
      - name: Check llms.txt is up to date
        uses: thedarkbeet/llms-txt-generator@main
        with:
          check: 'true'
```

### Action inputs

| Input       | Default        | Description |
|-------------|----------------|-------------|
| `dir`       | `.`            | Directory to scan (relative to repo root) |
| `output`    | `llms.txt`     | Output path, relative to `dir` |
| `config`    | *(auto-detect)*| Path to `.llms-txt.config.json` |
| `base-url`  | *(none)*       | Prefix for links, e.g. `https://example.com` |
| `title`     | *(auto)*       | Override the `# Title` heading |
| `summary`   | *(auto)*       | Override the `> summary` blockquote |
| `check`     | `false`        | Fail instead of writing, if the file would change |

### Action outputs

| Output | Description |
|--------|-------------|
| `path` | Absolute path to the generated/checked `llms.txt` |

## Configuration: `.llms-txt.config.json`

Zero-config discovery is good enough for most repos. If you want explicit
control over sections, ordering, titles, or descriptions, drop a
`.llms-txt.config.json` in the directory you're scanning:

```json
{
  "title": "My Project",
  "summary": "One sentence describing what this project is.",
  "description": "Optional longer paragraph of context, shown under the summary.",
  "baseUrl": "https://example.com",
  "output": "llms.txt",
  "sections": [
    {
      "name": "Docs",
      "pages": [
        { "path": "README.md", "title": "Overview" },
        { "path": "docs/getting-started.md" }
      ]
    },
    {
      "name": "Optional",
      "pages": [
        { "url": "https://example.com/changelog", "title": "Changelog", "description": "Release history" }
      ]
    }
  ]
}
```

- If `sections` is present, it takes full control: only the pages you list
  are included, in the order and grouping you specify. `title`/
  `description` on a page entry override whatever frontmatter would have
  produced.
- Page entries support either `"path"` (a local markdown file, read for
  frontmatter/H1 fallback) or `"url"` (an arbitrary external link, no file
  needed).
- Without `sections`, `include`/`exclude` glob arrays let you narrow the
  zero-config directory scan, e.g. `"exclude": ["**/CHANGELOG.md", "test/**"]`.
- `baseUrl`, if set, is prepended to every relative file path to build
  absolute links (`https://example.com/docs/guide.md`). Without it, links
  are relative paths (`./docs/guide.md`) — fine for local inspection, but
  you almost certainly want `baseUrl` set for a real, deployed `llms.txt`.

## Why no npm package (yet)

This tool is distributed via GitHub (`npx github:...` and the GitHub
Action) rather than published to the npm registry. That's a sequencing
choice, not a design philosophy: publishing to npm requires publish
credentials this project doesn't currently have configured. The tool
itself has zero runtime dependencies, so nothing about using it requires
npm's registry — `npx github:...` and the Action both work today without
it.

## Development

```bash
npm test        # runs the full test suite (node's built-in test runner)
node bin/llms-txt-gen.js --dir . --stdout   # dogfood it on this repo
```

Tests cover: frontmatter parsing (well-formed, quoted values, unclosed
fences, malformed lines), zero-config generation, config-driven
generation, README-based title/summary fallback, and edge cases (no
markdown files found, malformed frontmatter, acronym directory names).

No test dependencies beyond Node itself — `node --test`.

## License

MIT — see [LICENSE](./LICENSE). Free tool, no strings attached.
