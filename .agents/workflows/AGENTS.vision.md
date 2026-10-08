# Agent Instructions: Vision Workflow

## Specialized capability ceiling

Use the [manager ceiling rules](AGENTS.manager.md#capability-ceilings) and [model selection](AGENTS.manager.md#model-and-effort-selection) to dispatch and configure visual assignments. This section owns vision qualification and the scoped maximum:

| Selected preset | Maximum vision tier |
| --------------- | ------------------- |
| light | Specialist with verified vision capability |
| balanced | Frontier with verified vision capability |
| heavy | Frontier with verified vision capability |

- The scoped ceiling replaces the general ceiling only for assignments inspecting actual visual inputs. It remains available through a cheaper general manager. Verify both visual capability and image access; text-only summaries do not constitute image QA.
- Managers, code writers, image-generation orchestration, and text-only reviewers retain the general ceiling. Do not pass this exception to unrelated descendants; split mixed assignments into visual inspection and general execution.
- Explicit restrictions and scoped overrides follow the linked manager rules. Every selected visual model must have verified vision support; select sufficient capability for input detail and ambiguity.

## Visual inputs

Use [manager dispatch](AGENTS.manager.md#dispatch-and-acceptance), the [leaf workflow](AGENTS.leaf.md) for leaf inspectors, and [coordination](../guides/subagent-coordination.md) for handoffs/recovery.

- Supply current outputs and comparisons as accessible image paths/references, plus intended style, viewing scale, acceptance criteria, and specific questions in the assignment brief.
- Inspect actual rendered pages/screens for PDFs, slides, or UI. Include a full view plus detail crops when useful; do not judge unseen regions or inaccessible/insufficient-resolution inputs.
- Split by image batch, page, screen, or evaluation dimension. Keep batches small enough to detect required detail at supported resolution.

## Inspection and repair loop

1. Inspect pixels for relevant anatomy/geometry, text accuracy, clipping, blur, lighting, style consistency, layout, contrast, alignment, and rendering defects. For interactive UI, also perform functional checks; screenshots alone cannot prove behavior.
2. Return per-artifact pass/fail/unable-to-verify findings with location, severity, observable evidence, and correction. Separate measured defects from preferences and uncertain interpretations.
3. Route repairs through the [manager workflow](AGENTS.manager.md#recursive-delegation) to the assigned editor. The editor produces a stable new revision. Apply [shared validation rules](../guides/validation.md#shared-validation-rules) to reinspection; include changed assets and dependent visual regions.
4. Allow at most three repair/recheck retries after the initial failure, subject to tighter user/assignment limits. This visual-repair allowance replaces the [shared recovery default](../guides/subagent-coordination.md#stalls-and-recovery); other recovery mechanics remain there.

Report the exact inspection limitation for inaccessible or inadequate inputs and complete unaffected checks; do not mark visual acceptance passed without usable visual evidence.
