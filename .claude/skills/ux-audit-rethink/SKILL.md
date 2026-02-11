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
- Complex processes

---

#### 3. Findable ⭐⭐⚪⚪⚪ (2/5)

**Question**: Can users easily locate content and features?

**Evaluate:**
- Effective search functionality
- Logical information architecture
- Clear content hierarchy
- Good labeling and categorization
- Discoverable features

**Test:**
- Can users find [key feature] in <30 seconds?
- Is search effective?
- Are related items grouped logically?

---

#### 4. Credible ⭐⭐⭐⭐⚪ (4/5)

**Question**: Does it inspire trust and confidence?

**Evaluate:**
- Professional visual design
- No broken links or errors
- Secure (HTTPS, privacy policy)
- Transparent about data usage
- Social proof (reviews, testimonials)
- Up-to-date content
- Clear contact information

**Trust Signals:**
- Security badges
- Professional design
- Error-free content
- Real testimonials
- Privacy transparency

---

#### 5. Desirable ⭐⭐⭐⚪⚪ (3/5)

**Question**: Is it aesthetically appealing and emotionally engaging?

**Evaluate:**
- Visual appeal (beautiful, polished)
- Emotional design (delightful, memorable)
- Brand personality expression
- Modern design standards
- Creates positive emotional response

**Beyond Functional:**
- Does it spark joy?
- Is it memorable?
- Do users want to use it?
- Competitive visual design?

---

#### 6. Accessible ⭐⭐⚪⚪⚪ (2/5)

**Question**: Is it inclusive for all users, including those with disabilities?

**Evaluate:**
- WCAG compliance (A, AA, AAA)
- Keyboard navigation
- Screen reader compatibility
- Color contrast
- Alternative text
- Captions for media
- Flexible text sizing

**Quick Checks:**
- Can you navigate with keyboard only?
- Does it work with screen readers?
- Sufficient color contrast?
- Text resizable to 200%?

---

#### 7. Valuable ⭐⭐⭐⭐⚪ (4/5)

**Question**: Does it deliver value to both users and the business?

**Evaluate:**
- **User Value**: Saves time, money, effort; provides utility or enjoyment
- **Business Value**: Achieves business goals (revenue, engagement, retention)
- ROI for both stakeholders

**Balance:**
- User needs vs. business goals
- Short-term vs. long-term value
- Monetization without compromising UX

---

**7 Factors Summary:**

| Factor | Rating | Status | Priority |
|--------|--------|--------|----------|
| Useful | 4/5 | ✅ Good | Medium |
| Usable | 3/5 | ⚠️ Needs work | High |
| Findable | 2/5 | ❌ Poor | Critical |
| Credible | 4/5 | ✅ Good | Low |
| Desirable | 3/5 | ⚠️ Needs work | Medium |
| Accessible | 2/5 | ❌ Poor | High |
| Valuable | 4/5 | ✅ Good | Low |

**Overall UX Factor Score**: 22/35 (63%) - **Acceptable, significant improvement needed**

---

### Step 3: Assess 5 Usability Characteristics (30 minutes)

#### 1. Effectiveness ⭐⭐⭐⭐⚪ (4/5)

**Definition**: Can users achieve their goals accurately and completely?

**Evaluate:**
- Task completion rate (target: >90%)
- Accuracy of results
- Success rate for key tasks
- Goal achievement without workarounds

**Metrics:**
- % of users who complete tasks successfully
- Number of errors per task
- Satisfaction with outcomes

**Issues Found:**
- [List specific effectiveness problems]

---

#### 2. Efficiency ⭐⭐⭐⚪⚪ (3/5)

**Definition**: Can users complete tasks quickly with minimal effort?

**Evaluate:**
- Time to complete tasks (vs. benchmark)
- Number of steps/clicks required
- Shortcuts for expert users
- Streamlined workflows
- No unnecessary friction

**Metrics:**
- Average time on task
- Number of clicks/steps
- Perceived effort (user reports)

**Efficiency Issues:**
- Multi-step processes that could be simplified
- Missing shortcuts or bulk actions
- Slow loading times

---

#### 3. Engagement ⭐⭐⭐⚪⚪ (3/5)

**Definition**: Is the interface pleasant, satisfying, and enjoyable to use?

**Evaluate:**
- Aesthetic appeal
- Emotional response (positive feelings)
- Desire to return
- Flow state (immersion)
- Delight moments

**Qualitative:**
- Do users enjoy using it?
- Does it create positive memories?
- Would they recommend it?

---

#### 4. Error Tolerance ⭐⭐⚪⚪⚪ (2/5)

**Definition**: Can users easily prevent, recognize, and recover from errors?

**Evaluate:**
- Error prevention (constraints, validation, confirmations)
- Clear error messages (what happened, why, how to fix)
- Easy undo/redo
- Graceful degradation
- Data loss prevention (auto-save)

**Common Issues:**
- Generic error messages ("Error 500")
- No confirmation for destructive actions
- Can't undo mistakes
- Data loss on errors

---

#### 5. Ease of Learning ⭐⭐⭐⚪⚪ (3/5)

**Definition**: Can new users quickly learn to use the product without extensive training?

**Evaluate:**
- Intuitive first use (learnability)
- Onboarding effectiveness
- Consistent with conventions
- Progressive disclosure
- In-context help
- Memorability (can returning users remember?)

**Test:**
- Can a new user complete [key task] without help?
- How long to become proficient?
- Do users need documentation?

---

**Usability Characteristics Summary:**

| Characteristic | Rating | Status | Impact |
|---------------|--------|--------|--------|
| Effectiveness | 4/5 | ✅ Good | High |
| Efficiency | 3/5 | ⚠️ Needs work | High |
| Engagement | 3/5 | ⚠️ Needs work | Medium |
| Error Tolerance | 2/5 | ❌ Poor | Critical |
| Ease of Learning | 3/5 | ⚠️ Needs work | High |

**Overall Usability Score**: 15/25 (60%) - **Below target, improvement essential**

**Utility Check**: Are the right features present? (Yes/No/Partial)
**Usefulness Score**: Utility + Usability = [Assessment]

---

### Step 4: Review 5 Interaction Design Dimensions (30 minutes)

#### 1. Words (Microcopy, Labels, Content)

**Evaluate:**
- Clear, concise, jargon-free language
- Consistent terminology
- User's language (not system language)
- Helpful instructions and guidance
- Appropriate tone of voice
- Error messages understandable

**Examples to Check:**
- Button labels: "Submit" vs. "Save Changes" vs. "Continue"
- Form labels: Clear and specific?
- Error messages: Helpful or cryptic?
- Empty states: Guiding or confusing?

**Issues:**
- Technical jargon ("Error: NULL reference exception")
- Ambiguous labels ("OK", "Submit", "Click here")
- Inconsistent terminology (Sign In vs. Log In vs. Login)
- Missing context ("Name" - first? last? full?)

---

#### 2. Visual Representations (Icons, Graphics, Typography)

**Evaluate:**
- Icons clear and universally understood
- Visual hierarchy guides attention
- Typography readable and accessible
- Images support content (not decorative)
- Consistent visual language
- Color communicates meaning
- Data visualization effective

**Check:**
- Icon meanings obvious without labels?
- Visual hierarchy clear?
- Typography scales well?
- Graphics enhance understanding?

---

#### 3. Physical Objects/Space (Input Methods, Screen Size)

**Evaluate:**
- Touch targets appropriate size (44×44px minimum)
- Gestures intuitive (swipe, pinch, tap)
- Keyboard navigation smooth
- Mouse interactions (hover, click) responsive
- Screen size optimized (mobile, tablet, desktop)
- Responsive design effective

**Mobile Considerations (Chapter 8 - IxDF):**
- Small screen optimized
- One-direction scrolling
- Simplified navigation
- Minimal content per screen
- Reduced text input
- Stable network handling
- Integrated experience (uses phone features)

---

#### 4. Time (Animations, Responsiveness, Loading)

**Evaluate:**
- Loading times acceptable (<3 seconds)
- Animations smooth and purposeful
- Transitions guide users
- Feedback immediate (<100ms)
- Progress indicators for long operations
- No unnecessary delays
- Performance optimized

**Timing Guidelines:**
- <100ms: Feels instant
- 100-300ms: Slight delay noticed
- 300ms-1s: User stays focused
- 1-10s: Needs progress indicator
- >10s: User multitasks, needs status

---

#### 5. Behavior (Actions, Reactions, Feedback)

**Evaluate:**
- Actions have clear consequences
- Immediate feedback on interactions
- System state always visible
- Predictable behavior
- Consistent interaction patterns
- Appropriate animations/transitions
- Error recovery built-in

**Interaction Patterns:**
- Click button → Immediate visual feedback + action
- Submit form → Validation + confirmation
- Delete item → Confirmation + undo option
- Load content → Skeleton screens + progress

---

**Interaction Design Summary:**

| Dimension | Rating | Key Issues |
|-----------|--------|------------|
| Words | 3/5 | Technical jargon, inconsistent terms |
| Visual Representations | 4/5 | Minor icon clarity issues |
| Physical Objects/Space | 2/5 | Small touch targets, poor mobile optimization |
| Time | 3/5 | Slow loading, missing progress indicators |
| Behavior | 3/5 | Weak feedback, inconsistent patterns |

**Overall Interaction Design Score**: 15/25 (60%)

---

### Step 5: Apply UX Research Techniques (20 minutes)

Recommend or simulate research methods:

#### Expert Review (Heuristic Evaluation)
- Apply Nielsen's 10 usability heuristics
- Document violations and severity
- Provide specific examples

#### User Interview Questions (if conducting or recommending)
**Discovery:**
- "What are you trying to accomplish?"
- "What frustrates you most about [product]?"
- "What would you change if you could?"

**Follow-up:**
- "Can you show me how you do [task]?"
- "What alternatives have you tried?"
- "How does this compare to [competitor]?"

#### Other Techniques to Recommend:
- **Usability Testing**: Task-based observation (5-8 users)
- **Card Sorting**: For information architecture (open or closed)
- **A/B Testing**: For design alternatives
- **Analytics Review**: Funnel analysis, heatmaps, session recordings
- **Surveys**: Quantitative feedback (SUS, NPS, CSAT)
- **Personas**: Refine or create based on research
- **Journey Mapping**: Visualize end-to-end experience

#### Information Visualization (Chapter 9 - IxDF)
**For Presenting Findings:**
- Charts: Bar charts for comparisons, line charts for trends
- Heatmaps: Click/attention patterns
- Flowcharts: User journeys
- Tables: Structured data
- Infographics: Executive summaries

**Ethical Considerations:**
- Present data honestly (no cherry-picking)
- Disclose limitations and sample sizes
- Avoid manipulative visualizations
- Cite sources

---

### Step 6: Identify Issues and Prioritize (15 minutes)

**Consolidate Findings:**

Create prioritized issue list:

```markdown
## Critical Issues (Fix Immediately)

### Issue 1: Poor Error Tolerance - No Undo for Deletions
- **Frameworks Violated**: Usability (Error Tolerance 2/5), UX Factor (Usable 3/5)
- **User Impact**: Users lose data, frustration, decreased trust
- **Business Impact**: Support tickets, user churn
- **Evidence**: User feedback: "Accidentally deleted project, can't recover"
- **Severity**: Critical
- **Effort**: Medium (2-3 days)
- **Recommendation**: Add confirmation dialog + undo buffer (30s)

### Issue 2: Information Not Findable - Hidden Search
- **Frameworks Violated**: UX Factor (Findable 2/5), Interaction (Words/Visual)
- **User Impact**: Can't locate content, abandons task
- **Business Impact**: Decreased engagement, lower conversions
- **Evidence**: Analytics show 70% exit on navigation
- **Severity**: High
- **Effort**: Low (1 day)
- **Recommendation**: Add prominent search bar in header

[Continue for all critical issues...]
```

**Prioritization Matrix:**

| Issue | User Impact | Business Impact | Effort | Priority |
|-------|-------------|-----------------|--------|----------|
| No undo on delete | High | High | Medium | P0 |
| Hidden search | High | Medium | Low | P0 |
| Slow loading | Medium | Medium | High | P1 |
| Poor mobile UX | High | High | High | P1 |

**Priority Levels:**
- **P0 (Critical)**: Blocks users, fix immediately
- **P1 (High)**: Major friction, fix in current sprint
- **P2 (Medium)**: Annoyance, fix in next release
- **P3 (Low)**: Nice-to-have, backlog

---

### Step 7: Propose Rethink and Redesign (30 minutes)

**Use Design Thinking Process:**

#### Phase 1: Empathize (Already done via audit)
- Synthesize user pain points
- Reference personas
- Map emotional journey

#### Phase 2: Define Problem Statements
**Template**: [Persona] needs [need] because [insight]

**Examples:**
- "Sarah needs faster task completion because she's always on-the-go and time-constrained"
- "New users need clearer onboarding because they abandon within 2 minutes without understanding value"

#### Phase 3: Ideate Solutions

**Brainstorm Approaches:**

**For Findability Issues:**
1. Add global search with auto-complete
2. Redesign navigation to 3-tier hierarchy
3. Implement breadcrumbs
4. Add "Recently Viewed" section
5. Create dynamic filters

**Selection Criteria:**
- Impact (high/medium/low)
- Effort (high/medium/low)
- Feasibility (technical constraints)
- ROI

#### Phase 4: Prototype Redesign Proposals

**Proposal 1: Simplified Navigation Redesign**

**Current Issues:**
- 5-level navigation hierarchy (too deep)
- Hidden features
- Inconsistent labels

**Proposed Solution:**
```
Header:
[Logo] [Search Bar] [Key Actions: Add, Notifications, Profile]

Main Navigation (3 levels max):
- Dashboard
- Projects
  - Active
  - Archived
- Resources
  - Help Center
  - Community

Mobile: Hamburger menu with same structure
```

**Expected Impact:**
- Findable: 2/5 → 4/5
- Usability: 3/5 → 4/5
- 40% reduction in clicks to key features

**Effort**: 2 weeks (design + development)

---

**Proposal 2: Enhanced Error Tolerance System**

**Current Issues:**
- No undo functionality
- Destructive actions lack confirmation
- Generic error messages

**Proposed Solution:**
1. **Undo System**
   - 30-second undo buffer for all destructive actions
   - Toast notification: "Deleted [item]. Undo?"
   - Global undo button (Ctrl+Z / Cmd+Z)

2. **Confirmation Dialogs**
   - Clear consequences: "Delete project 'X'? All 47 tasks will be permanently removed."
   - Primary action: Cancel, Secondary: Delete

3. **Improved Error Messages**
   - What happened: "Failed to save changes"
   - Why: "Network connection lost"
   - Solution: "Check connection and try again"
   - Action: [Retry] button

**Expected Impact:**
- Error Tolerance: 2/5 → 4/5
- User confidence +35%
- Support tickets -50%

**Effort**: 1.5 weeks

---

**Proposal 3: Mobile-First Redesign**

**Current Issues:**
- Desktop design poorly adapted
- Small touch targets (32px)
- Horizontal scrolling required
- Complex mobile navigation

**Proposed Solution** (per IxDF Chapter 8):

1. **Small Screen Optimization**
   - Single column layout
   - 44×44px minimum touch targets
   - Large, thumb-friendly buttons

2. **One-Direction Scrolling**
   - Vertical scroll only
   - Avoid horizontal carousels

3. **Simplified Navigation**
   - Bottom tab bar (4-5 items max)
   - Hamburger for secondary features

4. **Minimal Content**
   - Progressive disclosure
   - Collapsed sections
   - "Show more" patterns

5. **Reduced Text Input**
   - Auto-complete
   - Smart defaults
   - Toggle buttons vs. typing

6. **Stable Connections**
   - Offline mode with sync
   - Optimistic UI updates
   - Retry mechanisms

7. **Integrated Experience**
   - Use camera for uploads
   - Location services
   - Push notifications

**Expected Impact:**
- Mobile usability: 2/5 → 4/5
- Mobile engagement +60%
- Mobile conversions +35%

**Effort**: 4 weeks (full mobile redesign)

---

#### Phase 5: Test and Iterate Recommendations

**Next Steps:**
1. **Create Wireframes/Prototypes**
   - Low-fidelity sketches
   - High-fidelity clickable prototypes (Figma)

2. **Usability Testing**
   - Test with 5-8 target users
   - Task-based scenarios
   - Think-aloud protocol

3. **A/B Testing**
   - Test variations
   - Measure: completion rate, time, satisfaction

4. **Iterate Based on Feedback**
   - Refine designs
   - Re-test critical flows

5. **Implement in Phases**
   - Phase 1: Critical fixes (P0)
   - Phase 2: High-impact improvements (P1)
   - Phase 3: Polish and optimization (P2-P3)

---

## Complete Audit Report Structure

```markdown
# UX Audit and Rethink Report
**Product**: [Name]
**Date**: [Date]
**Auditor**: [AI Agent]
**Methodology**: IxDF UX Framework (7 Factors + 5 Usability Characteristics + 5 Interaction Dimensions)

---

## Executive Summary

### Overall UX Health Score: 62/100 (C Grade)

**Key Findings:**
- Product provides value (Useful, Valuable) but struggles with usability
- Major gaps in Findability and Error Tolerance
- Mobile experience significantly below standards
- Quick wins identified with high ROI

**Critical Priorities:**
1. Implement undo system (Error Tolerance)
2. Redesign navigation (Findability)
3. Optimize mobile experience (Physical Space dimension)

---

## 1. UX Factors Assessment (7 Factors)

### Factor Scores

| Factor | Score | Status | Priority |
|--------|-------|--------|----------|
| Useful | 4/5 | ✅ Good | Medium |
| Usable | 3/5 | ⚠️ Needs work | High |
| Findable | 2/5 | ❌ Poor | Critical |
| Credible | 4/5 | ✅ Good | Low |
| Desirable | 3/5 | ⚠️ Needs work | Medium |
| Accessible | 2/5 | ❌ Poor | High |
| Valuable | 4/5 | ✅ Good | Low |

**Total**: 22/35 (63%)

[Detailed analysis for each factor...]

---

## 2. Usability Characteristics Assessment

### Usability Scores

| Characteristic | Score | Status | Impact |
|---------------|-------|--------|--------|
| Effectiveness | 4/5 | ✅ Good | High |
| Efficiency | 3/5 | ⚠️ Needs work | High |
| Engagement | 3/5 | ⚠️ Needs work | Medium |
| Error Tolerance | 2/5 | ❌ Poor | Critical |
| Ease of Learning | 3/5 | ⚠️ Needs work | High |

**Total**: 15/25 (60%)

**Utility Assessment**: Features present match user needs ✅
**Usefulness**: Utility (Good) + Usability (Fair) = **Acceptable but improvable**

[Detailed analysis...]

---

## 3. Interaction Design Dimensions

### Dimension Scores

| Dimension | Score | Key Issues |
|-----------|-------|------------|
| Words | 3/5 | Technical jargon, inconsistent terminology |
| Visual Representations | 4/5 | Minor icon clarity issues |
| Physical Objects/Space | 2/5 | Poor mobile optimization, small targets |
| Time | 3/5 | Slow loading, missing progress indicators |
| Behavior | 3/5 | Weak feedback, inconsistent patterns |

**Total**: 15/25 (60%)

[Detailed analysis...]

---

## 4. Issues Identified

### Critical (P0) - Fix Immediately

**Issue 1: No Undo for Destructive Actions**
- Frameworks: Usability (Error Tolerance), UX (Usable)
- Impact: Data loss, user frustration, support burden
- Severity: Critical
- Effort: Medium (2-3 days)
- Recommendation: Implement 30s undo buffer + confirmations

[Continue for all P0 issues...]

### High Priority (P1) - Fix This Sprint
[List...]

### Medium Priority (P2) - Next Release
[List...]

### Low Priority (P3) - Backlog
[List...]

---

## 5. Redesign Proposals

### Proposal 1: Navigation Redesign
[Full proposal with wireframes...]

### Proposal 2: Error Tolerance System
[Full proposal...]

### Proposal 3: Mobile-First Redesign
[Full proposal...]

---

## 6. Research Recommendations

### Immediate Research Needs
1. **Usability Testing** (Week 1-2)
   - 5-8 participants
   - Tasks: [Key tasks]
   - Goal: Validate findings

2. **User Interviews** (Week 2-3)
   - Questions: [List]
   - Goal: Deep dive on pain points

3. **Card Sorting** (Week 3)
   - Goal: Redesign IA
   - Method: Open card sort

### Analytics to Monitor
- Task completion rates
- Time on task
- Error rates
- Abandonment points
- Funnel drop-offs

---

## 7. Implementation Roadmap

### Phase 1: Critical Fixes (Weeks 1-2)
- Implement undo system
- Add prominent search
- Fix mobile touch targets
- **Expected Impact**: Error Tolerance 2→4, Findable 2→3

### Phase 2: Major Improvements (Weeks 3-6)
- Navigation redesign
- Mobile optimization
- Improved error messages
- **Expected Impact**: Usable 3→4, Mobile 2→4

### Phase 3: Polish (Weeks 7-10)
- Visual design refresh
- Micro-interactions
- Performance optimization
- **Expected Impact**: Desirable 3→4, Efficiency 3→4

### Success Metrics
- Overall UX score: 62 → 80+
- User satisfaction (SUS): [Current] → 75+
- Task completion: [Current] → 90%+
- Support tickets: -40%

---

## 8. Next Steps

1. **Stakeholder Review** (Week 0)
   - Present findings
   - Align on priorities
   - Secure resources

2. **Prototyping** (Week 1)
   - Create wireframes for proposals
   - Get quick feedback

3. **User Testing** (Week 2)
   - Validate assumptions
   - Test prototypes

4. **Implementation** (Weeks 3+)
   - Phased rollout
   - Monitor metrics
   - Iterate based on data

---

## Methodology Notes

- **Framework**: IxDF "The Basics of User Experience Design"
- **Standards**: 7 UX Factors + 5 Usability Characteristics + 5 Interaction Dimensions
- **Approach**: Expert review + heuristic evaluation + research recommendations
- **Limitations**: Simulated evaluation; validate with real users
- **Complement with**:
  - Nielsen Heuristics for usability depth
  - WCAG for accessibility compliance
  - Cognitive Walkthrough for task-specific analysis
  - UI Design Review for visual polish

---

## References

- Interaction Design Foundation - "The Basics of User Experience Design"
- Peter Morville - User Experience Honeycomb (7 Factors)
- ISO 9241-11 - Usability definition and metrics
- Gillian Crampton Smith & Kevin Silver - 5 Dimensions of Interaction Design
- Jakob Nielsen - Usability engineering principles

---

**Version**: 1.0
**Last Updated**: [Date]
```

---

## Scoring Guidelines

### Overall UX Health Score

Combine all three frameworks:
- 7 UX Factors: 35 points max
- 5 Usability Characteristics: 25 points max
- 5 Interaction Dimensions: 25 points max (convert to 5-point scale)

**Total**: 85 points possible

**Grading:**
- 85-75: A (Excellent) - Best-in-class UX
- 74-65: B (Good) - Solid UX, minor improvements
- 64-55: C (Acceptable) - Functional but needs work
- 54-45: D (Poor) - Major issues, significant redesign needed
- 44-0: F (Critical) - Broken UX, complete overhaul required

---

## Mobile-Specific Guidelines (IxDF Chapter 8)

When evaluating mobile:

### 1. Small Screens
- Content fits viewport without horizontal scroll
- Touch targets 44×44px minimum
- Text readable without zoom (16px+ body)
- One column layouts

### 2. Simple Navigation
- Bottom tab bar (4-5 items)
- Hamburger for secondary
- No deep hierarchies (3 levels max)
- Large, clear tap areas

### 3. Minimal Content
- Progressive disclosure
- Priority content above fold
- Collapsed sections
- Avoid long pages

### 4. Reduced Inputs
- Minimize typing
- Smart defaults
- Auto-complete
- Toggles over text fields

### 5. Stable Connections
- Offline functionality
- Sync when online
- Optimistic UI
- Clear connection status

### 6. Integrated Experiences
- Use device capabilities (camera, GPS, notifications)
- Native feel on platform
- Gestures (swipe, pinch)

---

## Design Thinking Integration

This skill incorporates Design Thinking:

**Empathize**: Through user research and persona creation
**Define**: By identifying problem statements from audit
**Ideate**: Through redesign proposal brainstorming
**Prototype**: By recommending wireframes and mockups
**Test**: Through usability testing recommendations

---

## Best Practices

1. **Be Evidence-Based**: Support ratings with data, feedback, or observations
2. **Think Holistically**: Consider all frameworks together
3. **Prioritize Ruthlessly**: Focus on high-impact, feasible improvements
4. **Validate Assumptions**: Recommend user research to confirm findings
5. **Be Actionable**: Provide specific recommendations, not vague suggestions
6. **Consider Context**: Mobile vs. desktop, user types, business constraints
7. **Balance Factors**: Trade-offs between aesthetics, usability, and business needs
8. **Iterate**: Audit → Redesign → Test → Refine
9. **Measure Impact**: Define success metrics before implementing
10. **Stay Ethical**: Present honest findings, acknowledge limitations

---

## Version

1.0 - Initial release based on IxDF "The Basics of User Experience Design"

---

**Remember**: This holistic audit provides a comprehensive UX baseline. For deeper dives, follow up with specialized audits (Nielsen for usability, WCAG for accessibility, Cognitive Walkthrough for specific tasks, UI Design Review for visual polish).
