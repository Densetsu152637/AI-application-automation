# Environment configuration and secrets

This guide owns environment wiring, sensitive configuration output, and secret handling. Load [Compose discovery and project identity](container-usage.md#discovery-and-project-identity) before inspecting or changing container configuration.

## Environment wiring

- Discover required variables and supported configuration from the consuming project's documentation and files. Do not invent variable names or create runtime configuration as generic setup guidance.
- Compose shell variables and `.env`/`--env-file` values can interpolate the model. They do not automatically enter a container: the service must wire them through `environment`, `env_file`, or another configured mechanism.
- Service-level `env_file` and CLI `--env-file` have different roles. Inspect the project's intended wiring before choosing or changing either.

## Configuration output

`docker compose config` may contain resolved credentials. Treat interpolated output as sensitive and avoid copying sensitive values into logs, chat, or committed files.

## Secret handling

- Keep credentials out of source control, command examples, shell history, logs, and generated artifacts. Use the project's supported local secret mechanism, ignored env file, or managed secret store. Verify ignore rules before creating a local credentials file; never replace a user-owned secret file.
- Commit only deliberately sanitized examples with placeholders when the project expects them. Use least-privilege access and the supported secret mechanism.
- Compose secrets are mounted files distinct from ordinary environment variables. Inspect their source/availability; do not assume local Compose secrets have the protection properties of an external production secret manager.

References: [Compose environment variables](https://docs.docker.com/compose/how-tos/environment-variables/), [interpolation](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/), [Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/), [Docker Engine secrets](https://docs.docker.com/engine/swarm/secrets/).
