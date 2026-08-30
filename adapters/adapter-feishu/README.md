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
  receive_mode: long_connection

# Lark（国际版）
feishu.lark_bot:
  app_id: "YOUR_APP_ID"
  app_secret: "YOUR_APP_SECRET"
  receive_mode: long_connection
  endpoint: "https://open.larksuite.com/open-apis" # Lark 端点
```

使用 Webhook 时设置 `receive_mode: webhook`，并配置 `verification_token`；启用加密推送时同时配置 `encrypt_key`。适配器会先解密再校验 token，Webhook 地址为账号路径下的 `/webhook`。manual 模式若把已经认证的 2.0 事件直接交给 `ingest()`，这两个字段可省略；若复用 `ingestHttp()` / `acceptHttp()` 完成解密与 token 校验，则仍应配置。Web 管理端会根据接收模式动态显示这些字段。

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
- 统一 `receive_mode` 配置，Web 表单按模式动态展示 Webhook 凭据
- Webhook 加密事件解密与 Verification Token 校验
- 单聊、群聊、线程回复以及文本、@、图片、文件、音频、视频、富文本和卡片
- 真实机器人身份、通讯录用户、群列表、群详情和成员列表
- 消息撤回、已读、成员/机器人群生命周期、菜单交互和消息表情增删等 canonical 事件投影；未知事件通过 `raw_event` 无损交付
- 飞书和 Lark 双端点以及私有化开放平台端点
- `await FeishuBot.ingest(rawEvent)` 可把已有 WebSocket、队列或宿主连接收到的已认证 2.0 事件交给同一客户端，并在协议投递完成后返回
- `ingestHttp({ method, body })` 返回 `{ status, headers, body, event? }`；`acceptHttp(Request)` 与 `acceptHttp(ctx)` 分别适配跨 realm Fetch/WinterCG 和 Koa Host，三者共用解密、认证与错误响应策略
- 并发启动与 tenant token 请求合并，stop 会废弃在途启动；失效令牌自动刷新一次
- 所有 API/媒体失败继承 `OneBotsError`，并使用 `FeishuError.code` / `category` 分类

长连接注册官方 SDK 当前声明的全部 IM v1 事件，包括消息、已读、撤回、表情回复、用户/机器人群成员变化、群更新与机器人单聊进入事件。其他业务域事件仍可通过 `FeishuBot.ingest()` 交给同一客户端。

停止长连接时会先使当前启动代次失效并摘除 SDK 引用，再关闭连接、清理事件分发器并等待全部异步 `stopped` 监听器；单一步骤失败不会阻断其余清理。

同一个成员变更或消息已读事件包含多个对象时，适配器会逐个分发 ID 稳定的 canonical notice，不再只投影数组第一项；完整原始载荷仍通过 `raw_event` 无损保留。机器人进群、被移出与群解散会投影为群生命周期事件，自定义菜单点击会投影为交互事件。

平台事件缺少 `event_id` 时，适配器会根据 canonical JSON 载荷生成确定性 SHA-256 身份；同一事件重试不会因接收时间或对象键顺序不同而产生新 ID。相同事件的并发重投会合并为一次处理，异步监听器或协议投递失败前不会提交去重状态；一个出口失败不会阻止其余协议出口收到本次事件，全部出口尝试完成后再统一向上游报告失败。

旧的 `long_connection` 布尔字段已由明确的 `receive_mode: long_connection | webhook | manual` 取代，不再保留双配置语义。

## 消息与媒体

`image_key` / `file_key` 可直接发送；`image`、`file`、`audio`、`video` 段也可通过 `url` / `file` 传入 HTTP(S)、本地路径、data URL 或 `base64://`，适配器会先上传到当前飞书/Lark 应用再发送。音频和视频必须分别符合飞书的 opus 与 mp4 格式要求，可用 `file_type` 显式指定官方支持的文件类型。

文本、@ 与图片混排会编译为飞书 post 富文本。文件、音频、视频、卡片等平台不能在一条消息内无损混合的组合会明确失败，请拆分发送；未知消息段也不会再被静默忽略。飞书开放平台的消息更新接口仅适用于应用发送的 `interactive` 消息卡片，适配器不会再用错误的 HTTP 方法尝试更新文本或媒体。

## 平台扩展 API

下列动作可从 OneBot 11/12、Milky、Satori 的统一动作入口调用：

`reply_message`、`forward_message`、`merge_forward_messages`、`get_message_read_users`、`add_reaction`、`delete_reaction`、`get_reactions`、`create_chat`、`update_chat`、`delete_chat`、`add_chat_members`、`remove_chat_members`、三种消息加急动作以及 Pin 管理动作。

其他开放平台能力可通过 `call_feishu_api` 调用：

```json
{
  "path": "/im/v1/chats",
  "method": "GET",
  "query": { "page_size": 50 }
}
```

动作执行权限由当前 tenant token scopes 和目标资源上下文决定。

底层调用返回非零 `code`、非 2xx HTTP 或无效 JSON 时会抛出导出的 `FeishuError`。调用方可依据 `code`、`category`、`operation`、`status`、`platformCode` 和 `details` 稳定处理错误；适配器不会把平台失败伪装成成功响应。

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
