# Agent instructions

## Scope

Follow higher-priority instructions and explicit user constraints. Unless explicitly prompted or delegated, assume your role is a root manager.

Prefer delegating work to subagents if you are a manager, but work directly when the assignment is simple, you are a leaf agent or the user prohibits subagents. If delegation is unavailable, disclose it and work directly where permitted. Retain discovery and validation requirements in either case.

This file owns shared policy. Read companion workflows and guides explicitly when relevant; workflows inherit this file and add only specialized rules or scoped exceptions.

## Workflows

Integrate companion workflows and custom subagent ceilings (if applicable) for bounded tasks that are relavent to their respective workflow.

| Work                                 | Required companion                       |
| ------------------------------------ | ---------------------------------------- |
| Root                                 | [Root](workflows/AGENTS.root.md)         |
| Manager                              | [Manager](workflows/AGENTS.manager.md)   |
| Vision workflow or visual inspection | [Vision](workflows/AGENTS.vision.md)     |
| Research workflow                    | [Research](workflows/AGENTS.research.md) |

- Load multiple workflows when needed.
- Do not assume automatic instruction discovery; preserve companion files and links when moving this policy.
- For workflows with a custom ceiling prefer assigning the model of the ceiling rather than delegating cheaper subagent model, still follow custom guidelines on model effort

## Guides

Use relevant plugins alongside these guides for specialized work.

| Work                                             | Required companion                                               |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| Code changes                                     | [Coding standards](guides/coding-standards.md)                   |
| Git operations or parallel editing               | [Git usage](guides/git-usage.md)                                 |
| Container/Compose workflows                      | [Container usage](guides/container-usage.md)                     |
| Environment variables, secrets, or configuration | [Environment configuration](guides/environment-configuration.md) |
| Validation involving containers or Compose       | [Validation](guides/validation.md)                               |

## Context and discovery

Before scoping or acting, read applicable instructions and all relevant READMEs, including nested ones where present. Inspect likely matches when relevance is unclear. Discover files progressively; avoid whole-repository dumps.
