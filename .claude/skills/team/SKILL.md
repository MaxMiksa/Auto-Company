---
name: team
description: "Quickly assemble a temporary AI agent team for a task. Automatically selects the best-fitting members from .claude/agents/."
argument-hint: "[task description]"
disable-model-invocation: true
---

# Assemble a Temporary Team

Based on the task below, pick the best-fitting members from the company's existing AI agents and assemble a temporary team to complete it collaboratively.

## Task

$ARGUMENTS

## Available Agents

These are all of the company's agents, defined under `.claude/agents/`:

| Agent | File | Function |
|-------|------|----------|
| CEO | `ceo-bezos` | Strategic decisions, business model, PR/FAQ, prioritization |
| CTO | `cto-vogels` | Technical architecture, technology selection, system design |
| Inversion | `critic-munger` | Challenge decisions, find fatal flaws, pre-mortems, prevent groupthink |
| Product Design | `product-norman` | Product definition, user experience, usability |
| UI Design | `ui-duarte` | Visual design, design systems, color and typography |
| Interaction Design | `interaction-cooper` | User flows, personas, interaction patterns |
| Full-Stack | `fullstack-dhh` | Implementation, technical approach, development |
| QA | `qa-bach` | Test strategy, quality control, bug analysis |
| DevOps/SRE | `devops-hightower` | Deployment pipelines, CI/CD, infrastructure, monitoring and operations |
| Marketing | `marketing-godin` | Positioning, brand, acquisition, content |
| Operations | `operations-pg` | User operations, growth, community, PMF |
| Sales | `sales-ross` | Sales funnel, conversion strategy |
| CFO | `cfo-campbell` | Pricing strategy, financial models, cost control, unit economics |
| Research Analyst | `research-thompson` | Market research, competitive analysis, industry trends, opportunity discovery |

## Execution Steps

### 1. Analyze the task and select members

Based on the nature of the task, select the 2-5 most relevant agents as team members. Selection principles:
- **Only pick who is necessary**: more people is not better; match the task's actual needs
- **Consider the collaboration chain**: if the task spans design through development, make sure the key roles along that chain are present
- **Avoid redundancy**: do not select agents whose functions overlap

Briefly tell the founder who you picked and why, then start assembling immediately.

### 2. Assemble the Agent Team

Use the Agent Teams feature to assemble a temporary team:
- Create the team, naming `team_name` after the task (English, kebab-case)
- Create a concrete task for each member (TaskCreate), with enough context in the task description
- Spawn each teammate with the Task tool, `subagent_type` set to `general-purpose`, injecting the full content of the corresponding agent file into the prompt as the role definition
- When spawning a teammate, tell it in the prompt: your role definition, the task to complete, and that output documents go under `docs/<role>/`

### 3. Coordinate and consolidate

- As team lead, coordinate the members' work
- Collect each member's output and consolidate it into a single conclusion or proposal
- If there is disagreement, list each side's position for the founder to decide
- Clean up team resources when finished

## Notes

- All communication is in English; keep technical terms in their standard English form
- Each member's documents go under `docs/<role>/` as agreed
- The team is temporary and disbands as soon as the task is complete
- The founder is the final decision maker; agents advise but do not decide
