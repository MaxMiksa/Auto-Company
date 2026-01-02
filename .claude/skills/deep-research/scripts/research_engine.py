#!/usr/bin/env python3
"""
Deep Research Engine for Claude Code
Orchestrates comprehensive research across multiple sources with verification and synthesis
"""

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict
from enum import Enum


class ResearchPhase(Enum):
    """Research pipeline phases"""
    SCOPE = "scope"
    PLAN = "plan"
    RETRIEVE = "retrieve"
    TRIANGULATE = "triangulate"
    SYNTHESIZE = "synthesize"
    CRITIQUE = "critique"
    REFINE = "refine"
    PACKAGE = "package"


class ResearchMode(Enum):
    """Research depth modes"""
    QUICK = "quick"  # 3 phases: scope, retrieve, package
    STANDARD = "standard"  # 6 phases: skip refine and critique
    DEEP = "deep"  # Full 8 phases
    ULTRADEEP = "ultradeep"  # 8 phases + extended iterations


@dataclass
class Source:
    """Represents a research source"""
    url: str
    title: str
    snippet: str
    retrieved_at: str
    credibility_score: float = 0.0
    source_type: str = "web"  # web, academic, documentation, code
    verification_status: str = "unverified"  # unverified, verified, conflicted

    def to_citation(self, index: int) -> str:
        """Generate citation string"""
        return f"[{index}] {self.title} - {self.url} (Retrieved: {self.retrieved_at})"


@dataclass
class ResearchState:
    """Maintains research state across phases"""
    query: str
    mode: ResearchMode
    phase: ResearchPhase
    scope: Dict[str, Any]
    plan: Dict[str, Any]
    sources: List[Source]
    findings: List[Dict[str, Any]]
    synthesis: Dict[str, Any]
    critique: Dict[str, Any]
    report: str
    metadata: Dict[str, Any]

    def save(self, filepath: Path):
        """Save research state to file with retry logic"""
        max_retries = 3
        for attempt in range(max_retries):
            try:
                with open(filepath, 'w') as f:
                    json.dump(self._serialize(), f, indent=2)
                return  # Success
            except (IOError, OSError) as e:
                if attempt == max_retries - 1:
                    # Final attempt failed
                    raise IOError(f"Failed to save state after {max_retries} attempts: {e}")
                # Wait with exponential backoff before retry
                wait_time = (attempt + 1) * 0.5  # 0.5s, 1s, 1.5s
                time.sleep(wait_time)

    def _serialize(self) -> dict:
        """Convert to serializable dict"""
        return {
            'query': self.query,
            'mode': self.mode.value,
            'phase': self.phase.value,
            'scope': self.scope,
            'plan': self.plan,
            'sources': [asdict(s) for s in self.sources],
            'findings': self.findings,
            'synthesis': self.synthesis,
            'critique': self.critique,
            'report': self.report,
            'metadata': self.metadata
        }

    @classmethod
    def load(cls, filepath: Path) -> 'ResearchState':
        """Load research state from file"""
        with open(filepath, 'r') as f:
            data = json.load(f)

        return cls(
            query=data['query'],
            mode=ResearchMode(data['mode']),
            phase=ResearchPhase(data['phase']),
            scope=data['scope'],
            plan=data['plan'],
            sources=[Source(**s) for s in data['sources']],
            findings=data['findings'],
            synthesis=data['synthesis'],
            critique=data['critique'],
            report=data['report'],
            metadata=data['metadata']
        )


class ResearchEngine:
    """Main research orchestration engine"""

    def __init__(self, mode: ResearchMode = ResearchMode.STANDARD):
        self.mode = mode
        self.state: Optional[ResearchState] = None
        self.output_dir = Path.home() / ".claude" / "research_output"
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def initialize_research(self, query: str) -> ResearchState:
        """Initialize new research session"""
        self.state = ResearchState(
            query=query,
            mode=self.mode,
            phase=ResearchPhase.SCOPE,
            scope={},
            plan={},
            sources=[],
            findings=[],
            synthesis={},
            critique={},
            report="",
            metadata={
                'started_at': datetime.now().isoformat(),
                'version': '1.0'
            }
        )
        return self.state

    def get_phase_instructions(self, phase: ResearchPhase) -> str:
        """Get instructions for current phase"""
        instructions = {
            ResearchPhase.SCOPE: """
# Phase 1: SCOPE

Your task: Define research boundaries and success criteria

## Execute:
1. Decompose the question into 3-5 core components
2. Identify 2-4 key stakeholder perspectives
3. Define what's IN scope and what's OUT of scope
4. List 3-5 success criteria for this research
5. Document 3-5 assumptions that need validation

## Output Format:
```json
{
  "core_components": ["component1", "component2", ...],
  "stakeholder_perspectives": ["perspective1", "perspective2", ...],
  "in_scope": ["item1", "item2", ...],
  "out_of_scope": ["item1", "item2", ...],
  "success_criteria": ["criteria1", "criteria2", ...],
  "assumptions": ["assumption1", "assumption2", ...]
}
```

Use extended reasoning to explore multiple framings before finalizing scope.
""",
            ResearchPhase.PLAN: """
# Phase 2: PLAN

Your task: Create intelligent research roadmap

## Execute:
1. Identify 5-10 primary sources to investigate
2. List 5-10 secondary/backup sources
3. Map knowledge dependencies (what must be understood first)
4. Create 10-15 search query variations
5. Plan triangulation approach (how to verify claims)
6. Define 3-5 quality gates

## Output Format:
```json
{
  "primary_sources": ["source_type1", "source_type2", ...],
  "secondary_sources": ["source_type1", "source_type2", ...],
  "knowledge_dependencies": {"concept1": ["prerequisite1", "prerequisite2"], ...},
  "search_queries": ["query1", "query2", ...],
  "triangulation_strategy": "description of verification approach",
  "quality_gates": ["gate1", "gate2", ...]
}
```

Use Graph-of-Thoughts: branch into 3-4 potential research paths, evaluate, then converge on optimal strategy.
""",
            ResearchPhase.RETRIEVE: """
# Phase 3: RETRIEVE

Your task: Systematically collect information from multiple sources

## Execute:
1. Use WebSearch with iterative query refinement (minimum 10 searches)
2. Use WebFetch to deep-dive into 5-10 most promising sources
3. Extract key passages with metadata
4. Track information gaps
5. Follow 2-3 promising tangents
6. Ensure source diversity (different domains, perspectives)

## Tools to Use:
- WebSearch: For current information and broad coverage
- WebFetch: For detailed extraction from specific URLs
- Grep/Read: For local documentation if relevant
- Task: Spawn 2-3 parallel retrieval agents for efficiency

## Output:
Store all sources with metadata. Each source should include:
- URL/location
- Title
- Key excerpts
- Relevance score
- Source type
- Retrieved timestamp

Aim for 15-30 distinct sources minimum.
""",
            ResearchPhase.TRIANGULATE: """
# Phase 4: TRIANGULATE

Your task: Validate information across multiple independent sources

## Execute:
1. List all major claims from retrieved information
2. For each claim, find 3+ independent confirmatory sources
3. Flag any contradictions or uncertainties
4. Assess source credibility (domain expertise, recency, bias)
5. Document consensus areas vs. debate areas
6. Mark verification status for each claim

## Quality Standards:
- Core claims MUST have 3+ independent sources
- Flag any single-source claims as "unverified"
- Note information recency
- Identify potential biases

## Output Format:
```json
{
  "verified_claims": [
    {
      "claim": "statement",
      "sources": ["source1", "source2", "source3"],
      "confidence": "high|medium|low"
    }
  ],
  "unverified_claims": [...],
  "contradictions": [
    {
      "topic": "what's contradicted",
      "viewpoint1": {"claim": "...", "sources": [...]},
      "viewpoint2": {"claim": "...", "sources": [...]}
    }
  ]
}
```
""",
            ResearchPhase.SYNTHESIZE: """
# Phase 5: SYNTHESIZE

Your task: Connect insights and generate novel understanding

## Execute:
1. Identify 5-10 key patterns across sources
2. Map relationships between concepts
3. Generate 3-5 insights that go beyond source material
4. Create conceptual frameworks or mental models
5. Build argument structures
6. Develop evidence hierarchies

## Use Extended Reasoning:
- Explore non-obvious connections
- Consider second-order implications
- Think about what sources might be missing
- Generate novel hypotheses

## Output Format:
```json
{
  "patterns": ["pattern1", "pattern2", ...],
  "concept_relationships": {"concept1": ["related_to1", "related_to2"], ...},
  "novel_insights": ["insight1", "insight2", ...],
  "frameworks": ["framework_description1", ...],
  "key_arguments": [
    {
      "argument": "main claim",
      "supporting_evidence": ["evidence1", "evidence2"],
      "strength": "strong|moderate|weak"
    }
  ]
}
```
""",
            ResearchPhase.CRITIQUE: """
# Phase 6: CRITIQUE

Your task: Rigorously evaluate research quality

## Execute Red Team Analysis:
1. Check logical consistency
2. Verify citation completeness
3. Identify gaps or weaknesses
4. Assess balance and objectivity
5. Test alternative interpretations
6. Challenge assumptions

## Red Team Questions:
- What's missing from this research?
- What could be wrong?
- What alternative explanations exist?
- What biases might be present?
- What counterfactuals should be considered?
- What would a skeptic say?

## Output Format:
```json
{
  "strengths": ["strength1", "strength2", ...],
  "weaknesses": ["weakness1", "weakness2", ...],
  "gaps": ["gap1", "gap2", ...],
  "biases": ["bias1", "bias2", ...],
  "improvements_needed": [
    {
      "issue": "description",
      "recommendation": "how to fix",
      "priority": "high|medium|low"
    }
  ]
}
```
""",
            ResearchPhase.REFINE: """
# Phase 7: REFINE

Your task: Address gaps and strengthen weak areas

## Execute:
1. Conduct additional research for identified gaps
2. Strengthen weak arguments with more evidence
3. Add missing perspectives
4. Resolve contradictions where possible
5. Enhance clarity and structure
6. Verify all revised content

## Focus On:
- High priority improvements from critique
- Missing stakeholder perspectives
- Weak evidence chains
- Unclear explanations

## Output:
Updated findings, sources, and synthesis with improvements documented.
""",
            ResearchPhase.PACKAGE: """
# Phase 8: PACKAGE

Your task: Deliver professional, actionable research report

## Generate Complete Report:

```markdown
# Research Report: [Topic]

## Executive Summary
[3-5 key findings bullets]
[Primary recommendation]
[Confidence level: High/Medium/Low]

## Introduction
### Research Question
[Original question]

### Scope & Methodology
[What was investigated and how]

### Key Assumptions
[Important assumptions made]

## Main Analysis

### Finding 1: [Title]
[Detailed explanation with evidence]
[Citations: [1], [2], [3]]

### Finding 2: [Title]
[Detailed explanation with evidence]
[Citations: [4], [5], [6]]

[Continue for all findings...]

## Synthesis & Insights
[Patterns and connections]
[Novel insights]
[Implications]

## Limitations & Caveats
[Known gaps]
[Assumptions]
[Areas of uncertainty]

## Recommendations
[Action items]
[Next steps]
[Further research needs]

## Bibliography
[1] Source 1 full citation
[2] Source 2 full citation
...

## Appendix: Methodology
[Research process]
[Sources consulted]
[Verification approach]
```
