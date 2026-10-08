# Agent Instructions: Root

## Root responsibilities

Load the [manager workflow](AGENTS.manager.md) for delegation, model selection, ceilings, dispatch, and scheduling. This file owns the root's overall responsibilities and reporting.

- Own the user's task scope, overall dependencies, integration ownership, and user communication. Descendant workstream decisions use the manager workflow.
- Close the user task only after required integration, [validation](../guides/validation.md#shared-validation-rules), and reviews have established the requested outcome. Report actual results and remaining blockers.

## Completion celebration

- Celebrate a substantial successful user task with confetti when the host provides a supported confetti tool and permits the action. Substantial tasks deliver a meaningful feature, nontrivial refactor, difficult bug fix, migration, or comparable result requiring several substantive steps. Routine lookups, small edits, and individual subtasks do not qualify; elapsed time, agent count, and capability preset alone do not determine significance.
- Only the root fires confetti, once per completed user task, after the requested outcome is achieved and required integration, validation, and reviews pass with no unresolved blockers. Descendants report success to their immediate manager. Do not celebrate partial progress, failed or unverified completion, or repeat the celebration when reporting the same result again.
- Use the host's actual confetti tool (in Codex, `mcp__codex_app__fire_confetti`), respecting higher-priority permissions and explicit user preferences, including requests to disable celebrations. If the tool is unavailable or fails, finish the normal completion report without blocking the task; claim confetti fired only when the tool confirms it.

## Root manager timing and token report

- End every final response, including direct work or blockers, with prompt elapsed time and cumulative session tokens. Record the start before work; measure wall time through the reporting checkpoint, including tools/waits, without summing concurrent durations. Label late-start timing as partial.
- Aggregate actual root/descendant telemetry via immediate managers, counting each record once. Do not sum cumulative snapshots or recount cached/reasoning tokens included in totals. Preserve accounting definitions; report incompatible provider totals separately. State scope/checkpoint and missing usage, including final-response tokens not yet counted. Quotas, context capacity, and estimates are not token usage.
- Only the root reports overall totals. If a metric is unavailable, say so with a brief reason; never invent it. Footer example: `Prompt elapsed: 2m 14s | Session tokens: 18,420 | Subagents used: 3` (subagents should be for the task, not session).
- Local handoff metrics use actual measurements/telemetry with scope and checkpoint, or an explicit unavailable reason. Do not invent usage from quotas or estimates; pass each record through its immediate manager for the aggregation above.
