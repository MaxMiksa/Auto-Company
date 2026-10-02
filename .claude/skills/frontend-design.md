---
name: frontend-design
description: Design and implement distinctive, usable web interfaces, or refine an existing product's layout, typography, color, components and responsive states. Use for frontend creation and visual refinement, within the requested product scope.
license: Apache-2.0; see frontend-design.LICENSE.txt
---

# Frontend Design

Create an interface with a deliberate visual identity that helps its specific audience complete a real task. This applies to working software as well as websites. Read the existing product and its task before choosing its visual treatment.

## Establish the direction

Before implementation, leave a short design brief in the work notes: the user and situation; the primary task and outcome; the content that deserves attention first; and a visual direction supported by that content. Name concrete choices for typography, color roles, layout and the main interactive component. Briefly compare a plausible alternative so the choice is intentional. Keep this brief out of the product interface.

- **Refining an existing product:** inspect its current screens, assets and states. Preserve its identity, useful structure, familiar actions and functional scope. Identify what needs to change to improve hierarchy or use; a refinement need not become a redesign.
- **Creating a new product:** derive the direction from the audience, material and use context. A workbench, a shared activity and a visual collection can need very different compositions. Do not reuse one portfolio-wide palette or page skeleton.

Use the user's chosen stack and existing components. Add a framework or dependency only when the requested behavior requires it. A small HTML/CSS implementation can receive the same design attention as a larger application.

## Make the task visible

Give the main work meaningful space. Put its next action where the user needs it; keep input, preview, feedback and result close when they belong to the same decision. Choose the content's natural structure: rows for comparable records, a canvas for spatial work, a reading surface for a story, or another appropriate structure. Use cards, tabs, tables and dialogs for an identifiable interaction reason.

Define the important components precisely enough to implement: alignment, dimensions or responsive bounds, type hierarchy, spacing, wrapping, and normal, selected, focus, disabled and error states. Maintain these relationships across the actual screens; a large heading above indistinguishable controls is insufficient hierarchy.

## Give it character

- **Type:** use a purposeful type scale and strong text hierarchy. Choose faces and fallbacks that render the product language well; use existing or available fonts and verify missing-font behavior. Distinctiveness may come from composition and proportions rather than adding a font download.
- **Color:** choose a coherent base, readable text, action and semantic status colors. Consider contrast and saturation across the whole composition. A strong color field or accent can organize attention when the product supports it. Do not default every product to pale green, beige, dark panels or any other repeated theme; do not change a fitting established color merely for variety.
- **Composition:** make one visual choice carry the identity, such as the work surface, an image treatment, typography or a purposeful color field. Balance density and whitespace around the task. Decorative borders, gradients, texture, oversized hero copy and motion must earn their space.
- **Interaction:** show cause and effect through clear states and feedback. Use motion where it clarifies a change, respect reduced-motion settings, and retain keyboard operation and visible focus.

## Edit interface copy

Keep labels and actions concrete and consistent. Remove repeated introductions, implementation commentary and decorative micro-labels. Move occasional explanations into nearby help or a clearly named expandable section; do not turn the main task into a wall of muted small print.

Keep essential instructions readable. Place errors beside the affected input and provide a recovery action. Keep relevant privacy, consent, destructive-action consequences and genuine limits visible before the decision they affect. Secondary information may have less visual weight without becoming tiny or low contrast. Do not delete limitations, invent testimonials or conceal failures to make a screenshot look cleaner.

## Verify the implemented experience

Use real input and inspect the resulting interface at desktop and narrow widths. Review the main task and its meaningful result, plus the relevant empty, error and long-content states. Check readable contrast, focus, control hit areas, wrapping and overflow. Exercise the original task, saved state and exports where the change touches them. Compare actual screenshots with the brief and correct the implementation, not the image. Report the checks performed and any limits honestly.

## Source and modifications

Adapted by Auto Company on 2026-10-02 from Anthropic's [frontend-design skill](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md), distributed under [Apache License 2.0](frontend-design.LICENSE.txt). The original skill in this repository has been rewritten for task-led products, existing-product refinement, readable copy and functional verification. This is a project adaptation, not an unchanged upstream copy or an endorsement.

Additional design reference: OpenAI's [frontend prompt guidance](https://developers.openai.com/api/docs/guides/frontend-prompt). The local guidance does not require a particular model, framework, color scheme or template.
