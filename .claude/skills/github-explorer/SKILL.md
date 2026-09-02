---
name: github-explorer
description: >
  Deep-dive analysis of GitHub projects. Use when the user mentions a GitHub repo/project name
  and wants to understand it — triggered by phrases like "take a look at this project",
  "tell me about XXX", "what's this project like", "analyze this repo", or any request to
  explore/evaluate a GitHub project.
  Covers architecture, community health, competitive landscape, and cross-platform knowledge sources.
---

# GitHub Explorer — Deep Project Analysis

> **Philosophy**: the README is only the storefront. The real value hides in the issues, the commits, and the community discussion.

## Workflow

```
[project name] → [1. Locate repo] → [2. Multi-source collection] → [3. Analysis] → [4. Structured output]
```

### Phase 1: Locate the Repo

- Use `web_search` for `site:github.com <project_name>` to confirm the full org/repo
- Use `search-layer` (deep mode + intent awareness) to pick up community links and non-GitHub resources:
  ```bash
  python3 skills/search-layer/scripts/search.py \
    --queries "<project_name> review" "<project_name> hands-on experience" \
    --mode deep --intent exploratory --num 5
  ```
- Use `web_fetch` on the repo homepage for the basics (README, stars, forks, license, last updated)

### Phase 2: Multi-Source Collection (parallel)

Check the following sources **as needed** — collect what exists, skip what does not:

| Source | URL pattern | What to collect | Suggested tool |
|---|---|---|---|
| GitHub repo | `github.com/{org}/{repo}` | README, About, contributors | `web_fetch` |
| GitHub issues | `github.com/{org}/{repo}/issues?q=sort:comments` | Top 3-5 high-quality issues | `browser` |
| Chinese-language communities | WeChat / Zhihu / Xiaohongshu | In-depth reviews, hands-on experience | `content-extract` |
| Technical blogs | Medium / Dev.to | Technical architecture analysis | `web_fetch` / `content-extract` |
| Discussion boards | V2EX / Reddit | User feedback, complaints | `search-layer` (deep mode) |

#### search-layer Usage Conventions

search-layer v2 supports intent-aware scoring. Recommended usage in the github-explorer context:

| Scenario | Command | Notes |
|------|------|------|
| **Project research (default)** | `python3 skills/search-layer/scripts/search.py --queries "<project> review" "<project> hands-on" --mode deep --intent exploratory --num 5` | Multiple queries in parallel, ranked by authority |
| **Latest activity** | `python3 skills/search-layer/scripts/search.py "<project> latest release" --mode deep --intent status --freshness pw --num 5` | Prioritizes freshness, filtered to the past week |
| **Competitive comparison** | `python3 skills/search-layer/scripts/search.py --queries "<project> vs <competitor>" "<project> alternatives" --mode deep --intent comparison --num 5` | Comparison intent, weighted on both keywords and authority |
| **Quick link lookup** | `python3 skills/search-layer/scripts/search.py "<project> official docs" --mode fast --intent resource --num 3` | Exact match, fastest |
| **Community discussion** | `python3 skills/search-layer/scripts/search.py "<project> discussion experience" --mode deep --intent exploratory --domain-boost reddit.com,news.ycombinator.com --num 5` | Weights community sites |

**Intent types at a glance**: `factual` / `status` / `comparison` / `tutorial` / `exploratory` / `news` / `resource`

> Without `--intent`, behavior is identical to v1 (no scoring, results in their original order).

Degradation rule: if either Exa or Tavily returns 429/5xx → continue with the remaining sources; if the script fails outright → fall back to `web_search` as a single source.

---

### Extraction Upgrade Protocol

In the following situations you **must** upgrade from `web_fetch` to `content-extract`:
1. **Restricted domains**: `mp.weixin.qq.com`, `zhihu.com`, `xiaohongshu.com`.
2. **Complex structure**: the page contains heavy math (LaTeX) or complex tables, or the Markdown `web_fetch` returns is extremely messy.
3. **Missing content**: `web_fetch` returns empty content or a challenge page because of anti-scraping.

How to call it:
```bash
python3 skills/content-extract/scripts/content_extract.py --url <URL>
```

Internally, content-extract will:
- First check the domain allowlist (WeChat, Zhihu, and so on); on a hit, go straight to MinerU
- Otherwise probe with `web_fetch` first and fall back to MinerU-HTML on failure
- Return a uniform JSON contract (with `ok`, `markdown`, `sources`, and other fields)

### Phase 3: Analysis

Form judgments from the collected data:

- **Project stage**: early experiment / fast growth / mature and stable / maintenance mode / stalled (based on commit frequency and content)
- **Criteria for a featured issue**: high comment count, maintainer participation, exposes an architectural problem, or contains valuable technical discussion
- **Competitor identification**: extract from the README's "Comparison"/"Alternatives" sections, from issue discussions, and from web search

### Phase 4: Structured Output

Follow the template below strictly. **Every section must have substantive content or an explicit "not found."**

#### Formatting Rules (enforced)

1. **The title must link to the GitHub repository** (format: `# [Project Name](https://github.com/org/repo)`, so it is clickable)
2. **Blank lines both before and after every heading** (end of previous section → blank line → heading → blank line → content, so the visual separation is clear)
3. **Telegram blank-line fix (enforced)**: Telegram swallows the blank line that follows a list item (a line starting with `-`). The fix: between the end of a list and the next heading, insert a line containing a braille blank `⠀` (U+2800), like this:
   ```
   - last list item

   ⠀
   **Next heading**
   ```
   This keeps the blank line before the heading from being swallowed when Telegram renders it.
4. **All headings bold** (emoji + bold text)
5. **Competitive comparisons must carry links** (GitHub / official site / docs, at least one)
6. **Community signal must be concrete**: quote a specific post/tweet/discussion with a summary and the original link. Do not write generalities like "very well reviewed" or "lots of buzz" — write what a specific person said, or what specific problem a specific thread discussed
7. **Traceability principle**: every piece of external information you cite should carry its original link so the reader can trace it back to the source

```markdown
# [{Project Name}]({GitHub Repo URL})

**🎯 One-line positioning**

{What it is, what problem it solves}

**⚙️ Core mechanism**

{The technical principle/architecture, explained in plain language rather than copied from the README. Include the key tech stack.}

**📊 Project health**

- **Stars**: {count}  |  **Forks**: {count}  |  **License**: {type}
- **Team/author**: {background}
- **Commit trend**: {recent activity + judgment of project stage}
- **Recent activity**: {summary of the last few significant commits}

**🔥 Featured issues**

{Top 3-5 high-quality issues, each with a title, a link, and the core point of discussion. If there are no high-quality issues, say so.}

**✅ When to use it**

{When you should reach for this, and what concrete problem it solves}

**⚠️ Limitations**

{When to stay away, and the known problems}

**🆚 Competitive comparison**

{Comparison against projects in the same space, and the differences. Every competitor must carry a GitHub or official-site link, for example:}
- **vs [GraphRAG](https://github.com/microsoft/graphrag)** — description of the difference
- **vs [RAGFlow](https://github.com/infiniflow/ragflow)** — description of the difference

**🌐 Knowledge graph**

- **DeepWiki**: {link, or "not indexed"}
- **Zread.ai**: {link, or "not indexed"}

**🎬 Demo**

{Link to try it online, or "none"}

**📄 Related papers**

{arXiv link, or "none"}

**📰 Community signal**

**X/Twitter**

{Concrete quotes from tweets with links, for example:}
- [@some_user](link): "what they specifically said..."
- [some thread](link): discussed this specific problem...
{If nothing is found, state "no relevant discussion found"}

**Chinese-language communities**

{Concrete post titles/content summaries with links, for example:}
- [Zhihu: post title](link) — what it discussed
- [V2EX: post title](link) — what it discussed
{If nothing is found, state "no relevant discussion found"}

**💬 My judgment**

{Subjective assessment: is it worth the time investment, what level of user it suits, how you would recommend using it}
```

## Execution Notes

- Prefer `web_search` + `web_fetch`, with browser as the fallback
- **Search enhancement**: project research tasks default to `search-layer` v2 deep mode + `--intent exploratory` (Brave + Exa + Tavily, three sources in parallel with dedup and intent-aware scoring); a single source failing does not block the main flow
- **Extraction degradation (enforced)**: when `web_fetch` fails, returns 403 or an anti-scraping page, or returns body text that is too short, or when the source domain is high-risk (WeChat, Zhihu, Xiaohongshu): switch to `content-extract` (which internally falls back to MinerU-HTML) to get cleaner Markdown plus traceable sources
- Collect from different sources in parallel for efficiency
- Every link must be genuinely reachable — do not invent URLs
- Output in English; keep technical terms in their standard form

## ⚠️ Output Self-Check (enforced — verify every item before each output)

Before sending the report you **must** check every item below; send only when all pass:

- [ ] **Title link**: `# [Project Name](GitHub URL)` format, clickable
- [ ] **Heading blank lines**: every bold heading (`**🎯 ...**`) has a blank line before and after
- [ ] **Telegram blank line**: every list block has a braille-blank `⠀` line between it and the next heading (so Telegram does not swallow the blank line)
- [ ] **Issue links**: every featured issue is in full `[#number title](full URL)` format
- [ ] **Competitor links**: every competitor carries `[name](GitHub/official link)`
- [ ] **Community signal links**: every quote is in `[source: title](URL)` format
- [ ] **No vague descriptions**: the community signal section contains no generalities like "very well reviewed" or "lots of buzz"
- [ ] **Traceability**: every external citation carries its original link

## Dependencies

This skill depends on the following OpenClaw tools and skills:

| Dependency | Type | Purpose |
|------|------|------|
| `web_search` | Built-in tool | Brave Search retrieval |
| `web_fetch` | Built-in tool | Web page content fetching |
| `browser` | Built-in tool | Dynamic page rendering (fallback) |
| `search-layer` | Skill | Multi-source search + intent-aware scoring (Brave + Exa + Tavily); v2 supports `--intent` / `--queries` / `--freshness` |
| `content-extract` | Skill | High-fidelity content extraction (the degradation path for anti-scraping sites) |
