# Compose-first container usage

This guide owns Compose discovery, project identity, command semantics, and container lifecycle. Configuration/secrets belong to [environment configuration](environment-configuration.md); validation evidence, readiness, and check order belong to [validation](validation.md).

## Discovery and project identity

- Inspect the consuming project's Compose files/overrides, Dockerfiles, scripts, Makefiles, and relevant READMEs before suggesting or running commands. Use its Compose model as the source of truth for services, build context, dependencies, networks, volumes, environment, and profiles.
- Resolve actual services with `docker compose ... config --services`; never present guessed names as executable defaults. Prefer documented wrapper scripts encoding project-specific options.
- Use the modern `docker compose` CLI. Keep the same ordered `-f` files, `--env-file`, profiles, project name, and project directory throughout related operations. Discover which options apply; do not silently switch project identity or configuration.
- `...`, `SERVICE`, and `COMMAND` in this guide are placeholders. Replace them with the resolved consistent options, discovered names, and actual commands; do not execute them literally.
- Handle configuration output under [environment configuration](environment-configuration.md#configuration-output).

## Lifecycle commands

- Inspect existing state with `docker compose ... ps`; reuse suitable running services rather than rebuilding or restarting without reason. Diagnose with the same options and `logs --tail <count> SERVICE`.
- Start selected services and dependencies with `up -d SERVICE...`. Use `up -d --build SERVICE...` when changed build inputs must be incorporated. Use `build SERVICE...` for intentional build-only checks; building alone does not update a running container.
- Choose the update method by the input path: bind-mounted source may be immediately visible, while source copied into an image needs rebuilding and recreation. `restart` does not apply changed Compose configuration/environment. Inspect mounts/images first.
- Apply [readiness checks](validation.md#readiness) before dependent work.
- Use standalone `docker build`/`docker run` for Compose services only for an explicit task reason, such as a minimal reproduction. State that reason and preserve required build arguments, mounts, networking, and environment.

## Check execution

- Use `docker compose ... exec -T SERVICE COMMAND` for scripts/CI in a running service; omit `-T` for interactive use. `exec` does not create a fresh environment.
- Use `docker compose ... run --rm SERVICE COMMAND` for a fresh one-off environment. Verify it has the files, dependencies, and environment required for the check. `run` does not publish service ports by default; `--rm` removes only the one-off container, while volumes/databases may remain shared.
- Apply [shared resource isolation](git-usage.md#parallel-work-and-worktrees) before concurrent container checks.

## Cleanup

- Stop only in-scope services/project resources. Prefer `stop SERVICE...` when preserving containers/networks matters. Use `down` only when removing project containers/network is intended.
- Do not remove volumes/images or add `-v` as routine cleanup without explicit scope and ownership/data checks. Avoid global prune commands.
- Clean up task-created temporary images when in scope and no longer needed; preserve unrelated resources.

References: [Compose CLI](https://docs.docker.com/reference/cli/docker/compose/), [up](https://docs.docker.com/reference/cli/docker/compose/up/), [build](https://docs.docker.com/reference/cli/docker/compose/build/), [exec](https://docs.docker.com/reference/cli/docker/compose/exec/), [run](https://docs.docker.com/reference/cli/docker/compose/run/), [ps](https://docs.docker.com/reference/cli/docker/compose/ps/), [logs](https://docs.docker.com/reference/cli/docker/compose/logs/), [down](https://docs.docker.com/reference/cli/docker/compose/down/).
