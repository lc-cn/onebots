# Quick start

::: warning Unreleased architecture
This guide describes `codex/service-architecture`. Do not update this branch with the current stable npm package or legacy installer. Native service migration and cold-start acceptance must pass before release.
:::

## Start from source

Use Node.js 24 and the repository's pinned pnpm version. From the architecture branch root:

```sh
pnpm install --frozen-lockfile
pnpm build
node packages/onebots/lib/bin.js serve --data-dir ./workspace
```

Keep that terminal running. An empty workspace needs no platform accounts, protocols or frameworks. In another terminal, obtain a pairing code:

```sh
node packages/onebots/lib/bin.js auth bootstrap --data-dir ./workspace
```

Open the management address (default `http://127.0.0.1:6727`) and enter the code. Management authentication uses pairing and sessions, not legacy username/password or a manually configured management token. See [login and recovery](/en/guide/management-login).

Select adapters, protocols and frameworks in the Web installation panel. Confirm the complete dependency list; private download authorization is used only for that installation, and required peers are installed and verified together. Activate the verified runtime separately, then configure accounts and protocol connections. Installing packages does not enable connections.

The same workflow is available in an interactive terminal:

```sh
node packages/onebots/lib/bin.js ui --data-dir ./workspace
```

The management service stays online when the gateway stops or fails. Inspect the original operation, repair configuration and explicitly start the gateway when ready.

## Bootstrap installation

The branch's `install.sh` handles first-time Linux/macOS bootstrap only: install the management program and matching Web assets, then delegate user service installation, startup and status checks to the CLI. It does not select a default protocol or print permanent credentials.

**The script downloads from public npm and requires a published package containing the new architecture.** Missing management artifacts cause a clear failure while preserving the candidate directory; the legacy CLI is not executed. The workflow uses packages built from source to exercise real system-level systemd and user-level launchd lifecycle, legacy migration, and manager crash recovery on GitHub-hosted Ubuntu and macOS runners. Only a passing platform job is acceptance evidence. This does not mean that the architecture has been published to npm.

Repeating a completed bootstrap does not upgrade packages or restart services. Legacy configuration, existing runtimes, and interrupted installations are preserved for explicit migration or recovery. Re-running the installer is not a manager update; use `onebots update --manager`. Gateway runtime updates use the manager workflow described in [Update the gateway and manager](/en/guide/runtime-update).

Windows now has an SCM host, named-pipe transport, access controls, and native lifecycle commands. The latest real Windows CI job is still failing, so final verification remains open. Until it passes, `install.ps1` exits before writing and production users should use Docker Desktop with a persistent `/data` volume as described in [Docker deployment](/en/guide/docker).

## System hosting

With an installed architecture CLI, use `onebots install --data-dir <workspace>` to install a user service, then `onebots start`. Existing legacy services require migration and are never overwritten by first-time installation.

The OS hosts the manager service; CLI, TUI, and Web control the separate gateway through one control API. Native systemd lifecycle, injected-failure rollback, and patch upgrade have passed real CI. Final launchd and Windows jobs remain under verification. Release decisions must use the actual result of each platform job; full machine reboot and recovery of real platform accounts still require deployment-environment acceptance.
