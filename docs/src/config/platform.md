# 平台配置

平台配置用于设置各平台机器人的认证信息和平台特定参数。

## 配置格式

平台配置使用 `{platform}.{account_id}` 格式：

```yaml
{platform}.{account_id}:
  # 平台特定配置
  platform_param1: value1
  platform_param2: value2
  
  # 协议配置（可选，覆盖 general）
  {protocol}.{version}:
    protocol_param: value
```

## 微信平台

### 配置项

#### appid

- **类型**: `string`
- **必填**: ✅
- **说明**: 微信公众号 AppID

#### appsecret

- **类型**: `string`
- **必填**: ✅
- **说明**: 微信公众号 AppSecret

#### token

- **类型**: `string`
- **必填**: ✅
- **说明**: 服务器配置的 Token（需与公众平台设置一致）

#### encoding_aes_key

- **类型**: `string`
- **必填**: ❌
- **说明**: 消息加解密密钥（启用加密模式时必填）

#### encrypt_mode

- **类型**: `string`
- **可选值**: `plain` | `compatible` | `safe`
- **默认值**: `plain`
- **说明**: 消息加解密模式
  - `plain`: 明文模式
  - `compatible`: 兼容模式
  - `safe`: 安全模式（加密）

### 配置示例

```yaml
wechat.my_official_account:
  # 微信平台配置
  appid: wx1234567890abcdef
  appsecret: your_app_secret_here
  token: your_token_here
  encoding_aes_key: your_aes_key_here
  encrypt_mode: safe
  
  # 协议配置
  onebot.v11:
    use_http: true
    use_ws: true
```

### 获取配置信息

1. 登录 [微信公众平台](https://mp.weixin.qq.com/)
2. 开发 → 基本配置
   - 获取 **AppID** 和 **AppSecret**
   - 设置 **服务器配置**

### Webhook 地址

配置服务器 URL 为：
```
http://your-domain:6727/wechat/{account_id}/webhook
```

例如：
```
http://bot.example.com:6727/wechat/my_official_account/webhook
```

## QQ 平台

> 🚧 开发中，暂无官方适配器

计划支持的配置项：

```yaml
qq.my_bot:
  appid: your_app_id
  secret: your_secret
  token: your_token
```

## 钉钉平台

> 🚧 计划中

计划支持的配置项：

```yaml
dingtalk.my_bot:
  appkey: your_app_key
  appsecret: your_app_secret
  agent_id: your_agent_id
```

## Kook 平台

> 🚧 计划中

计划支持的配置项：

```yaml
kook.my_bot:
  token: your_bot_token
  verify_token: your_verify_token
```

## 多账号配置

可以配置同一平台的多个账号：

```yaml
# 微信公众号 1
wechat.mp1:
  appid: wx111111111111
  appsecret: secret1
  token: token1
  onebot.v11:
    use_http: true

# 微信公众号 2
wechat.mp2:
  appid: wx222222222222
  appsecret: secret2
  token: token2
  satori.v1:
    path: /satori

# 微信公众号 3
wechat.mp3:
  appid: wx333333333333
  appsecret: secret3
  token: token3
  milky.v1:
    use_http: true
```

访问地址会根据 account_id 自动区分：
- `http://localhost:6727/wechat/mp1/onebot/v11/...`
- `ws://localhost:6727/wechat/mp2/satori`
- `http://localhost:6727/wechat/mp3/milky/v1/...`

## 协议配置覆盖

账号级别的协议配置会覆盖 general 配置：

```yaml
general:
  onebot.v11:
    use_http: true
    use_ws: false
    access_token: default_token

wechat.special_account:
  appid: wx123
  appsecret: secret
  token: token
  
  # 覆盖部分配置
  onebot.v11:
    use_ws: true              # 覆盖：启用 WebSocket
    access_token: special_token  # 覆盖：使用特殊 token
    # use_http 继承 general 配置（true）
```

## 完整示例

```yaml
# 全局配置
port: 6727
log_level: info
timeout: 30

# 协议默认配置
general:
  onebot.v11:
    use_http: true
    use_ws: false
    access_token: global_token
    
  satori.v1:
    path: /satori

# 微信账号 1 - 使用 OneBot V11
wechat.service_account:
  appid: wx_service_123
  appsecret: service_secret
  token: service_token
  encrypt_mode: safe
  encoding_aes_key: service_aes_key
  
  onebot.v11:
    use_http: true
    use_ws: true
    access_token: service_account_token

# 微信账号 2 - 使用 Satori
wechat.subscription_account:
  appid: wx_sub_456
  appsecret: sub_secret
  token: sub_token
  
  satori.v1:
    token: satori_token
    
# 微信账号 3 - 同时提供多个协议
wechat.multi_protocol:
  appid: wx_multi_789
  appsecret: multi_secret
  token: multi_token
  
  onebot.v11:
    use_http: true
    
  onebot.v12:
    use_http: true
    
  satori.v1:
    path: /satori
```

## 注意事项

### 账号 ID 命名

- 只能包含字母、数字、下划线、中划线
- 建议使用有意义的名称，如 `main_bot`、`test_account`
- 不同平台可以使用相同的账号 ID（会自动区分）

### 安全建议

- 不要在配置文件中硬编码敏感信息
- 使用环境变量或密钥管理服务
- 定期更换 token 和密钥
- 启用访问令牌（access_token）鉴权

### 配置文件管理

```yaml
# 使用环境变量（推荐）
wechat.prod:
  appid: ${WECHAT_APPID}
  appsecret: ${WECHAT_SECRET}
  token: ${WECHAT_TOKEN}
```

## 相关链接

- [全局配置](/config/global)
- [通用配置](/config/general)
- [协议配置](/config/protocol)
- [微信平台](/platform/wechat)
- [QQ 平台](/platform/qq)
