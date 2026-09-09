# OneBots Windows host foundation

This directory contains the first independently testable slice of the native Windows host. It is not yet wired into the TypeScript installer or published packages.

The host owns exactly one manager process tree:

1. Windows SCM starts `onebots-windows-host service-run`.
2. The host creates a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`.
3. It creates the manager suspended, assigns it to the job, and only then resumes its primary thread.
4. SCM `STOP` and `SHUTDOWN` attach to the manager's private console, install an ignore handler in the host, send `CTRL_C` (Node's `SIGINT`), and retain that attachment and handler until the manager exits or the configured deadline expires. Only then does it detach and restore its handler. On timeout the host performs that cleanup before closing the job, terminating every remaining descendant.

`console-run` executes the same lifecycle outside SCM and exists for Windows acceptance tests. It is not a second production hosting mode.

## Local status pipe

The host status endpoint is a separate, local-only named pipe. It does not duplicate the OneBots manager HTTP control API.

- Default path: `\\.\pipe\onebots-manager-host-v1`
- Framing: one newline-terminated JSON document per connection
- Maximum request or response size: 64 KiB
- Protocol version: `1`
- Supported operation: `status`

Both sides require one JSON document followed by pipe EOF. Unknown fields, trailing documents, response ID mismatches, invalid states, and oversized payloads are rejected.

Request:

```json
{"version":1,"requestId":"doctor:1","operation":"status"}
```

Successful response:

```json
{"version":1,"requestId":"doctor:1","ok":true,"state":{"service":"running","manager":{"state":"running","pid":1234},"startedAt":"2026-09-09T00:00:00Z"}}
```

The pipe listener uses the pinned go-winio v0.6.2 implementation. That implementation creates an atomic first `FILE_CREATE` sentinel and passes `FILE_PIPE_REJECT_REMOTE_CLIENTS` to `NtCreateNamedPipeFile`; `go.sum` binds its source bytes. The host also rejects a duplicate first listener. Its protected DACL grants server-instance rights only to Local System and the service identity. A distinct installer-supplied `--control-sid` receives only data/attribute read-write and synchronization rights; it cannot create another pipe instance, change the DACL, or take ownership. Startup opens a real client handle, reads back the kernel object's security descriptor, and refuses to report the service running unless it matches.

Each accepted connection is limited to five seconds for all reads and writes, and at most 16 connections are processed concurrently. Before reading JSON, the server retrieves the named-pipe client PID, opens that exact process token, verifies its user SID, then re-reads the pipe PID to reject an identity change. The allowed identities are Local System, the service identity, and the configured control SID.

Windows acceptance tests additionally attempt to connect through `\\localhost\pipe\...` and require `ERROR_ACCESS_DENIED`. This behavioral test is the evidence for remote rejection: `GetNamedPipeInfo` does not expose the reject-remote creation option, so the host does not pretend that its type flags can prove it.

## Commands

```powershell
onebots-windows-host.exe service-run `
  --manager C:\OneBots\node.exe `
  --manager-arg C:\OneBots\manager\bin.js `
  --manager-arg serve `
  --manager-arg --data-dir `
  --manager-arg C:\ProgramData\OneBots `
  --working-dir C:\ProgramData\OneBots `
  --control-sid S-1-5-21-... `
  --stop-timeout 20s

onebots-windows-host.exe status
```

`service-run` deliberately refuses an interactive process; SCM must invoke it. Service installation, upgrade transactions, old-service migration, and TypeScript client integration remain outside this slice.
