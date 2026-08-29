# @onebots/adapter-feishu

onebots 飞书/Lark 适配器，同时支持飞书（国内版）和 Lark（国际版）。

## 安装

```bash
pnpm add @onebots/adapter-feishu
```

## 配置

在 `config.yaml` 中配置：

```yaml
# 飞书（国内版）- 默认
feishu.feishu_bot:
  app_id: "YOUR_APP_ID"
  app_secret: "YOUR_APP_SECRET"
  long_connection: true

# Lark（国际版）
feishu.lark_bot:
  app_id: "YOUR_APP_ID"
  app_secret: "YOUR_APP_SECRET"
  long_connection: true
  endpoint: "https://open.larksuite.com/open-apis" # Lark 端点
```

使用 Webhook 时设置 `long_connection: false`，并配置 `verification_token`；启用加密推送时同时配置 `encrypt_key`。适配器会先解密再校验 token，Webhook 地址为账号路径下的 `/webhook`。

### 端点配置

| 端点         | URL                                    | 说明   |
| ------------ | -------------------------------------- | ------ |
| 飞书（默认） | `https://open.feishu.cn/open-apis`     | 国内版 |
| Lark         | `https://open.larksuite.com/open-apis` | 国际版 |

### TypeScript 配置（推荐）

```typescript
import { FeishuEndpoint } from '@onebots/adapter-feishu';

// 飞书（国内版）
{
  account_id: 'feishu_bot',
  app_id: 'cli_xxx',
  app_secret: 'xxx',
  // endpoint 可省略，默认为 FeishuEndpoint.FEISHU
}

// Lark（国际版）
{
  account_id: 'lark_bot',
  app_id: 'cli_xxx',
  app_secret: 'xxx',
  endpoint: FeishuEndpoint.LARK,
}

// 私有化部署
{
  account_id: 'private_bot',
  app_id: 'cli_xxx',
  app_secret: 'xxx',
  endpoint: 'https://your-private-feishu.com/open-apis',
}
```

## 使用

```bash
onebots -r feishu
```

## 功能

- 官方长连接与 Webhook 两种事件通道
- Webhook 加密事件解密与 Verification Token 校验
- 单聊、群聊、线程回复以及文本、@、图片、文件、音频、视频、富文本和卡片
- 真实机器人身份、通讯录用户、群列表、群详情和成员列表
- 消息撤回、成员变化等 canonical 事件投影；未知事件通过 `raw_event` 无损交付
- 飞书和 Lark 双端点以及私有化开放平台端点

## 消息与媒体

`image_key` / `file_key` 可直接发送；`image`、`file`、`audio`、`video` 段也可通过 `url` / `file` 传入 HTTP(S)、本地路径、data URL 或 `base64://`，适配器会先上传到当前飞书/Lark 应用再发送。音频和视频必须分别符合飞书的 opus 与 mp4 格式要求，可用 `file_type` 显式指定官方支持的文件类型。

文本、@ 与图片混排会编译为飞书 post 富文本。文件、音频、视频、卡片等平台不能在一条消息内无损混合的组合会明确失败，请拆分发送；未知消息段也不会再被静默忽略。飞书开放平台的消息更新接口仅适用于应用发送的 `interactive` 消息卡片，适配器不会再用错误的 HTTP 方法尝试更新文本或媒体。

## 平台扩展 API

下列动作可从 OneBot 11/12、Milky、Satori 的统一动作入口调用：

`reply_message`、`forward_message`、`add_reaction`、`delete_reaction`、`get_reactions`、`create_chat`、`update_chat`、`delete_chat`、`add_chat_members`、`remove_chat_members`、三种消息加急动作以及 Pin 管理动作。

其他开放平台能力可通过 `call_feishu_api` 调用：

```json
{
  "path": "/im/v1/chats",
  "method": "GET",
  "query": { "page_size": 50 }
}
```

动作执行权限由当前 tenant token scopes 和目标资源上下文决定。

## 获取应用凭证

### 飞书（国内版）

1. 访问 [飞书开放平台](https://open.feishu.cn/)
2. 创建企业自建应用
3. 获取 `App ID` 和 `App Secret`
4. 选择长连接，或配置事件订阅 URL（Webhook）
5. 配置应用权限（消息收发、通讯录等）

### Lark（国际版）

1. 访问 [Lark Developer](https://open.larksuite.com/)
2. 创建应用并获取凭证
3. 配置方式与飞书相同，只需设置 `endpoint` 为 Lark 端点

## 相关链接

- [飞书开放平台](https://open.feishu.cn/)
- [Lark Developer](https://open.larksuite.com/)
- [飞书 Bot 开发文档](https://open.feishu.cn/document/ukTMukTMukTM/uczM3QjL3MzN04yNzcDN)
- [onebots 文档](https://onebots.pages.dev/)
