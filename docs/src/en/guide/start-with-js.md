# Use OneBots from a Node.js project

OneBots runs as a standalone manager service and gateway process. Applications connect through a public protocol instead of constructing `App` or calling `createOnebots()`.

## Install and start the manager

Node.js 24 or later is required.

```bash
npm install --global onebots
onebots serve --data-dir ./onebots-data
```

On first use, issue a one-time pairing code on the machine that runs the manager:

```bash
onebots auth bootstrap --data-dir ./onebots-data
```

Open `http://127.0.0.1:6727` and enter the code. Later management requests use a revocable device session.

## Install extensions and configure an account

Use the Web console or TUI to create an installation plan. Select the platform adapters, output protocols, and framework extensions you need. The manager installs and verifies the complete dependency set before you explicitly activate the candidate runtime.

```bash
onebots ui --data-dir ./onebots-data
```

After activation, enter the platform account and protocol connection settings, validate and apply the configuration, then start the gateway. Stopping the gateway keeps the manager available.

```bash
onebots control start --data-dir ./onebots-data
onebots control status --data-dir ./onebots-data
```

Protocol credentials such as OneBot, Milky, or MCP `access_token` values protect protocol connections. They are not manager login credentials.

## Connect application code

Connect through HTTP, WebSocket, Webhook, reverse WebSocket, SSE, or the SDK for the selected protocol. For example, a OneBot v11 HTTP API URL has this shape:

```text
POST http://127.0.0.1:6727/{platform}/{account_id}/onebot/v11/{action}
```

The OneBots manager owns installation, upgrades, configuration, and process lifecycle. For local automation, use the control client from `@onebots/core/control` instead of embedding the retired management host in the application process.
