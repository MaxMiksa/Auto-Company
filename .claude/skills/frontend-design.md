---
name: frontend-design
description: Design and implement distinctive, usable web interfaces. Use for frontend creation, an explicitly requested redesign, or refinement of an existing product, with the scope chosen from the user's intent.
license: Apache-2.0; see frontend-design.LICENSE.txt
---

# Frontend Design

Create an interface with a deliberate visual identity that helps its specific audience complete a real task. This applies to working software as well as websites. Understand the product's task and functional contracts before choosing its visual treatment.

## Select the requested mode

An existing codebase does not automatically mean refinement. Choose the mode from the user's request and record it in the design brief. A current explicit redesign request overrides earlier refinement-only visual constraints; preserve unrelated functional and operational requirements.

- **Refine:** for targeted polish or improvement, inspect the current screens, assets and states. Preserve the useful identity, structure and familiar actions unless the requested change needs otherwise. Do not turn a local improvement into an unsolicited redesign.
- **Redesign / new build:** when the user asks to redesign, rebuild, reimagine or create a new frontend, derive the composition from the audience, material and task. For an existing product, establish its behaviors, data contracts and recovery paths first, then propose the new direction before studying old styling in detail. Existing screens are functional references, not a required palette, layout, type system, component system or navigation flow. Replacing frontend code and reorganizing the full experience is allowed within the request. Preserve business meaning, existing data compatibility, import/export, recovery, privacy and meaningful errors unless the user explicitly changes those requirements.

Honor explicit stack choices. For refinement, reuse the existing stack and components. For an authorized redesign or new build, choose an implementation that supports the design and delivery needs; neither a framework migration nor retaining the framework is a visual requirement. Keep dependencies proportionate and verify the resulting application.

## Establish the direction

Before implementation, leave a short design brief in the work notes: the user and situation; the primary task and outcome; the content that deserves attention first; and a visual direction supported by that content. Name concrete choices for typography, color roles, layout and the main interactive component. Briefly compare a plausible alternative so the choice is intentional. Keep this brief out of the product interface.

A workbench, a shared activity and a visual collection can need very different compositions. Do not reuse one portfolio-wide palette or page skeleton. In redesign mode, make the new direction concrete in the work surface, information hierarchy and interaction, not just a changed accent color. No color family or layout is required or prohibited; make the choices appropriate to this product. A small HTML/CSS implementation can receive the same design attention as a larger application.

## Make the task visible

Give the main work meaningful space. Put its next action where the user needs it; keep input, preview, feedback and result close when they belong to the same decision. Choose the content's natural structure: rows for comparable records, a canvas for spatial work, a reading surface for a story, or another appropriate structure. Use cards, tabs, tables and dialogs for an identifiable interaction reason.

Define the important components precisely enough to implement: alignment, dimensions or responsive bounds, type hierarchy, spacing, wrapping, and normal, selected, focus, disabled and error states. Maintain these relationships across the actual screens; a large heading above indistinguishable controls is insufficient hierarchy.

## Give it character

- **Type:** use a purposeful type scale and strong text hierarchy. Choose faces and fallbacks that render the product language well; use existing or available fonts and verify missing-font behavior. Distinctiveness may come from composition and proportions rather than adding a font download.
- **Color:** choose a coherent base, readable text, action and semantic status colors. Consider contrast and saturation across the whole composition. A strong color field or accent can organize attention when the product supports it. Do not default every product to a repeated theme. In refinement, retain fitting established color roles; in redesign, choose them afresh from the brief.
- **Composition:** make one visual choice carry the identity, such as the work surface, an image treatment, typography or a purposeful color field. Balance density and whitespace around the task. Decorative borders, gradients, texture, oversized hero copy and motion must earn their space.
- **Interaction:** show cause and effect through clear states and feedback. Use motion where it clarifies a change, respect reduced-motion settings, and retain keyboard operation and visible focus.

## Edit interface copy

Keep labels and actions concrete and consistent. Remove repeated introductions, implementation commentary and decorative micro-labels. Move occasional explanations into nearby help or a clearly named expandable section; do not turn the main task into a wall of muted small print.

Keep essential instructions readable. Place errors beside the affected input and provide a recovery action. Keep relevant privacy, consent, destructive-action consequences and genuine limits visible before the decision they affect. Secondary information may have less visual weight without becoming tiny or low contrast. Do not delete limitations, invent testimonials or conceal failures to make a screenshot look cleaner.

## Verify the implemented experience

Use real input and inspect the resulting interface at desktop and narrow widths. Review the main task and its meaningful result, plus the relevant empty, error and long-content states. Check readable contrast, focus, control hit areas, wrapping and overflow. Exercise the original task, saved state and exports where the change touches them. Compare actual screenshots with the brief and correct the implementation, not the image. Report the checks performed and any limits honestly.

## Source and modifications

Adapted by Auto Company on 2026-10-02 from Anthropic's [frontend-design skill](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md), distributed under [Apache License 2.0](frontend-design.LICENSE.txt). The original skill in this repository has been rewritten for task-led products, intent-selected refinement or explicit redesign/new-build work, readable copy and functional verification. This is a project adaptation, not an unchanged upstream copy or an endorsement.

Additional design reference: OpenAI's [frontend prompt guidance](https://developers.openai.com/api/docs/guides/frontend-prompt). The local guidance does not require a particular model, framework, color scheme or template.
