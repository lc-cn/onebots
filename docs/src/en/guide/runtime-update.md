# Update the gateway and manager

::: warning Unreleased architecture branch
This workflow applies to `codex/service-architecture`, not master. Native Linux and macOS installations can update the gateway runtime and the persistent manager separately. Docker and HF deployments update by replacing the image while preserving the data volume.
:::

Keep the management service online and repair invalid configuration first. The gateway may remain stopped; activation preserves its desired state and does not enable accounts or protocols.

Run `onebots ui --data-dir <workspace>` and select the gateway runtime update action. Review package versions before confirming installation. Private package credentials are requested only after confirmation and used for that download. Activation requires a separate confirmation after verification.

In the Web installation panel, check for gateway updates and review current and target versions before confirming installation. Checks may take two minutes and do not install packages or switch the gateway. Apply the verified candidate separately; existing task tracking remains the recovery path.

The top-level `onebots update --check --data-dir <workspace>` checks gateway updates only, exiting 2 when updates exist or 0 otherwise. In an interactive terminal, `onebots update --data-dir <workspace>` uses the same confirmation flow. Gateway mode rejects legacy `--yes`, `--packages-only`, service-scope, and plugin-selection flags and does not modify the manager program.

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

## Update the manager program

Manager updates apply only to native Linux or macOS services already managed by OneBots. Check first without downloading or switching:

```sh
onebots update --manager --check
# system-wide service
sudo onebots update --manager --check --system
```

Without `--check`, an interactive terminal shows the current version, exact target version, and release archive summary before confirmation. Automation must provide both an exact version and `--yes`:

```sh
onebots update --manager --version <exact-version> --yes
```

The update uses a separate immutable candidate and never runs `npm install` in the current program directory. Keep the returned operation ID. If the result is unknown during candidate preparation, inspect and continue the same operation:

```sh
onebots update --manager --operation <original-operation-id> --version <exact-version>
```

If the operation already entered the system-service transaction, reconcile that same ID:

```sh
onebots recover --operation <original-operation-id>
```

Append `--system` for a system-wide service. Windows, Docker, and HF do not use this command.

If a response is lost, query the original operation instead of creating another. Configuration or runtime changes invalidate the confirmation; refresh and review a new plan. Older releases, missing catalogs, or inconsistent package versions are rejected without silently downgrading.

For an unknown manager-update result, preserve the operation ID and candidate directory. Use the original `--operation` or `recover` command above; do not reinstall or dispatch another system action.

Installed but disabled extensions remain in the update selection. Required peer entries show version ranges, not resolved versions; successful verification is required before activation.
