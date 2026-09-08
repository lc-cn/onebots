# Update the gateway runtime

::: warning Unreleased architecture branch
This workflow applies to `codex/service-architecture`, not master. It updates the gateway and its extensions, not the permanent management service or CLI binary. Docker image updates still require replacing the image while preserving the data volume.
:::

Keep the management service online and repair invalid configuration first. The gateway may remain stopped; activation preserves its desired state and does not enable accounts or protocols.

Run `onebots ui --data-dir <workspace>` and select the gateway runtime update action. Review package versions before confirming installation. Private package credentials are requested only after confirmation and used for that download. Activation requires a separate confirmation after verification.

In the Web installation panel, check for gateway updates and review current and target versions before confirming installation. Checks may take two minutes and do not install packages or switch the gateway. Apply the verified candidate separately; existing task tracking remains the recovery path.

The top-level `onebots update --check --data-dir <workspace>` checks gateway updates only, exiting 2 when updates exist or 0 otherwise. In an interactive terminal, `onebots update --data-dir <workspace>` uses the same confirmation flow. Legacy `--yes`, `--packages-only`, service scope and plugin selection flags are rejected; this command no longer mutates installed program packages or restarts the OS service. Management binary upgrades remain unfinished.

For scripts, obtain a plan first:

```sh
onebots control plan-update --data-dir <workspace>
```

`current` requires no installation. For `updates_available`, review the comparison and use the returned installation plan:

```sh
onebots control install --data-dir <workspace> --plan <installationPlan.id> --request <unique-operation-id>
onebots control installation --data-dir <workspace> --request <same-operation-id>
```

Supply private download credentials through a secure pipe with `--auth-stdin`, never command arguments or configuration. Only after the operation reaches `verified`, explicitly activate its candidate:

```sh
onebots control activate --data-dir <workspace> --generation <candidateId>
```

If a response is lost, query the original operation instead of creating another. Configuration or runtime changes invalidate the confirmation; refresh and review a new plan. Older releases, missing catalogs, or inconsistent package versions are rejected without silently downgrading.

Installed but disabled extensions remain in the update selection. Required peer entries show version ranges, not resolved versions; successful verification is required before activation.
