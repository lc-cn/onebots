# 连接鉴权与心跳测试依据

本目录下的**连接鉴权**与**心跳**相关测试用例，均严格对照各协议的官方通信规范编写，不得与协议文档有任何偏差。本文档为唯一依据索引，便于审查与回归。

---

## 一、OneBot 11 (OB11)

### 1.1 协议与文档来源

| 通信方式 | 官方文档 | 本仓库测试文件 |
|----------|----------|----------------|
| HTTP API | [OneBot 11 标准 - 通信方式](https://github.com/botuniverse/onebot-11)，HTTP 鉴权见「access_token」约定 | `onebot/v11/http/auth.spec.js` |
| 正向 WebSocket | 同上，WS 鉴权在连接建立前完成 | `onebot/v11/websocket/auth.spec.js` |
| HTTP Reverse (WebHook) | 同上，POST 推送时的鉴权与签名 | `onebot/v11/webhook/auth.spec.js`、`onebot/v11/webhook/http-reverse.spec.js` |
| 反向 WebSocket | 同上，access_token 鉴权（Query 或 Header） | `onebot/v11/websocket/ws-reverse-auth.spec.js`、`onebot/v11/websocket/ws-reverse.spec.js` |

**鉴权规范（OB11 约定）：**

- **HTTP**：若配置 `access_token`，请求须携带鉴权；支持两种方式（任选其一或同时存在时约定优先级）：
  - 请求头：`Authorization: Bearer <access_token>`
  - URL Query：`?access_token=<access_token>`
- **WebSocket（正向/反向）**：鉴权在 **协议 upgrade 之前** 完成；支持 Query 参数 `access_token` 或 Header `Authorization: Bearer <access_token>`；鉴权失败须返回 **HTTP 401 Unauthorized**。
- **WebHook**：若配置 `access_token`，应用端需验证；可选 HMAC 签名（请求头 `X-Signature: sha1=<signature>`）。

**心跳规范（OB11 元事件）：**

- 事件类型：`post_type === 'meta_event'` 且 `meta_event_type === 'heartbeat'`。
- 必选字段（测试中必须校验）：
  - `interval`：number，到下次心跳的间隔，单位**毫秒**。
  - `status`：object，状态信息（如 `online`、`good` 等，以协议/实现为准）。
- 参考：本仓库 `docs/src/protocol/onebot-v11/event.md` 与 `protocols/onebot-v11/protocol/README.md` 与 OneBot 11 标准保持一致。

---

## 二、OneBot 12 (OB12)

### 2.1 协议与文档来源

| 通信方式 | 官方文档 | 本仓库测试文件 |
|----------|----------|----------------|
| HTTP API | [12.onebot.dev - HTTP](https://12.onebot.dev/connect/communication/http/) | （与通用 HTTP 鉴权一致，可按需在 OB12 HTTP 测试中覆盖） |
| HTTP Webhook | [12.onebot.dev - HTTP Webhook](https://12.onebot.dev/connect/communication/http-webhook/) | `onebot/v12/webhook/headers.spec.js` |
| 正向 WebSocket | [12.onebot.dev - 正向 WebSocket](https://12.onebot.dev/connect/communication/websocket/) | `onebot/v12/websocket/connection.spec.js` 等 |
| 反向 WebSocket | [12.onebot.dev - 反向 WebSocket](https://12.onebot.dev/connect/communication/websocket-reverse/) | `onebot/v12/websocket/headers.spec.js`、`onebot/v12/websocket/ws-reverse.spec.js` |

**鉴权规范（OB12 原文）：**

- **HTTP**（[12.onebot.dev - HTTP - 鉴权](https://12.onebot.dev/connect/communication/http/)）：
  - 若配置 `access_token` 且非空：必须先检查请求头 `Authorization`，值须为 `Bearer <access_token>`（前后空白可裁剪）；若不存在则检查 URL query 参数 `access_token`，值须等于配置的 access_token。
  - 若以上均不存在或校验失败，则鉴权失败。
  - **鉴权失败必须返回 HTTP 状态码 401 Unauthorized。**
- **正向 WebSocket**：鉴权在连接建立前（协议 upgrade 前）完成，方式与 HTTP 相同；鉴权失败必须返回 **401 Unauthorized**。
- **反向 WebSocket**（[12.onebot.dev - 反向 WebSocket - 请求头](https://12.onebot.dev/connect/communication/websocket-reverse/)）：
  - 必须设置：`Sec-WebSocket-Protocol: <version>.<impl>`（如 `12.onebots`）；`User-Agent` 建议如 `OneBot/12 (qq) Go-LibOneBot/1.0.0`。
  - 若配置了 `access_token`：须设置 `Authorization: Bearer <access_token>`；若无法设置请求头，则通过 URL query 参数 `access_token` 传递。
- **HTTP Webhook**：必须设置 `Content-Type: application/json`、`User-Agent`、`X-OneBot-Version: 12`、`X-Impl: <impl>`；若配置 access_token 须设置 `Authorization: Bearer <access_token>`（或 query）。

**心跳规范（OB12 元事件）：**

- 事件类型：`type === 'meta'` 且 `detail_type === 'heartbeat'`。
- 必选字段：`interval`：number，间隔，单位**毫秒**（OB12 标准示例中无 `status` 字段，以标准为准）。
- 参考：`protocols/onebot-v12/protocol/README.md` 与 [12.onebot.dev](https://12.onebot.dev)。

---

## 三、Milky

### 3.1 协议与文档来源

| 通信方式 | 官方文档 | 本仓库测试文件 |
|----------|----------|----------------|
| HTTP API | [Milky - 通信](https://milky.ntqqrev.org/guide/communication) | `milky/v1/http/auth.spec.js` |
| SSE 事件 | 同上，GET `/event`，鉴权方式见下 | `milky/v1/sse/event.spec.js` |
| WebSocket 事件 | 同上，WS `/event` | `milky/v1/websocket/event.spec.js` |

**鉴权规范（Milky 原文）：**

- **API 调用**：请求头 `Authorization: Bearer {access_token}`。鉴权凭据未提供或不匹配时须返回 **HTTP 401**。
- **SSE / WebSocket**：请求头 `Authorization: Bearer {access_token}`；不支持自定义 Header 时可通过 **Query 参数** `access_token` 传递，例如 `GET /event?access_token=xxx` 或 `ws://.../event?access_token=xxx`。
- **错误状态码**：**415** 不支持的 Content-Type；**404** API 不存在；**401** 鉴权未提供或不匹配。
- **Content-Type**：POST 必须为 `application/json`；无参数时也必须传空对象 `{}`。

**心跳（若协议定义）：**

- Milky 协议端可配置 `heartbeat` 间隔；若实现中采用与 OB11 兼容的元事件格式（`post_type: meta_event`, `meta_event_type: heartbeat`，含 `interval`、`status`），则测试可参照本仓库 `protocols/milky-v1/protocol/README.md` 中的元事件结构。当前 Milky 测试以鉴权与事件推送为主，心跳用例可按实现补充。

---

## 四、Satori

### 4.1 协议与文档来源

| 通信方式 | 官方文档 | 本仓库测试文件 |
|----------|----------|----------------|
| HTTP API | [Satori 协议总览](https://satori.chat/zh-CN/protocol/)；鉴权与传输细节以官方文档为准 | `satori/v1/http/auth.spec.js` |
| WebSocket 事件 | 同上 | `satori/v1/websocket/event.spec.js` |

**鉴权规范（Satori 常见约定）：**

- HTTP API 与 WebSocket 通常使用 **Bearer Token**：请求头 `Authorization: Bearer <token>`。
- 错误响应格式：`{ message: string }`；成功响应：`{ data: any }`。
- 具体鉴权细节（如 401/403、Query 备选等）以 [Satori 协议文档](https://satori.chat/zh-CN/protocol/) 及官方传输说明为准；测试用例应与文档保持一致。

**心跳：**

- 以 Satori 官方文档是否定义心跳事件为准；若未定义，则不强制增加心跳测试。

---

## 五、测试与文档同步原则

1. **鉴权**：每个协议的鉴权测试必须与上述对应官方文档的「鉴权」/「Authorization」/「access_token」描述一致，包括但不限于：
   - Header / Query 方式及优先级
   - 鉴权失败时的 HTTP 状态码（401/403 等）
   - Content-Type 与 415 等
2. **心跳**：仅对在协议中**明确定义**了心跳事件格式的协议（如 OB11、OB12）编写心跳用例；字段名与类型以官方文档或本仓库协议实现 README 为准，不得擅自增删字段断言。
3. **文档引用**：各测试文件头部应注明「依据」的官方文档链接及章节（见下节），便于逐条对照。

---

## 六、各测试文件应注明的依据

在以下测试文件**顶部注释**中，应包含「依据」说明（协议文档 URL + 鉴权/心跳相关小节），保证可追溯、无偏差：

- `onebot/v11/http/auth.spec.js` → OneBot 11 标准 HTTP 通信 + access_token 鉴权
- `onebot/v11/websocket/auth.spec.js` → OneBot 11 标准 正向 WebSocket + 鉴权
- `onebot/v11/webhook/auth.spec.js` → OneBot 11 标准 HTTP POST 反向 + 鉴权
- `onebot/v11/webhook/http-reverse.spec.js` → 同上 + 元事件心跳结构
- `onebot/v11/websocket/ws-reverse-auth.spec.js` → OneBot 11 标准 反向 WebSocket + access_token
- `onebot/v11/websocket/ws-reverse.spec.js` → 同上 + 元事件心跳结构
- `onebot/v12/websocket/headers.spec.js` → 12.onebot.dev 反向 WebSocket 请求头与鉴权
- `onebot/v12/websocket/ws-reverse.spec.js` → 同上 + meta 心跳事件
- `onebot/v12/webhook/headers.spec.js` → 12.onebot.dev HTTP Webhook 请求头与鉴权
- `milky/v1/http/auth.spec.js` → milky.ntqqrev.org 通信 - API 鉴权与状态码
- `milky/v1/sse/event.spec.js` → milky.ntqqrev.org 通信 - SSE 鉴权
- `milky/v1/websocket/event.spec.js` → milky.ntqqrev.org 通信 - WebSocket 鉴权
- `satori/v1/http/auth.spec.js` → satori.chat 协议 - HTTP 鉴权与响应格式
- `satori/v1/websocket/event.spec.js` → satori.chat 协议 - WebSocket 鉴权

以上为连接鉴权与心跳测试的**唯一依据**说明，修改协议行为时请同步更新本文档与对应测试及注释。
