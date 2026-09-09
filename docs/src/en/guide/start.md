# Quick start

::: warning Unreleased architecture
This guide describes `codex/service-architecture`. Do not update this branch with the current stable npm package or legacy installer. Management binary upgrades, migration work and native platform acceptance remain unfinished; the branch is not released to master.
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

**The script downloads from public npm and requires a published package containing the new architecture.** Missing management artifacts cause a clear failure while preserving the candidate directory; the legacy CLI is not executed. Packages built from the current source now pass real system-level systemd and user-level launchd lifecycle acceptance on GitHub-hosted Ubuntu and macOS runners. This does not mean that the new architecture has already been published to npm.

Repeating a completed bootstrap does not upgrade packages or restart services. Legacy configuration, existing runtimes or interrupted installations are preserved for explicit migration or recovery. Re-running the installer is not a management binary upgrade. [Gateway updates](/en/guide/runtime-update) use the management service instead.

Windows native hosting is not yet verified. The PowerShell entry exits before making changes. Use Docker Desktop and persist `/data` as described in [Docker deployment](/en/guide/docker).

## System hosting

With an installed architecture CLI, use `onebots install --data-dir <workspace>` to install a user service, then `onebots start`. Existing legacy services require migration and are never overwritten by first-time installation.

The OS hosts the management service; TUI/Web lifecycle actions control the separate gateway. CI now verifies install, start, status, restart, stop and uninstall from packed artifacts, including management availability, blank configuration, process replacement and preservation of workspace data. Machine reboot, interrupted legacy migration recovery and native management-program upgrades still require separate platform acceptance.
