<div align="center">
    <h1>使用 TypeScript 实现的 OneBot 应用启动器</h1>
    <p>支持 ICQQ、QQ 官方机器人、微信以及钉钉机器人的现代化全面解决方案</p>
    <p>

[![CI](https://github.com/lc-cn/onebots/actions/workflows/ci.yml/badge.svg)](https://github.com/lc-cn/onebots/actions/workflows/ci.yml)
[![Build Package](https://github.com/icqqjs/onebots/actions/workflows/release.yml/badge.svg?branch=master&event=push)](https://github.com/icqqjs/onebots/actions/workflows/release.yml) 
[![Build Docs](https://github.com/lc-cn/onebots/actions/workflows/build_deploy_docs.yml/badge.svg)](https://github.com/lc-cn/onebots/actions/workflows/build_deploy_docs.yml)

[![npm](https://img.shields.io/npm/v/onebots)](https://www.npmjs.com/package/onebots) 
[![dm](https://shields.io/npm/dm/onebots)](https://www.npmjs.com/package/onebots) 
[![License](https://img.shields.io/github/license/lc-cn/onebots)](https://github.com/lc-cn/onebots/blob/master/LICENSE)
[![node engine](https://img.shields.io/node/v/onebots?color=339933&style=flat-square&labelColor=FAFAFA&logo=Node.js)](https://nodejs.org)

[![oneBot V11](https://img.shields.io/badge/OneBot-11-black?logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHAAAABwCAMAAADxPgR5AAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAAxQTFRF////29vbr6+vAAAAk1hCcwAAAAR0Uk5T////AEAqqfQAAAKcSURBVHja7NrbctswDATQXfD//zlpO7FlmwAWIOnOtNaTM5JwDMa8E+PNFz7g3waJ24fviyDPgfhz8fHP39cBcBL9KoJbQUxjA2iYqHL3FAnvzhL4GtVNUcoSZe6eSHizBcK5LL7dBr2AUZlev1ARRHCljzRALIEog6H3U6bCIyqIZdAT0eBuJYaGiJaHSjmkYIZd+qSGWAQnIaz2OArVnX6vrItQvbhZJtVGB5qX9wKqCMkb9W7aexfCO/rwQRBzsDIsYx4AOz0nhAtWu7bqkEQBO0Pr+Ftjt5fFCUEbm0Sbgdu8WSgJ5NgH2iu46R/o1UcBXJsFusWF/QUaz3RwJMEgngfaGGdSxJkE/Yg4lOBryBiMwvAhZrVMUUvwqU7F05b5WLaUIN4M4hRocQQRnEedgsn7TZB3UCpRrIJwQfqvGwsg18EnI2uSVNC8t+0QmMXogvbPg/xk+Mnw/6kW/rraUlvqgmFreAA09xW5t0AFlHrQZ3CsgvZm0FbHNKyBmheBKIF2cCA8A600aHPmFtRB1XvMsJAiza7LpPog0UJwccKdzw8rdf8MyN2ePYF896LC5hTzdZqxb6VNXInaupARLDNBWgI8spq4T0Qb5H4vWfPmHo8OyB1ito+AysNNz0oglj1U955sjUN9d41LnrX2D/u7eRwxyOaOpfyevCWbTgDEoilsOnu7zsKhjRCsnD/QzhdkYLBLXjiK4f3UWmcx2M7PO21CKVTH84638NTplt6JIQH0ZwCNuiWAfvuLhdrcOYPVO9eW3A67l7hZtgaY9GZo9AFc6cryjoeFBIWeU+npnk/nLE0OxCHL1eQsc1IciehjpJv5mqCsjeopaH6r15/MrxNnVhu7tmcslay2gO2Z1QfcfX0JMACG41/u0RrI9QAAAABJRU5ErkJggg==)](https://onebot.dev/)
[![oneBot V12](https://img.shields.io/badge/OneBot-12-black?logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHAAAABwCAMAAADxPgR5AAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAAxQTFRF////29vbr6+vAAAAk1hCcwAAAAR0Uk5T////AEAqqfQAAAKcSURBVHja7NrbctswDATQXfD//zlpO7FlmwAWIOnOtNaTM5JwDMa8E+PNFz7g3waJ24fviyDPgfhz8fHP39cBcBL9KoJbQUxjA2iYqHL3FAnvzhL4GtVNUcoSZe6eSHizBcK5LL7dBr2AUZlev1ARRHCljzRALIEog6H3U6bCIyqIZdAT0eBuJYaGiJaHSjmkYIZd+qSGWAQnIaz2OArVnX6vrItQvbhZJtVGB5qX9wKqCMkb9W7aexfCO/rwQRBzsDIsYx4AOz0nhAtWu7bqkEQBO0Pr+Ftjt5fFCUEbm0Sbgdu8WSgJ5NgH2iu46R/o1UcBXJsFusWF/QUaz3RwJMEgngfaGGdSxJkE/Yg4lOBryBiMwvAhZrVMUUvwqU7F05b5WLaUIN4M4hRocQQRnEedgsn7TZB3UCpRrIJwQfqvGwsg18EnI2uSVNC8t+0QmMXogvbPg/xk+Mnw/6kW/rraUlvqgmFreAA09xW5t0AFlHrQZ3CsgvZm0FbHNKyBmheBKIF2cCA8A600aHPmFtRB1XvMsJAiza7LpPog0UJwccKdzw8rdf8MyN2ePYF896LC5hTzdZqxb6VNXInaupARLDNBWgI8spq4T0Qb5H4vWfPmHo8OyB1ito+AysNNz0oglj1U955sjUN9d41LnrX2D/u7eRwxyOaOpfyevCWbTgDEoilsOnu7zsKhjRCsnD/QzhdkYLBLXjiK4f3UWmcx2M7PO21CKVTH84638NTplt6JIQH0ZwCNuiWAfvuLhdrcOYPVO9eW3A67l7hZtgaY9GZo9AFc6cryjoeFBIWeU+npnk/nLE0OxCHL1eQsc1IciehjpJv5mqCsjeopaH6r15/MrxNnVhu7tmcslay2gO2Z1QfcfX0JMACG41/u0RrI9QAAAABJRU5ErkJggg==)](https://12.onebot.dev/)
[![qq group](https://img.shields.io/badge/group-860669870-blue?style=flat-square&labelColor=FAFAFA&logo=data:image/png;base64,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&logoCode=000000)](https://jq.qq.com/?_wv=1027&k=B22VGXov)

[📖 文档](https://docs.onebots.org) | [🚀 快速开始](#快速开始) | [💬 社区讨论](https://github.com/lc-cn/onebots/discussions)

</p>
</div>

## ✨ 特性

- 🎯 **多平台支持** - ICQQ、QQ 官方、微信、钉钉机器人
- 📦 **现代化架构** - TypeScript 5.7+ 编写，完整类型支持
- 🔌 **双协议兼容** - 同时支持 OneBot V11 和 V12
- 🛡️ **安全可靠** - 定期安全审计和依赖更新
- 📊 **完善监控** - 内置日志和健康检查
- 🎨 **Web 管理** - 可视化配置和管理界面
- ⚡ **高性能** - 优化的事件处理和资源管理
- 🔧 **易于扩展** - 清晰的插件架构

## 📋 环境要求

- **Node.js** >= 18.0.0
- **npm** >= 9.0.0

## 🚀 快速开始

### 方式一：局部安装（推荐）

#### 1. 初始化 Node.js 项目

```bash
npm init -y
```

#### 2. 安装 OneBots 和适配器依赖

```bash
# 安装核心包
npm install onebots

# 根据需要安装对应的适配器（可选）
npm install @icqqjs/icqq        # ICQQ 适配器
npm install web-wechat          # 微信适配器
npm install qq-official-bot     # QQ 官方机器人适配器
npm install node-dd-bot         # 钉钉机器人适配器
```

<details>
<summary>📦 关于 @icqqjs/icqq 的安装说明</summary>

1. 在项目根目录创建 `.npmrc` 文件并添加：
   ```text
   @icqqjs:registry=https://npm.pkg.github.com
   ```

2. 登录 GitHub Package Registry：
   ```bash
   npm login --scope=@icqqjs --auth-type=legacy --registry=https://npm.pkg.github.com
   ```
   
   根据提示输入：
   - **Username**: 你的 GitHub 账号
   - **Password**: GitHub Personal Access Token（[创建 Token](https://github.com/settings/tokens/new)，勾选 `read:packages` 权限）
   - **E-Mail**: 你的公开邮箱

3. 安装依赖：
   ```bash
   npm install @icqqjs/icqq
   ```
</details>

#### 3. 生成配置文件并启动

```bash
# 注册适配器并生成配置
npx onebots -r icqq      # 使用 ICQQ
npx onebots -r wechat    # 使用微信
npx onebots -r qq        # 使用 QQ 官方
npx onebots -r dingtalk  # 使用钉钉

# 可以同时注册多个适配器
npx onebots -r icqq -r wechat -r qq -r dingtalk
```

#### 4. 配置并启动

编辑生成的 `config.yaml` 配置文件，然后重新运行上述命令启动服务。

### 方式二：全局安装（不推荐，v0.4.8 后已弃用）

```bash
# 全局安装
npm install -g onebots

# 在配置目录运行
onebots
```

## 📖 文档

完整文档请访问：[https://docs.onebots.org](https://docs.onebots.org)

### 主要章节

- [快速开始](https://docs.onebots.org/guide/start.html)
- [适配器配置](https://docs.onebots.org/guide/adapter.html)
- [OneBot V11 API](https://docs.onebots.org/v12/)
- [OneBot V12 API](https://docs.onebots.org/v12/)

## 🔧 开发

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 类型检查
npm run type-check

# 代码检查
npm run lint

# 自动修复
npm run lint:fix

# 构建
npm run build
```

## 🤝 贡献

欢迎贡献！请查看 [贡献指南](CONTRIBUTING.md)。

参与贡献前请阅读：
- [行为准则](CODE_OF_CONDUCT.md)
- [安全政策](SECURITY.md)

## 📄 许可证

[MIT](LICENSE) © 凉菜

## 🌟 致谢

- [icqqjs/icqq](https://github.com/icqqjs/icqq) - 底层服务支持
- [takayama-lily/onebot](https://github.com/takayama-lily/node-onebot) - OneBot V11 原始实现

---

<div align="center">
  <sub>使用 ❤️ 构建 | 由社区驱动</sub>
</div>

# 鸣谢

1. [icqqjs/icqq](https://github.com/icqqjs/icqq) 底层服务支持
2. [takayama-lily/onebot](https://github.com/takayama-lily/node-onebot) oneBot V11 原先版本
