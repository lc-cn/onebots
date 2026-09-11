# OneBots

[OneBots](https://github.com/lc-cn/onebots) is a multi-platform, multi-protocol IM bot gateway. The container runs a persistent manager that controls a separate gateway process. Web management stays available when the gateway is stopped or its configuration is invalid.

## First use

1. Mount a host directory to **`/data`**. It stores configuration, device sessions, operation records, verified runtime generations, databases, and business data, and must survive container replacement.
2. An empty volume starts the manager without preselecting platforms, accounts, protocols, or frameworks. Issue a one-time pairing code from the host:

   ```sh
   docker exec --user 1000:1000 onebots \
     node /app/packages/onebots/lib/bin.js auth bootstrap --data-dir /data
   ```

3. Open the address mapped to container port **6727** and enter the code within five minutes. Manager login uses device sessions, not the legacy username/password or a management `access_token` in configuration.
4. In Web or TUI, select adapters, output protocols, and frameworks. Review the dependency plan, install and verify it, then explicitly activate the runtime generation. Configure accounts and protocol connections before starting the gateway.

Web, TUI, and CLI use the same manager control API. Installing dependencies does not enable a platform or protocol, and stopping the gateway does not stop the manager. Do not add legacy `-r/-p/-t` arguments to the container command, run a package manager in the active runtime, or mount the Docker socket.

## Image

Use **`ghcr.io/lc-cn/onebots:<version>`** with a tag actually published by CI. The version directory in this 1Panel definition does not prove that the new architecture is available under that image tag.

## Docs

[Docker guide](../../../docs/src/en/guide/docker.md) and [quick start](../../../docs/src/en/guide/start.md) in this repository.
