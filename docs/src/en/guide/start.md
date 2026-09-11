# Quick start

::: tip Version boundary
This guide applies to OneBots versions that include the persistent manager. Migrate legacy installations first; do not combine legacy entrypoints or installers with the new managed runtime.
:::

## Start from source

Use Node.js 24 and the repository's pinned pnpm version. From the repository root:

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

Download the scripts directly from this site: [Linux/macOS installer](/install.sh) · [Windows installer](/install.ps1). No repository clone is needed.

Linux/macOS, from a regular user terminal:

```sh
curl -fsSL https://onebots.pages.dev/install.sh -o install.sh && sh install.sh
```

Windows, download from an **elevated PowerShell** and run only after the download succeeds:

```powershell
Invoke-WebRequest https://onebots.pages.dev/install.ps1 -OutFile install.ps1 -ErrorAction Stop
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

You can inspect the downloaded script before executing it. `Bypass` applies only to this PowerShell process, without changing the system execution policy. Installers default to `.onebots` in your user directory; use the upgrade or migration workflow for existing installations.

`install.sh` handles first-time Linux/macOS bootstrap: it installs the manager and matching Web assets, then delegates user-service installation, startup and status checks to the CLI. It does not select a default protocol or print permanent credentials. Windows uses `install.ps1` with the same boundary and additionally verifies the bundled native SCM host.

**The script downloads from public npm and requires a published package containing the new architecture.** Missing management artifacts cause a clear failure while preserving the candidate directory; the legacy CLI is not executed. The workflow uses packages built from source to exercise real system-level systemd and user-level launchd lifecycle, legacy migration, and manager crash recovery on GitHub-hosted Ubuntu and macOS runners. Only a passing platform job is acceptance evidence. This does not mean that the architecture has been published to npm.

Repeating a completed bootstrap does not upgrade packages or restart services. Legacy configuration, existing runtimes, and interrupted installations are preserved for explicit migration or recovery. Re-running the installer is not a manager update; use `onebots update --manager`. Gateway runtime updates use the manager workflow described in [Update the gateway and manager](/en/guide/runtime-update).

The Windows SCM host, named-pipe transport, access controls, bootstrap installer, and service lifecycle are covered by Windows CI. Run `install.ps1` from an elevated PowerShell. It accepts only an empty installation directory, isolates the public package download, verifies manager, gateway, Web, and native-host artifacts, and only then delegates system-service installation to the unified CLI. Failure preserves the candidate evidence without automatic rollback or redispatch.

## System hosting

With an installed architecture CLI, use `onebots install --data-dir <workspace>` to install a user service, then `onebots start`. Existing legacy services require migration and are never overwritten by first-time installation.

The OS hosts the manager service; CLI, TUI, and Web control the separate gateway through one control API. Native systemd, launchd, and Windows SCM lifecycle, legacy migration, injected-failure rollback, and patch upgrade have passed their platform CI jobs. Full machine reboot and recovery of real platform accounts still require deployment-environment acceptance.
