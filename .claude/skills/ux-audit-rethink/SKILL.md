---
name: ux-audit-rethink
description: Comprehensive UX audit using IxDF's 7 factors, 5 usability characteristics, and 5 interaction dimensions. Holistic evaluation with redesign proposals based on user-centered design principles.
---

# UX Audit and Rethink

This skill enables AI agents to perform a **comprehensive, holistic UX audit** based on the Interaction Design Foundation's methodology from "The Basics of User Experience Design". It evaluates products across multiple dimensions and proposes strategic redesign recommendations.

Unlike focused evaluations (Nielsen, WCAG, Don Norman), this skill provides a **360-degree UX assessment** combining factors, characteristics, dimensions, and research techniques into a unified framework.

Use this skill for complete UX evaluations, product strategy decisions, or as an entry point before diving into specific audits.

Combine with "Nielsen Heuristics" for usability depth, "WCAG Accessibility" for compliance, or "Cognitive Walkthrough" for task-specific analysis.

## When to Use This Skill

Invoke this skill when:
- Conducting initial comprehensive UX assessment
- Evaluating overall product-market fit from UX perspective
- Making strategic product decisions
- Assessing all dimensions of user experience holistically
- Preparing for product redesign or pivot
- Benchmarking against UX best practices
- Creating UX improvement roadmap
- Evaluating new product concepts

## Inputs Required

When executing this audit, gather:

- **app_description**: Detailed description (purpose, target users, key features, platform: web/mobile/both) [REQUIRED]
- **screenshots_or_links**: Screenshots, wireframes, prototypes, or live URLs [OPTIONAL but highly recommended]
- **user_feedback**: Existing reviews, complaints, support tickets, analytics data [OPTIONAL]
- **target_goals**: Specific UX objectives (e.g., "improve onboarding", "increase engagement") [OPTIONAL]
- **business_context**: Business goals, KPIs, competitive landscape [OPTIONAL]
- **user_personas**: Existing personas or demographic info [OPTIONAL]

## The IxDF UX Framework

This skill evaluates across **three core dimensions**:

### Framework 1: The 7 Factors Influencing UX

Based on Peter Morville's User Experience Honeycomb:

1. **Useful** - Does it solve real user problems?
2. **Usable** - Is it easy to use and navigate?
3. **Findable** - Can users find content and features?
4. **Credible** - Does it inspire trust and confidence?
5. **Desirable** - Is it aesthetically appealing and emotionally engaging?
6. **Accessible** - Is it usable by people with disabilities?
7. **Valuable** - Does it deliver value to users and business?

### Framework 2: The 5 Usability Characteristics

From ISO 9241-11 and usability research:

1. **Effectiveness** - Can users achieve their goals accurately?
2. **Efficiency** - Can users complete tasks quickly with minimal effort?
3. **Engagement** - Is the interface pleasant and satisfying?
4. **Error Tolerance** - Can users prevent and recover from errors?
5. **Ease of Learning** - Can new users learn quickly?

**Formula**: Utility (right features) + Usability (easy to use) = **Usefulness**

### Framework 3: The 5 Dimensions of Interaction Design

From Gillian Crampton Smith and Kevin Silver:

1. **Words** - Labels, instructions, microcopy
2. **Visual Representations** - Icons, images, typography, graphics
3. **Physical Objects/Space** - Input devices, touch, screen size
4. **Time** - Animations, transitions, loading, responsiveness
5. **Behavior** - Actions, reactions, feedback mechanisms

---

## Audit Procedure

Follow these steps systematically:

### Step 1: Context Analysis and Preparation (15 minutes)

**Understand the Product:**
1. Review `app_description` thoroughly
2. Identify:
   - Primary purpose and value proposition
   - Target user demographics and psychographics
   - Platform(s): web, mobile, desktop, cross-platform
   - Key user journeys and goals
   - Business model and success metrics

**Create User Personas** (if not provided):
- Develop 2-3 provisional personas based on target users
- Include: demographics, goals, frustrations, tech proficiency, context of use

**Example Persona:**
```
Name: Sarah, Busy Professional
Age: 32, Marketing Manager
Goals: Quick task completion, mobile-first
Frustrations: Complex interfaces, slow loading
Tech Level: High
Context: On-the-go, multitasking, time-sensitive
```

**Document Assumptions:**
- What are we assuming about users?
- What constraints exist? (technical, budget, timeline)
- What biases might influence evaluation?

---

### Step 2: Evaluate the 7 UX Factors (30 minutes)

For each factor, assess and rate 1-5:

#### 1. Useful ⭐⭐⭐⭐⚪ (4/5)

**Question**: Does the product solve real user problems and provide value?

**Evaluate:**
- Addresses genuine user needs (not invented problems)
- Features align with user goals
- Core value proposition is clear
- Solves problems better than alternatives

**Analysis:**
- Strengths: [What's working]
- Gaps: [What's missing]
- Evidence: [From user feedback, analytics, or observation]

**Rating Criteria:**
- 5: Solves critical problems exceptionally
- 4: Addresses real needs effectively
- 3: Provides some value, room for improvement
- 2: Marginal utility, unclear value
- 1: Doesn't solve meaningful problems

---

#### 2. Usable ⭐⭐⭐⚪⚪ (3/5)

**Question**: Is it easy to use and navigate?

**Evaluate:**
- Intuitive interface requiring minimal learning
- Clear navigation structure
- Consistent interaction patterns
- Low cognitive load
- Error prevention and recovery

**Common Issues:**
- Confusing navigation
- Hidden features
- Inconsistent interactions
- Unclear labels
