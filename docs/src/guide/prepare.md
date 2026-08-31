# 准备工作

## 环境要求

- **Node.js**：>= 24
- **pnpm**：>= 9.12.0；仓库锁定并推荐使用 9.15.9
- **操作系统**：Windows、macOS 或 Linux

OneBots 使用 Node.js 24 提供的运行时能力。CLI 会在加载插件与平台 SDK 前检查版本；旧版本会直接退出并显示所需版本，避免安装完成后才出现底层模块错误。

## 安装 Node.js

从 [Node.js 官网](https://nodejs.org/) 或你使用的版本管理器安装 Node.js 24 或更高版本。仓库提供 `.node-version` 与 `.nvmrc`，在源码目录可执行 `fnm use` 或 `nvm use` 切换到推荐版本。

验证安装结果：

```bash
node --version # 应为 v24 或更高版本
npm --version
```

## 安装 pnpm

从源码开发时推荐使用仓库锁定的版本：

```bash
npm install --global pnpm@9.15.9
pnpm --version
```

仅通过 npm 全局安装并运行 OneBots 时不要求 pnpm，参见[快速开始](./start.md)。满足运行时版本要求后，若部署检查仍失败，可执行 `onebots doctor` 获取配置、插件、权限与服务状态诊断。

## 准备平台账号

接入真实平台前，请先在对应开放平台申请应用并取得所需凭据。首次验证安装建议使用 Mock 适配器，它不会连接外部平台；确认网关运行正常后，再按照[平台配置](/config/platform)添加真实账号。

## 下一步

- [快速开始](./start.md)
- [全局配置](/config/global)
- [客户端 SDK](./client-sdk.md)
