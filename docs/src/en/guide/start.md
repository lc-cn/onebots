# Quick start

::: tip Version boundary
This guide requires a OneBots version with workspace admission support. Existing control v1 services need the [offline upgrade procedure](/guide/workspace-admission); earlier monolithic deployments cannot directly run strict-version `onebots migrate`. Do not mix legacy entrypoints or installers with the new runtime.
:::

## Start from source (Linux/macOS)

Use Node.js 24 and the repository's pinned pnpm version. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
umask 077
mkdir -m 700 ./workspace ./workspace-authority
node packages/onebots/lib/bin.js workspace plan --data-dir ./workspace \
  --authority-dir ./workspace-authority > workspace-plan.json
# Read the plan and its session-revocation impact; substitute the actual digest.
node packages/onebots/lib/bin.js workspace register \
  --plan-file workspace-plan.json --confirm '<plan.digest>'
node packages/onebots/lib/bin.js serve --data-dir ./workspace \
  --authority-dir ./workspace-authority
```

Use new, empty directories for this example. Keep the plan outside `workspace/`; persist the authority separately and reuse it on restart without copying it with the business backup. Registration does not start the manager or gateway. An unregistered manager only serves a read-only maintenance page and cannot pair devices.

Keep the last command running. An empty workspace needs no accounts, protocols or frameworks. In another terminal, obtain a pairing code:

```sh
node packages/onebots/lib/bin.js auth bootstrap --data-dir ./workspace
```

Open the management address (default `http://127.0.0.1:6727`) and enter the code. Management authentication uses pairing and sessions, not legacy username/password or a manually configured management token. See [login and recovery](/en/guide/management-login).

On Windows, builds use Node.js for cleanup and do not require Git Bash. Use the **elevated installer below** for a new deployment: it prepares private ACLs, installs the SCM service and prints offline registration steps. Do not copy the POSIX directory commands. Foreground `serve` does not expose the protected SCM management pipe, and a deployment pairing code does not replace source registration or authorize takeover. Existing native installations without complete shutdown evidence cannot register directly; see the [Windows boundary](/guide/workspace-admission#windows-与证明边界).

Select adapters, protocols and frameworks in **Extensions**. Confirm the complete dependency list; private download authorization is used only for that installation, and required peers are installed and verified together. Apply the verified runtime separately. Then add and save an account in **Accounts**, and add and save its outlet in **Protocols**. Complete platform login challenges in **Tasks**. Installing packages does not enable connections.

Management pages use paths under `/console`, such as `/console/accounts` and `/console/protocols`, and support direct access, refresh and bookmarks. Protocol APIs keep their account-specific addresses outside `/console`.

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

`install.sh` installs the public manager and matching Web assets, verifies workspace admission capability, installs the user service and confirms that it remains stopped. It then prints the plan, explicit registration, startup and pairing commands for you to review and execute. It does not confirm registration for you or generate accounts or permanent credentials. `install.ps1` additionally verifies the bundled native SCM host and installs a system service. Sources are in `docs/src/public`.

The installer downloads the published npm package; it does **not** install unpublished changes in your local checkout.

**Public npm must contain a version with workspace admission support.** Missing artifacts or capabilities cause a clear failure while preserving the candidate; there is no fallback to the legacy CLI. CI uses source-built packages to test native systemd, launchd and manager recovery. Only a passing job is platform evidence for that version, and it does not prove npm publication.

Repeating a completed bootstrap does not upgrade packages or restart services. Legacy configuration, existing runtimes, and interrupted installations are preserved for explicit migration or recovery. Re-running the installer is not a manager update; use `onebots update --manager`. Gateway runtime updates use the manager workflow described in [Update the gateway and manager](/en/guide/runtime-update).

The Windows SCM host, named-pipe transport, access controls, bootstrap installer, and service lifecycle are covered by Windows CI. Run `install.ps1` from an elevated PowerShell. It accepts only an empty installation directory, isolates the public package download, verifies manager, gateway, Web, and native-host artifacts, and only then delegates system-service installation to the unified CLI. Failure preserves the candidate evidence without automatic rollback or redispatch.

## System hosting

For a new Linux/macOS user service, keep the workspace, authority and plan file separate:

```sh
onebots install --data-dir "$HOME/onebots-data" --authority-dir "$HOME/onebots-authority"
# The service stays stopped. Review the plan and substitute its actual digest.
onebots workspace plan --data-dir "$HOME/onebots-data" \
  --authority-dir "$HOME/onebots-authority" > "$HOME/onebots-plan.json"
onebots workspace register --plan-file "$HOME/onebots-plan.json" --confirm '<plan.digest>'
onebots start
onebots auth bootstrap --data-dir "$HOME/onebots-data"
```

To host an already registered foreground workspace, stop it normally first, then run `install` and `start` with the same data and authority directories; do not register again. Changing the authority is not a program update. Do not overwrite an old service definition; follow the [offline upgrade and recovery boundaries](/guide/workspace-admission).

The OS hosts the manager; CLI, TUI and Web control the gateway through one API. Platform lifecycle, rollback and upgrade support require the corresponding version's CI and deployment evidence. Source implementation does not prove Windows, full-machine reboot or real-account recovery acceptance. Ordinary data-volume copy protection is not cross-host HA or global exclusion between machine clones.
