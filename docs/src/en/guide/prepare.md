# Preparation

Before starting with onebots, make sure you have the following prerequisites ready.

## System Requirements

- **Node.js**: >= 22.0.0
- **Package Manager**: pnpm (recommended), npm, or yarn
- **Operating System**: Windows, macOS, or Linux

## Installation

### Install Node.js

Download and install Node.js from [nodejs.org](https://nodejs.org/).

Verify installation:

```bash
node --version  # Should be >= 22.0.0
npm --version
```

### Install pnpm (Recommended)

```bash
npm install -g pnpm
```

Or using other methods:

```bash
# Using Homebrew (macOS)
brew install pnpm

# Using curl
curl -fsSL https://get.pnpm.io/install.sh | sh -
```

## Platform Account Preparation

Before using onebots, you need to prepare accounts for the platforms you want to use:

### WeChat Official Account
- Register at [WeChat Official Platform](https://mp.weixin.qq.com/)
- Get AppID and AppSecret
- Configure server URL and Token

### QQ Official Bot
- Register at [QQ Bot Platform](https://bot.q.qq.com/)
- Get AppID and AppSecret
- Configure WebSocket or Webhook

### Other Platforms
- Refer to respective platform documentation for account setup
- See [Platform Documentation](/en/platform/wechat) for details

## Next Steps

- 📖 Read [Quick Start](/en/guide/start) to deploy your first bot
- 🔧 Check [Configuration Guide](/en/config/global) for configuration details
- 💻 Learn about [Client SDK](/en/guide/client-sdk) for client-side development

