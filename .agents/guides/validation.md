# Validation

This guide owns common validation evidence and the Compose check sequence. Domain-specific checks remain in their workflows; command semantics and container identity remain in [container usage](container-usage.md).

## Shared validation rules

- Discover required commands/procedures and expected outcomes from relevant READMEs/configuration and the assignment brief. Run checks appropriate to the changed behavior and required review; use [coding standards](coding-standards.md#validation-and-completion) to decide code-test coverage.
- Check the actual returned artifact/revision. Capture command/procedure, exit status where applicable, tested revision, and decisive evidence/log locator using the [result schema](../templates/subagent-result.md). Non-code review must also identify the artifact checked.
- Distinguish passed, failed, and unrun checks. Inaccessible inputs, unavailable checks, stale evidence, or insufficient coverage are unverified, not passed. Retain acceptance criteria; route changes to scope through the manager rather than weakening a check to obtain success.
- Validate the integrated result; isolated passing branches/workstreams cannot establish their combination passes. Rerun affected checks after relevant input/output changes, and do not repeat unaffected passing checks without a reason. Earlier approval does not approve later revisions.
- Report material limitations and unresolved failures; do not claim completion from evidence that does not establish the required behavior. Functional acceptance needs observed behavior; visual/research methods are owned by their specialist workflows.

## Readiness

- Wait for the project's documented readiness condition before dependent checks. Compose `up --wait` waits for running/healthy services; health depends on a configured healthcheck and does not by itself prove the application-level condition a check needs.
- If healthchecks do not represent required readiness, use the documented application probe or relevant logs. Preserve diagnostic evidence under the shared rules above.

## Compose validation sequence

1. Complete [Compose discovery](container-usage.md#discovery-and-project-identity) and resolve the services/configuration required by the checks. Prefer a documented project wrapper when available.
2. Inspect current state under [lifecycle commands](container-usage.md#lifecycle-commands).
3. Start/update only required services and dependencies under that lifecycle procedure, incorporating changed build inputs where needed.
4. Confirm [readiness](#readiness).
5. Choose existing-service or one-off execution under [check execution](container-usage.md#check-execution). Apply its isolation rules before parallel checks.
6. Capture outcomes under [shared validation rules](#shared-validation-rules); on failure, use the container guide's status/log diagnostics and [configuration-output handling](environment-configuration.md#configuration-output).
7. Clean up only authorized task-created resources under [container cleanup](container-usage.md#cleanup).

Readiness reference: [Docker startup order](https://docs.docker.com/compose/how-tos/startup-order/).
