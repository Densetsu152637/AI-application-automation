# Agent instructions

## Scope and policy ownership

Follow higher-priority instructions and explicit user constraints. Unless explicitly prompted or delegated, assume your role is a root manager.

This file owns shared instruction priority, discovery, and the companion index. Each companion owns the rules for its topic. Put a rule in its narrowest applicable owner; consumers must link to that owner and load it when relevant instead of restating the rule. Workflow steps may invoke linked procedures, and templates may define field schemas without duplicating behavioral policy.

Companions inherit this file and add only specialized rules or scoped exceptions. A profile describes an assignment, not a new instruction priority or permission grant. Do not assume automatic instruction discovery; preserve links and update consumers when moving a rule.

## Workflows

| Work | Required owner |
| ---- | -------------- |
| Root | [Root responsibilities and overall reporting](workflows/AGENTS.root.md) |
| Manager | [Delegation, model selection, ceilings, and scheduling](workflows/AGENTS.manager.md) |
| Leaf subagent | [Bounded execution authority](workflows/AGENTS.leaf.md) |
| Research | [Research eligibility, ceiling, and methods](workflows/AGENTS.research.md) |
| Visual inspection | [Vision eligibility, ceiling, and methods](workflows/AGENTS.vision.md) |

Load all applicable owners. Assignment profiles are indexed in [profiles/README.md](profiles/README.md).

## Guides

Use relevant plugins alongside these guides for specialized work.

| Work | Required owner |
| ---- | -------------- |
| Handoffs, context lifecycle, stalls, or recovery | [Subagent coordination](guides/subagent-coordination.md) |
| Acceptance checks or validation evidence | [Validation](guides/validation.md) |
| Code changes | [Coding standards](guides/coding-standards.md) |
| Git operations or parallel editing | [Git usage](guides/git-usage.md) |
| Container/Compose workflows | [Container usage](guides/container-usage.md) |
| Environment variables, secrets, or configuration | [Environment configuration](guides/environment-configuration.md) |
| Reusable failure lessons | [Failure catalog maintenance](learning/README.md) |

## Editing and temporary artifacts

- Edit authoritative files in the assigned checkout through permitted tools; use [Git isolation](guides/git-usage.md#parallel-work-and-worktrees) when required. Avoid ad hoc local draft/backup trees and one-off installer/check scripts merely to stage or review routine edits. Review normal diffs or the stable target artifacts instead.
- If a target is protected, use the host's permission mechanism for the authorized edit. Shadow drafts are not a substitute for permission to change that target.
- Create temporary artifacts only when a concrete task or required tooling needs them, such as render intermediates or reproducible execution evidence. Use the smallest necessary scope at an assigned temporary location, keep it separate from source/deliverables, and clean up task-created scratch artifacts when no longer needed. Preserve required evidence and handoff records under the [coordination contract](guides/subagent-coordination.md#assignment-and-result-contracts).

## Context and discovery

Before scoping or acting, read applicable instructions and all relevant READMEs, including nested ones where present. Inspect likely matches when relevance is unclear. Discover files progressively; avoid whole-repository dumps. Use companion indexes to select relevant material rather than loading every profile or failure entry.
