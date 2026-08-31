# Preparation

## System requirements

- **Node.js**: >= 24
- **pnpm**: >= 9.12.0; the repository pins and recommends 9.15.9
- **Operating system**: Windows, macOS, or Linux

OneBots uses runtime features provided by Node.js 24. The CLI checks the version before loading plugins or platform SDKs. An older runtime exits with the required version instead of failing later with a low-level module error.

## Install Node.js

Install Node.js 24 or newer from [nodejs.org](https://nodejs.org/) or through your version manager. The repository includes `.node-version` and `.nvmrc`; run `fnm use` or `nvm use` in a source checkout to select the recommended version.

Verify the installation:

```bash
node --version # Must be v24 or newer
npm --version
```

## Install pnpm

Use the version pinned by the repository for source development:

```bash
npm install --global pnpm@9.15.9
pnpm --version
```

pnpm is not required when you only install and run the published OneBots package globally with npm. See the [Quick Start](./start.md). After meeting the runtime requirement, run `onebots doctor` for configuration, plugin, permission, and service diagnostics if deployment checks still fail.

## Prepare platform accounts

Before connecting a real platform, create an application in its developer console and obtain the required credentials. Use the Mock adapter for the first installation check because it does not connect to an external platform. After the gateway is healthy, follow the [Platform Configuration](/en/config/platform) to add a real account.

## Next steps

- [Quick Start](./start.md)
- [Global Configuration](/en/config/global)
- [Client SDK](./client-sdk.md)
