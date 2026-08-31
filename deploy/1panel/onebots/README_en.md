# OneBots

[OneBots](https://github.com/lc-cn/onebots) is a **TypeScript / Node.js** framework and gateway for multi-platform, multi-protocol instant-messaging bots. It bridges QQ, WeChat, Discord, Telegram, Feishu, WeCom and more to **OneBot v11/v12, Satori, Milky**, etc.

## Usage

- **Data directory**: Mount a host path to **`/data`** in the container (`config.yaml`, SQLite, etc.).
- **First run**: If `/data/config.yaml` is missing, the image copies a sample file; edit it and restart.
- **Web UI**: Default port **`6727`** — map it in 1Panel (exact paths depend on enabled protocols).

## Image

Default: **`ghcr.io/lc-cn/onebots:<version>`**. Use your CI tag (e.g. `master`) if a semver tag is not published yet.

## Docs

[Docker guide](../../../docs/src/guide/docker.md) in this repository.
