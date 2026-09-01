# 飞书/Lark 适配器配置

飞书适配器配置说明，同时支持飞书（国内版）和 Lark（国际版）。

## 配置项

### app_id

- **类型**: `string`
- **必填**: ✅
- **说明**: 飞书/Lark 应用 App ID

### app_secret

- **类型**: `string`
- **必填**: ✅
- **说明**: 飞书/Lark 应用 App Secret

### receive_mode

- **类型**: `long_connection | webhook | manual`
- **必填**: ❌
- **默认值**: `long_connection`
- **说明**: `long_connection` 使用官方长连接；`webhook` 在 OneBots HTTP 服务挂载回调；`manual` 由已有 Host 或消息队列调用 `ingest()`

### encrypt_key

- **类型**: `string`
- **必填**: ❌
- **说明**: 事件加密密钥（启用加密模式时必填）

### verification_token

- **类型**: `string`
- **必填**: ❌
- **说明**: 事件验证 Token

### endpoint

- **类型**: `string`
- **必填**: ❌
- **默认值**: `https://open.feishu.cn/open-apis`
- **说明**: API 端点地址，用于切换飞书/Lark 或私有化部署

| 端点 | URL | 说明 |
|------|-----|------|
| 飞书（默认） | `https://open.feishu.cn/open-apis` | 国内版 |
| Lark | `https://open.larksuite.com/open-apis` | 国际版 |

## 配置示例

### 飞书（国内版）

```yaml
feishu.my_bot:
  app_id: 'cli_xxxxxxxxxxxxx'
  app_secret: 'your_app_secret'
  receive_mode: 'long_connection'  # 可省略，默认值
  encrypt_key: 'your_encrypt_key'  # 可选
  verification_token: 'your_verification_token'  # 可选
  # endpoint 可省略，默认为飞书国内版
```

### Lark（国际版）

```yaml
feishu.lark_bot:
  app_id: 'cli_xxxxxxxxxxxxx'
  app_secret: 'your_app_secret'
  receive_mode: 'long_connection'
  endpoint: 'https://open.larksuite.com/open-apis'  # Lark 端点
```

### TypeScript 配置

```typescript
import { FeishuEndpoint } from '@onebots/adapter-feishu';

// Lark（国际版）
{
  account_id: 'lark_bot',
  app_id: 'cli_xxx',
  app_secret: 'xxx',
  endpoint: FeishuEndpoint.LARK,
}
```

## 获取应用凭证

### 飞书（国内版）

1. 访问 [飞书开放平台](https://open.feishu.cn/)
2. 创建企业自建应用
3. 在"应用信息"中获取 `App ID` 和 `App Secret`
4. 默认长连接模式无需填写请求地址；在事件订阅中选择长连接并添加所需事件
5. 仅使用 `webhook` 模式时配置请求地址，并获取 `Encrypt Key` 和 `Verification Token`（如果启用加密）
6. 配置应用权限（消息收发、通讯录等）

### Lark（国际版）

1. 访问 [Lark Developer](https://open.larksuite.com/)
2. 创建应用并获取凭证
3. 配置方式与飞书相同

## Webhook 地址

仅当 `receive_mode: webhook` 时，配置事件订阅 URL 为：

```
http://your-domain:port/feishu/{account_id}/webhook
```

例如：
```
http://bot.example.com:6727/feishu/my_bot/webhook
```

生产环境应使用 HTTPS，并确保反向代理把该路径转发到 OneBots。

## 启动超时与取消

飞书账号启动会依次获取租户令牌、校验机器人身份并建立官方长连接，整个过程受 OneBots 全局 `timeout` 约束。超时或配置热重载取消启动时，适配器会中止令牌与身份请求、强制关闭尚未完成的官方长连接，并阻止迟到响应恢复在线状态。身份与连接就绪后，取消信号会保留到协议出口完成，以便协议启动失败时完整回滚账号。

## 相关链接

- [适配器配置指南](/guide/adapter)
- [飞书平台文档](/platform/feishu)
