---
name: team
description: "Quickly assemble a temporary AI agent team for a task. Automatically select the most suitable members from .claude/agents/."
argument-hint: "[task description]"
disable-model-invocation: true
---

# Assemble a Temporary Team

For the task below, select the most suitable members from the company's existing AI agents and assemble a temporary team to complete it together.

## Task

$ARGUMENTS

## Available Agents

These are all of the company's agents, defined in `.claude/agents/`:

| Agent | File | Responsibilities |
|-------|------|------------------|
| CEO | `.claude/agents/ceo-bezos.md` | Strategic decisions, business models, PR/FAQ, priorities |
| CTO | `.claude/agents/cto-vogels.md` | Technical architecture, technology selection, system design |
| Inversion Advisor | `.claude/agents/critic-munger.md` | Challenge decisions, identify fatal flaws, Pre-Mortem, prevent collective delusion |
| Product Design | `.claude/agents/product-norman.md` | Product definition, user experience, usability |
| UI Design | `.claude/agents/ui-duarte.md` | Visual design, design systems, color and typography |
| Interaction Design | `.claude/agents/interaction-cooper.md` | User flows, personas, interaction patterns |
| Full-Stack Development | `.claude/agents/fullstack-dhh.md` | Code implementation, technical solutions, development |
| QA | `.claude/agents/qa-bach.md` | Test strategy, quality control, bug analysis |
| DevOps/SRE | `.claude/agents/devops-hightower.md` | Deployment pipelines, CI/CD, infrastructure, monitoring and operations |
| Marketing | `.claude/agents/marketing-godin.md` | Positioning, brand, acquisition, content |
| Operations | `.claude/agents/operations-pg.md` | User operations, growth, community, PMF |
| Sales | `.claude/agents/sales-ross.md` | Sales funnels, conversion strategy |
| CFO | `.claude/agents/cfo-campbell.md` | Pricing strategy, financial models, cost control, unit economics |
| Research | `.claude/agents/research-thompson.md` | Market research, competitive analysis, industry trends, opportunity discovery |

## Execution Steps

### 1. Analyze the Task and Select Members

Select the 2-5 most relevant agents for the nature of the task. Selection principles:
- **Select only those needed**: More people is not always better; match the task's needs precisely
- **Consider the collaboration chain**: If the task spans design through development, ensure the key roles along that chain are represented
- **Avoid redundancy**: Do not select overlapping roles together

Briefly explain to the founder whom you selected and why, then immediately start assembling the team.

### 2. Create an Agent Team

Use the Agent Teams feature to assemble the temporary team:
- Create a team with a short, task-based `team_name` (English, kebab-case)
- Create a specific task for each member (TaskCreate), with enough context in the task description
- Use the Task tool to spawn each teammate with `subagent_type` set to `general-purpose`; inject the full content of the corresponding agent file into the prompt as its role definition
- When spawning a teammate, state in the prompt: its role definition, the task to complete, the cycle's runtime `Language` instruction, and that output documents belong under `docs/<role>/`

For frontend work, name one selected member as design owner without expanding the team just for a title. The owner and implementer must read `.claude/skills/frontend-design.md`. Select refinement or redesign/new-build mode from the user's intent; an existing codebase alone does not select refinement. Pass the mode, user task, functional contracts, agreed visual direction, key component decisions and acceptance states with the implementation handoff. In an explicit redesign, do not reintroduce earlier refinement-only identity, palette or layout constraints. The owner checks the implemented screens, not only a written design.

### 3. Coordinate and Consolidate

- Coordinate the members' work as team lead
- Collect their outputs and consolidate them into a unified conclusion or proposal
- If there are disagreements, present each position for the founder to decide
- Clean up team resources after completion

## Notes

- Follow the runtime product `Language` instruction for user-facing communication and documents throughout the current product, including pauses and restarts. A requested language change applies to the next product. If no product language is assigned, follow explicit human language instructions or the user's language. Keep technical terms in English. The language of this skill's source does not set the output language
- Leave language preference changes to the human-operated settings interface; do not edit saved language configuration or the current product's language state
- Store each member's output documents under `docs/<role>/` as agreed
- The team is temporary and dissolves when the task is complete
- The founder is the final decision-maker; agents provide advice but do not replace that decision-making authority
