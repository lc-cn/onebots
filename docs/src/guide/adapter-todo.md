# 适配器开发计划

本文档列出了 onebots 项目计划接入的 IM 平台适配器。

## 已实现的适配器

| 平台 | 状态 | 包名 | 说明 |
|------|------|------|------|
| **QQ官方机器人** | ✅ 已实现 | `@onebots/adapter-qq` | 支持QQ频道、群聊、私聊 |
| **ICQQ** | ✅ 已实现 | `@onebots/adapter-icqq` | 支持QQ非官方协议，功能更完整 |
| **Kook** | ✅ 已实现 | `@onebots/adapter-kook` | 支持频道、私聊、服务器管理 |
| **微信** | ✅ 已实现 | `@onebots/adapter-wechat` | 支持微信公众号 |
| **微信 ClawBot (iLink)** | ✅ 已实现 | `@onebots/adapter-wechat-clawbot` | 微信 iLink Bot HTTP |
| **Discord** | ✅ 已实现 | `@onebots/adapter-discord` | 支持Discord机器人 |
| **Telegram** | ✅ 已实现 | `@onebots/adapter-telegram` | 支持私聊、群组、频道 |
| **飞书** | ✅ 已实现 | `@onebots/adapter-feishu` | 支持单聊、群聊、富文本消息 |
| **钉钉** | ✅ 已实现 | `@onebots/adapter-dingtalk` | 支持企业内部应用和自定义机器人 |
| **Slack** | ✅ 已实现 | `@onebots/adapter-slack` | 支持频道消息、私聊、应用命令 |
| **企业微信** | ✅ 已实现 | `@onebots/adapter-wecom` | 支持应用消息推送、通讯录同步 |
| **Microsoft Teams** | ✅ 已实现 | `@onebots/adapter-teams` | 支持频道消息、私聊、自适应卡片 |
| **Line** | ✅ 已实现 | `@onebots/adapter-line` | 支持Line机器人消息和事件 |
| **Email** | ✅ 已实现 | `@onebots/adapter-email` | 支持SMTP发送和IMAP接收邮件 |
| **WhatsApp** | ✅ 已实现 | `@onebots/adapter-whatsapp` | 支持WhatsApp Business API |
| **Zulip** | ✅ 已实现 | `@onebots/adapter-zulip` | 支持Zulip流和私信 |

## 计划中的适配器

### 高优先级

> 所有高优先级适配器已完成实现，详见上方"已实现的适配器"列表。

---

### 中优先级

#### 4. 企业微信适配器

**状态**: 待开发  
**优先级**: 中  
**预计包名**: `@onebots/adapter-wecom`

**功能规划**:
- ✅ 应用机器人
  - 企业应用消息推送
  - 群聊机器人
  - 客户联系机器人
- ✅ 消息类型
  - 文本、图片、视频
  - 文件、链接卡片
  - Markdown 消息
- ✅ 通讯录同步
  - 部门信息
  - 成员信息
  - 客户信息

**参考资源**:
- [企业微信开放平台](https://developer.work.weixin.qq.com/)
- [企业微信应用开发文档](https://developer.work.weixin.qq.com/document/path/90488)

---

#### 5. Slack 适配器

**状态**: 待开发  
**优先级**: 中  
**预计包名**: `@onebots/adapter-slack`

**功能规划**:
- ✅ Bot API 支持
  - 频道消息
  - 私聊（DM）
  - 应用命令（Slash Commands）
- ✅ 交互式组件
  - 按钮交互
  - 选择菜单
  - 模态对话框
- ✅ 事件订阅
  - 消息事件
  - 用户事件
  - 频道事件

**参考资源**:
- [Slack API](https://api.slack.com/)
- [Slack Bot 开发文档](https://api.slack.com/bot-users)

---

#### 6. ICQQ 适配器

**状态**: 待开发  
**优先级**: 中  
**预计包名**: `@onebots/adapter-icqq`

**功能规划**:
- ✅ ICQQ 协议支持
  - 通过 ICQQ 协议连接 QQ（非官方 API）
  - 提供更完整的 QQ 功能
- ✅ 功能支持
  - 好友列表管理
  - 群组管理
  - 消息收发
  - 文件传输

**参考资源**:
- [ICQQ 项目](https://github.com/icqqjs/icqq)
- ICQQ 协议文档

---

### 低优先级

#### 7. Microsoft Teams 适配器

**状态**: 待开发  
**优先级**: 低  
**预计包名**: `@onebots/adapter-teams`

**功能规划**:
- ✅ Bot Framework 支持
  - 频道消息
  - 私聊
  - 自适应卡片
- ✅ 活动类型
  - 消息活动
  - 通知活动
  - 调用活动

**参考资源**:
- [Microsoft Bot Framework](https://dev.botframework.com/)
- [Teams Bot 开发文档](https://docs.microsoft.com/en-us/microsoftteams/platform/bots/what-are-bots)

---

#### 8. Matrix 适配器

**状态**: 待开发  
**优先级**: 低  
**预计包名**: `@onebots/adapter-matrix`

**功能规划**:
- ✅ Matrix 协议支持
  - 房间消息
  - 端到端加密
  - 跨平台通信
- ✅ 功能支持
  - 消息收发
  - 房间管理
  - 用户管理

**参考资源**:
- [Matrix 协议](https://matrix.org/docs/spec/)
- [Matrix Client-Server API](https://spec.matrix.org/latest/client-server-api/)

---

## 开发优先级说明

### 优先级评估标准

1. **高优先级**：
   - 国内主流平台，用户量大
   - 企业级应用场景
   - 有明确的 API 文档和 SDK

2. **中优先级**：
   - 国际主流平台
   - 有特殊功能需求
   - 社区需求较高

3. **低优先级**：
   - 小众平台
   - 特殊协议
   - 实验性功能

## 贡献指南

如果你想为 onebots 贡献新的适配器，请参考：

1. [适配器开发指南](/guide/adapter) - 了解如何开发适配器
2. [现有适配器代码](https://github.com/lc-cn/onebots/tree/master/adapters) - 参考已实现的适配器
3. [核心接口文档](https://github.com/lc-cn/onebots/tree/master/packages/core) - 了解 Adapter 基类

## 相关链接

- [适配器配置指南](/guide/adapter)
- [平台配置说明](/config/platform)
- [快速开始](/guide/start)

