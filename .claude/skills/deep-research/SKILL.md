---
name: deep-research
description: Conduct enterprise-grade research with multi-source synthesis, citation tracking, and verification. Use when user needs comprehensive analysis requiring 10+ sources, verified claims, or comparison of approaches. Triggers include "deep research", "comprehensive analysis", "research report", "compare X vs Y", or "analyze trends". Do NOT use for simple lookups, debugging, or questions answerable with 1-2 searches.
---

# Deep Research

<!-- STATIC CONTEXT BLOCK START - Optimized for prompt caching -->
<!-- All static instructions, methodology, and templates below this line -->
<!-- Dynamic content (user queries, results) added after this block -->

## Core System Instructions

**Purpose:** Deliver citation-backed, verified research reports through 8-phase pipeline (Scope → Plan → Retrieve → Triangulate → Synthesize → Critique → Refine → Package) with source credibility scoring and progressive context management.

**Context Strategy:** This skill uses 2025 context engineering best practices:
- Static instructions cached (this section)
- Progressive disclosure (load references only when needed)
- Avoid "loss in the middle" (critical info at start/end, not buried)
- Explicit section markers for context navigation

---

## Decision Tree (Execute First)

```
Request Analysis
├─ Simple lookup? → STOP: Use WebSearch, not this skill
├─ Debugging? → STOP: Use standard tools, not this skill
└─ Complex analysis needed? → CONTINUE

Mode Selection
├─ Initial exploration? → quick (3 phases, 2-5 min)
├─ Standard research? → standard (6 phases, 5-10 min) [DEFAULT]
├─ Critical decision? → deep (8 phases, 10-20 min)
└─ Comprehensive review? → ultradeep (8+ phases, 20-45 min)

Execution Loop (per phase)
├─ Load phase instructions from [methodology](./reference/methodology.md#phase-N)
├─ Execute phase tasks
├─ Spawn parallel agents if applicable
└─ Update progress

Validation Gate
├─ Run `python scripts/validate_report.py --report [path]`
├─ Pass? → Deliver
└─ Fail? → Fix (max 2 attempts) → Still fails? → Escalate
```

---

## Workflow (Clarify → Plan → Act → Verify → Report)

**AUTONOMY PRINCIPLE:** This skill operates independently. Infer assumptions from query context. Only stop for critical errors or incomprehensible queries.

### 1. Clarify (Rarely Needed - Prefer Autonomy)

**DEFAULT: Proceed autonomously. Derive assumptions from query signals.**

**ONLY ask if CRITICALLY ambiguous:**
- Query is incomprehensible (e.g., "research the thing")
- Contradictory requirements (e.g., "quick 50-source ultradeep analysis")

**When in doubt: PROCEED with standard mode. User will redirect if incorrect.**

**Default assumptions:**
- Technical query → Assume technical audience
- Comparison query → Assume balanced perspective needed
- Trend query → Assume recent 1-2 years unless specified
- Standard mode is default for most queries

---

### 2. Plan

**Mode selection criteria:**
- **Quick** (2-5 min): Exploration, broad overview, time-sensitive
- **Standard** (5-10 min): Most use cases, balanced depth/speed [DEFAULT]
- **Deep** (10-20 min): Important decisions, need thorough verification
- **UltraDeep** (20-45 min): Critical analysis, maximum rigor

**Announce plan and execute:**
- Briefly state: selected mode, estimated time, number of sources
- Example: "Starting standard mode research (5-10 min, 15-30 sources)"
- Proceed without waiting for approval

---

### 3. Act (Phase Execution)

**All modes execute:**
- Phase 1: SCOPE - Define boundaries ([method](./reference/methodology.md#phase-1-scope))
- Phase 3: RETRIEVE - Parallel search execution (5-10 concurrent searches + agents) ([method](./reference/methodology.md#phase-3-retrieve---parallel-information-gathering))
- Phase 8: PACKAGE - Generate report using [template](./templates/report_template.md)

**Standard/Deep/UltraDeep execute:**
- Phase 2: PLAN - Strategy formulation
- Phase 4: TRIANGULATE - Verify 3+ sources per claim
- Phase 4.5: OUTLINE REFINEMENT - Adapt structure based on evidence (WebWeaver 2025) ([method](./reference/methodology.md#phase-45-outline-refinement---dynamic-evolution-webweaver-2025))
- Phase 5: SYNTHESIZE - Generate novel insights

**Deep/UltraDeep execute:**
- Phase 6: CRITIQUE - Red-team analysis
- Phase 7: REFINE - Address gaps

**Critical: Avoid "Loss in the Middle"**
- Place key findings at START and END of sections, not buried
- Use explicit headers and markers
- Structure: Summary → Details → Conclusion (not Details sandwiched)

**Progressive Context Loading:**
- Load [methodology](./reference/methodology.md) sections on-demand
- Load [template](./templates/report_template.md) only for Phase 8
- Do not inline everything - reference external files

**Anti-Hallucination Protocol (CRITICAL):**
- **Source grounding**: Every factual claim MUST cite a specific source immediately [N]
- **Clear boundaries**: Distinguish between FACTS (from sources) and SYNTHESIS (your analysis)
- **Explicit markers**: Use "According to [1]..." or "[1] reports..." for source-grounded statements
- **No speculation without labeling**: Mark inferences as "This suggests..." not "Research shows..."
- **Verify before citing**: If unsure whether source actually says X, do NOT fabricate citation
- **When uncertain**: Say "No sources found for X" rather than inventing references

**Parallel Execution Requirements (CRITICAL for Speed):**

**Phase 3 RETRIEVE - Mandatory Parallel Search:**
1. **Decompose query** into 5-10 independent search angles before ANY searches
2. **Launch ALL searches in single message** with multiple tool calls (NOT sequential)
3. **Quality threshold monitoring** for FFS pattern:
   - Track source count and avg credibility score
   - Proceed when threshold reached (mode-specific, see methodology)
   - Continue background searches for additional depth
4. **Spawn 3-5 parallel agents** using Task tool for deep-dive investigations

**Example correct execution:**
```
[Single message with 8+ parallel tool calls]
WebSearch #1: Core topic semantic
WebSearch #2: Technical keywords
WebSearch #3: Recent 2024-2025 filtered
WebSearch #4: Academic domains
WebSearch #5: Critical analysis
WebSearch #6: Industry trends
Task agent #1: Academic paper analysis
Task agent #2: Technical documentation deep dive
```

**❌ WRONG (sequential execution):**
```
WebSearch #1 → wait for results → WebSearch #2 → wait → WebSearch #3...
```

**✅ RIGHT (parallel execution):**
```
All searches + agents launched simultaneously in one message
```

---

### 4. Verify (Always Execute)

**Step 1: Citation Verification (Catches Fabricated Sources)**

```bash
python scripts/verify_citations.py --report [path]
```

**Checks:**
- DOI resolution (verifies citation actually exists)
- Title/year matching (detects mismatched metadata)
- Flags suspicious entries (2024+ without DOI, no URL, failed verification)

**If suspicious citations found:**
- Review flagged entries manually
- Remove or replace fabricated sources
- Re-run until clean

**Step 2: Structure & Quality Validation**

```bash
python scripts/validate_report.py --report [path]
```

**8 automated checks:**
1. Executive summary length (50-250 words)
2. Required sections present (+ recommended: Claims table, Counterevidence)
3. Citations formatted [1], [2], [3]
4. Bibliography matches citations
5. No placeholder text (TBD, TODO)
6. Word count reasonable (500-10000)
7. Minimum 10 sources
8. No broken internal links

**If fails:**
- Attempt 1: Auto-fix formatting/links
- Attempt 2: Manual review + correction
- After 2 failures: **STOP** → Report issues → Ask user

---

### 5. Report

**CRITICAL: Generate COMPREHENSIVE, DETAILED markdown reports**

**File Organization (CRITICAL - Clean Accessibility):**

**1. Create Organized Folder in Documents:**
- ALWAYS create dedicated folder: `~/Documents/[TopicName]_Research_[YYYYMMDD]/`
- Extract clean topic name from research question (remove special chars, use underscores/CamelCase)
- Examples:
  - "psilocybin research 2025" → `~/Documents/Psilocybin_Research_20251104/`
  - "compare React vs Vue" → `~/Documents/React_vs_Vue_Research_20251104/`
  - "AI safety trends" → `~/Documents/AI_Safety_Trends_Research_20251104/`
- If folder exists, use it; if not, create it
- This ensures clean organization and easy accessibility

**2. Save All Formats to Same Folder:**

**Markdown (Primary Source):**
- Save to: `[Documents folder]/research_report_[YYYYMMDD]_[topic_slug].md`
- Also save copy to: `~/.claude/research_output/` (internal tracking)
- Full detailed report with all findings

**HTML (McKinsey Style - ALWAYS GENERATE):**
- Save to: `[Documents folder]/research_report_[YYYYMMDD]_[topic_slug].html`
- Use McKinsey template: [mckinsey_template](./templates/mckinsey_report_template.html)
- Design principles: Sharp corners (NO border-radius), muted corporate colors (navy #003d5c, gray #f8f9fa), ultra-compact layout, info-first structure
- Place critical metrics dashboard at top (extract 3-4 key quantitative findings)
- Use data tables for dense information presentation
- 14px base font, compact spacing, no decorative gradients or colors
- **Attribution Gradients (2025):** Wrap each citation [N] in `<span class="citation">` with nested tooltip div showing source details
- OPEN in browser automatically after generation

**PDF (Professional Print - ALWAYS GENERATE):**
- Save to: `[Documents folder]/research_report_[YYYYMMDD]_[topic_slug].pdf`
- Use generating-pdf skill (via Task tool with general-purpose agent)
- Professional formatting with headers, page numbers
- OPEN in default PDF viewer after generation

**3. File Naming Convention:**
All files use same base name for easy matching:
- `research_report_20251104_psilocybin_2025.md`
- `research_report_20251104_psilocybin_2025.html`
- `research_report_20251104_psilocybin_2025.pdf`

**Length Requirements (UNLIMITED with Progressive Assembly):**
- Quick mode: 2,000+ words (baseline quality threshold)
- Standard mode: 4,000+ words (comprehensive analysis)
- Deep mode: 6,000+ words (thorough investigation)
- UltraDeep mode: 10,000-50,000+ words (NO UPPER LIMIT - as comprehensive as evidence warrants)

**How Unlimited Length Works:**
Progressive file assembly allows ANY report length by generating section-by-section.
Each section is written to file immediately (avoiding output token limits).
Complex topics with many findings? Generate 20, 30, 50+ findings - no constraint!

**Content Requirements:**
- Use [template](./templates/report_template.md) as exact structure
- Generate each section to APPROPRIATE depth (determined by evidence, not word targets)
- Include specific data, statistics, dates, numbers (not vague statements)
- Multiple paragraphs per finding with evidence (as many as needed)
- Each section gets focused generation attention
- DO NOT write summaries - write FULL analysis

**Writing Standards:**
- **Narrative-driven**: Write in flowing prose. Each finding tells a story with beginning (context), middle (evidence), end (implications)
- **Precision**: Every word deliberately chosen, carries intention
- **Economy**: No fluff, eliminate fancy grammar, unnecessary modifiers
- **Clarity**: Exact numbers embedded in sentences ("The study demonstrated a 23% reduction in mortality"), not isolated in bullets
- **Directness**: State findings without embellishment
- **High signal-to-noise**: Dense information, respect reader's time

**Bullet Point Policy (Anti-Fatigue Enforcement):**
- Use bullets SPARINGLY: Only for distinct lists (product names, company roster, enumerated steps)
- NEVER use bullets as primary content delivery - they fragment thinking
- Each findings section requires substantive prose paragraphs (3-5+ paragraphs minimum)
- Example: Instead of "• Market size: $2.4B" write "The global market reached $2.4 billion in 2023, driven by increasing consumer demand and regulatory tailwinds [1]."

**Anti-Fatigue Quality Check (Apply to EVERY Section):**
Before considering a section complete, verify:
- [ ] **Paragraph count**: ≥3 paragraphs for major sections (## headings)
- [ ] **Prose-first**: <20% of content is bullet points (≥80% must be flowing prose)
- [ ] **No placeholders**: Zero instances of "Content continues", "Due to length", "[Sections X-Y]"
- [ ] **Evidence-rich**: Specific data points, statistics, quotes (not vague statements)
- [ ] **Citation density**: Major claims cited within same sentence

**If ANY check fails:** Regenerate the section before moving to next.

**Source Attribution Standards (Critical for Preventing Fabrication):**
- **Immediate citation**: Every factual claim followed by [N] citation in same sentence
- **Quote sources directly**: Use "According to [1]..." or "[1] reports..." for factual statements
- **Distinguish fact from synthesis**:
  - ✅ GOOD: "Mortality decreased 23% (p<0.01) in the treatment group [1]."
  - ❌ BAD: "Studies show mortality improved significantly."
- **No vague attributions**:
  - ❌ NEVER: "Research suggests...", "Studies show...", "Experts believe..."
  - ✅ ALWAYS: "Smith et al. (2024) found..." [1], "According to FDA data..." [2]
- **Label speculation explicitly**:
  - ✅ GOOD: "This suggests a potential mechanism..." (analysis, not fact)
  - ❌ BAD: "The mechanism is..." (presented as fact without citation)
- **Admit uncertainty**:
  - ✅ GOOD: "No sources found addressing X directly."
  - ❌ BAD: Fabricating a citation to fill the gap
- **Template pattern**: "[Specific claim with numbers/data] [Citation]. [Analysis/implication]."

**Deliver to user:**
1. Executive summary (inline in chat)
2. Organized folder path (e.g., "All files saved to: ~/Documents/Psilocybin_Research_20251104/")
3. Confirmation of all three formats generated:
   - Markdown (source)
   - HTML (McKinsey-style, opened in browser)
   - PDF (professional print, opened in viewer)
4. Source quality assessment summary (source count)
5. Next steps (if relevant)

**Generation Workflow: Progressive File Assembly (Unlimited Length)**

**Phase 8.1: Setup**
```bash
# Extract topic slug from research question
# Create folder: ~/Documents/[TopicName]_Research_[YYYYMMDD]/
mkdir -p ~/Documents/[folder_name]

# Create initial markdown file with frontmatter
# File path: [folder]/research_report_[YYYYMMDD]_[slug].md
```

**Phase 8.2: Progressive Section Generation**

**CRITICAL STRATEGY:** Generate and write each section individually to file using Write/Edit tools.
This allows unlimited report length while keeping each generation manageable.

**OUTPUT TOKEN LIMIT SAFEGUARD (CRITICAL - Claude Code Default: 32K):**

Claude Code default limit: 32,000 output tokens (≈24,000 words total per skill execution)
This is a HARD LIMIT and cannot be changed within the skill.

**What this means:**
- Total output (your text + all tool call content) must be <32,000 tokens
- 32,000 tokens ≈ 24,000 words max
- Leave safety margin: Target ≤20,000 words total output

**Realistic report sizes per mode:**
- Quick mode: 2,000-4,000 words ✅ (well under limit)
- Standard mode: 4,000-8,000 words ✅ (comfortably under limit)
- Deep mode: 8,000-15,000 words ✅ (achievable with care)
- UltraDeep mode: 15,000-20,000 words ⚠️ (at limit, monitor closely)

**For reports >20,000 words:**
User must run skill multiple times:
- Run 1: "Generate Part 1 (sections 1-6)" → saves to part1.md
- Run 2: "Generate Part 2 (sections 7-12)" → saves to part2.md
- User manually combines or asks Claude to merge files

**Auto-Continuation Strategy (TRUE Unlimited Length):**

When report exceeds 18,000 words in single run:
1. Generate sections 1-10 (stay under 18K words)
2. Save continuation state file with context preservation
3. Spawn continuation agent via Task tool
4. Continuation agent: Reads state → Generates next batch → Spawns next agent if needed
5. Chain continues recursively until complete

This achieves UNLIMITED length while respecting 32K limit per agent

**Initialize Citation Tracking:**
```
citations_used = []  # Maintain this list in working memory throughout
```

**Section Generation Loop:**

**Pattern:** Generate section content → Use Write/Edit tool with that content → Move to next section
Each Write/Edit call contains ONE section (≤2,000 words per call)

1. **Executive Summary** (200-400 words)
   - Generate section content
   - Tool: Write(file, content=frontmatter + Executive Summary)
   - Track citations used
   - Progress: "✓ Executive Summary"

2. **Introduction** (400-800 words)
   - Generate section content
   - Tool: Edit(file, old=last_line, new=old + Introduction section)
   - Track citations used
   - Progress: "✓ Introduction"

3. **Finding 1** (600-2,000 words)
   - Generate complete finding
   - Tool: Edit(file, append Finding 1)
   - Track citations used
   - Progress: "✓ Finding 1"

4. **Finding 2** (600-2,000 words)
   - Generate complete finding
   - Tool: Edit(file, append Finding 2)
   - Track citations used
   - Progress: "✓ Finding 2"

... Continue for ALL findings (each finding = one Edit tool call, ≤2,000 words)

**CRITICAL:** If you have 10 findings × 1,500 words each = 15,000 words of findings
This is OKAY because each Edit call is only 1,500 words (under 2,000 word limit per tool call)
The FILE grows to 15,000 words, but no single tool call exceeds limits

4. **Synthesis & Insights**
   - Generate: Novel insights beyond source statements (as long as needed for synthesis)
   - Tool: Edit (append to file)
   - Track: Extract citations, append to citations_used
   - Progress: "Generated Synthesis ✓"

5. **Limitations & Caveats**
   - Generate: Counterevidence, gaps, uncertainties (appropriate depth)
   - Tool: Edit (append to file)
   - Track: Extract citations, append to citations_used
   - Progress: "Generated Limitations ✓"

6. **Recommendations**
   - Generate: Immediate actions, next steps, research needs (appropriate depth)
   - Tool: Edit (append to file)
   - Track: Extract citations, append to citations_used
   - Progress: "Generated Recommendations ✓"

7. **Bibliography (CRITICAL - ALL Citations)**
   - Generate: COMPLETE bibliography with EVERY citation from citations_used list
   - Format: [1], [2], [3]... [N] - each citation gets full entry
   - Verification: Check citations_used list - if list contains [1] through [73], generate all 73 entries
   - NO ranges ([1-50]), NO placeholders ("Additional citations"), NO truncation
   - Tool: Edit (append to file)
   - Progress: "Generated Bibliography ✓ (N citations)"

8. **Methodology Appendix**
   - Generate: Research process, verification approach (appropriate depth)
   - Tool: Edit (append to file)
   - Progress: "Generated Methodology ✓"

**Phase 8.3: Auto-Continuation Decision Point**

After generating sections, check word count:

**If total output ≤18,000 words:** Complete normally
- Generate Bibliography (all citations)
- Generate Methodology
- Verify complete report
- Save copy to ~/.claude/research_output/
- Done! ✓

**If total output will exceed 18,000 words:** Auto-Continuation Protocol

**Step 1: Save Continuation State**
Create file: `~/.claude/research_output/continuation_state_[report_id].json`

```json
{
  "version": "2.1.1",
  "report_id": "[unique_id]",
  "file_path": "[absolute_path_to_report.md]",
  "mode": "[quick|standard|deep|ultradeep]",

  "progress": {
    "sections_completed": [list of section IDs done],
    "total_planned_sections": [total count],
    "word_count_so_far": [current word count],
    "continuation_count": [which continuation this is, starts at 1]
  },

  "citations": {
    "used": [1, 2, 3, ..., N],
    "next_number": [N+1],
    "bibliography_entries": [
      "[1] Full citation entry",
      "[2] Full citation entry",
      ...
    ]
  },

  "research_context": {
    "research_question": "[original question]",
    "key_themes": ["theme1", "theme2", "theme3"],
    "main_findings_summary": [
      "Finding 1: [100-word summary]",
      "Finding 2: [100-word summary]",
      ...
    ],
    "narrative_arc": "[Current position in story: beginning/middle/conclusion]"
  },

  "quality_metrics": {
    "avg_words_per_finding": [calculated average],
    "citation_density": [citations per 1000 words],
    "prose_vs_bullets_ratio": [e.g., "85% prose"],
    "writing_style": "technical-precise-data-driven"
  },

  "next_sections": [
    {"id": N, "type": "finding", "title": "Finding X", "target_words": 1500},
    {"id": N+1, "type": "synthesis", "title": "Synthesis", "target_words": 1000},
    ...
  ]
}
```

**Step 2: Spawn Continuation Agent**

Use Task tool with general-purpose agent:

```
Task(
  subagent_type="general-purpose",
  description="Continue deep-research report generation",
  prompt="""
CONTINUATION TASK: You are continuing an existing deep-research report.

CRITICAL INSTRUCTIONS:
1. Read continuation state file: ~/.claude/research_output/continuation_state_[report_id].json
2. Read existing report to understand context: [file_path from state]
3. Read LAST 3 completed sections to understand flow and style
4. Load research context: themes, narrative arc, writing style from state
5. Continue citation numbering from state.citations.next_number
6. Maintain quality metrics from state (avg words, citation density, prose ratio)

CONTEXT PRESERVATION:
- Research question: [from state]
- Key themes established: [from state]
- Findings so far: [summaries from state]
- Narrative position: [from state]
- Writing style: [from state]

YOUR TASK:
Generate next batch of sections (stay under 18,000 words):
[List next_sections from state]

Use Write/Edit tools to append to existing file: [file_path]

QUALITY GATES (verify before each section):
- Words per section: Within ±20% of [avg_words_per_finding]
- Citation density: Match [citation_density] ±0.5 per 1K words
- Prose ratio: Maintain ≥80% prose (not bullets)
- Theme alignment: Section ties to key_themes
- Style consistency: Match [writing_style]

After generating sections:
- If more sections remain: Update state, spawn next continuation agent
- If final sections: Generate complete bibliography, verify report, cleanup state file

HANDOFF PROTOCOL (if spawning next agent):
1. Update continuation_state.json with new progress
2. Add new citations to state
3. Add summaries of new findings to state
4. Update quality metrics
5. Spawn next agent with same instructions
"""
)
```

**Step 3: Report Continuation Status**
Tell user:
```
📊 Report Generation: Part 1 Complete (N sections, X words)
🔄 Auto-continuing via spawned agent...
   Next batch: [section list]
   Progress: [X%] complete
```

**Phase 8.4: Continuation Agent Quality Protocol**

When continuation agent starts:

**Context Loading (CRITICAL):**
1. Read continuation_state.json → Load ALL context
2. Read existing report file → Review last 3 sections
3. Extract patterns:
