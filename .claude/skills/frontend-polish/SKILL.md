---
name: frontend-polish
description: Refine an already working product frontend in a dedicated finishing pass, preserving its identity while improving hierarchy, components, copy and responsive behavior. Use after the core flow works or when the user asks for frontend polish; not for product ideation or a new visual direction.
---

# Frontend Finishing Pass

Bring the working product to a state suitable for direct demonstration and delivery. First use [frontend-design](../frontend-design.md). Build on the product's effective design, preserving its overall style, color roles, main layout and familiar actions. Adjust local layout to solve a concrete usability problem; do not change the theme, typographic character, navigation or framework merely to make the difference look larger. New explicit human requirements take precedence.

## Entry and completion

- Schedule one dedicated pass once the core flow actually works. If core functionality is blocked, fix and record the blocker first; visual polish must not conceal it.
- Read the current workspace's product, task, existing design decisions and acceptance records. Use only materials accessible within this project's permitted scope. Do not read other projects for a visual direction or a reference answer.
- Do not repeat a completed pass for the current interface version after restart or in the next cycle. Later substantial interface changes need a review of affected screens only. If no worthwhile improvement remains, record that judgment instead of forcing a redesign to produce a diff.
- Record actual changes, screenshots, functional checks and remaining issues, then return to normal product work. Finishing this pass does not require stopping the project or override human governance, budgets or a paused runtime.

## Inspect real screens first

Run the current product and inspect its main flow, populated content and result on desktop and mobile. Preserve the initial states and screenshots using the same inputs intended for comparison. Establish what the user came to do, what deserves attention first and where the next action belongs. Identify the issues with the greatest effect on task completion and appearance. Briefly note what to keep, what to fix and why; keep this design commentary out of the product interface.

## Refinement priorities

### Task, layout and density

Keep the main action, working content and result easy to find. Place related input, feedback and results at useful distances. Reduce introductions, repeated headings and empty space that crowd out the work. Adjust alignment, grouping and proportions to express content relationships; avoid mechanical stacks of cards, pills and decorative icons. Retain useful strong color fields and product character while improving their relationship to the content.

### Consistency within the product

Review heights, spacing, borders, radii, type sizes, icons and alignment across buttons, inputs, selectors, lists, tables and dialogs. Use consistent names and feedback for the same action; distinguish primary, secondary and destructive actions. Reuse this product's components and complete their focus, selected, disabled, loading, success and error states. Style the actual controls consistently so a mixture of browser defaults and custom components does not leave the interface looking unfinished.

### Typography and color

Establish clear heading, body, label and supporting-information levels. Check natural line height, weight and wrapping for Chinese, English, numbers and long content. Necessary information must be large and clear enough to read. Retain color relationships that suit this product, correcting contrast, saturation and status colors. Do not standardize products on green, warm paper with red-brown accents or another fixed template; do not damage a good existing design merely to avoid a color family.

### Remove explanations that do not help the task

Judge each passage by whether it helps the user decide, enter information, understand a result or recover from an error. Remove repeated introductions, restatements of obvious actions, implementation commentary, design self-description, decorative English micro-headings and small gray text that exists only to explain the obvious. Do not mechanically relocate this clutter into another disclosure.

Keep useful format examples, units, input constraints, next steps for empty states, specific errors and result meanings. Occasional explanations can live in relevant nearby help. Privacy, consent, irreversible consequences and real limits must be readable before the affected decision. Do not clean up a screenshot by deleting necessary labels, reducing type size or contrast, or hiding failures.

### Complete interactions and responsive behavior

Check the actual result of each affected action: clear state, safe repeated clicks, consistent save/reload behavior and preserved import/export data. Fix unresponsive buttons, feedback that obscures content and broken links. Keep unrelated features out of this finishing pass.

On mobile, reconsider content order, control reachability, long headings, keyboard operation and overflow. Large headings and decoration must not push the main action far away. On desktop, check content width and density. Review dialogs, print and export views when relevant. Preserve keyboard focus and necessary accessible names; use motion to explain state changes.

## Accept the actual result

Compare actual before/after pages at the same device dimensions, with the same inputs and business state. Cover the main flow and relevant risks in empty/error states, long content, save/recovery and exports. Scale checks to the changes and stop broadening or repeating them once the relevant checks pass.

Judge whether users can find the main action and result more easily, components are more consistent, copy is shorter without losing meaning, desktop/mobile views are readable and operable, and existing functionality and character survive. Keep changes with concrete benefits; revert parts that make the task harder or the interface visibly worse. A large diff, new accent color or subjective score increase alone does not establish improvement.

Fix the actual page before capturing it; do not edit pixels or fabricate data. Showcase captures follow the target language. When bilingual delivery is already required, check both languages' controls and screenshots separately. Copy cleanup must not rewrite recorded history; keep diagnostics and implementation details in appropriate logs or help.

Write a short finishing record in the runtime product language: changes and reasons, actual checks and screenshots, and unresolved issues. Identify the current product and interface version, and record completion or the concrete blocker in the existing consensus. State when browser inspection or a particular check was not performed; do not report a plan as a result.
