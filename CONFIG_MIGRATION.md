# 配置迁移指南

## 新配置格式说明

新的配置格式采用了扁平化的层级结构，便于理解、维护和编写类型提示。

### 格式概览

```yaml
port: [端口]
general:
  onebot.v11:
    [onebot 11的默认配置]
  onebot.v12:
    [onebot 12的默认配置]
  satori.v1:
    [satori v1的默认配置]
  milky.v1:
    [milky v1的默认配置]

[platform].[account_id]:
  # 平台特定配置（直接放在账号下，不需要 config 块）
  token: xxx
  secret: xxx
  ...

  # 协议配置（以 protocol.version 形式命名）
  onebot.v11:
    [onebot 11的配置]
  onebot.v12:
    [onebot 12的配置]
  satori.v1:
    [satori v1的配置]
  milky.v1:
    [milky v1的配置]
```

### 关键特点

1. **扁平化结构**：不再使用 `config` 块，平台配置直接放在账号下
2. **协议版本明确**：使用 `protocol.version` 格式 (如 `onebot.v11`)
3. **配置继承**：账号配置会继承 `general` 中的默认值
4. **类型提示友好**：扁平化结构便于 TypeScript 类型定义

## 配置识别规则

- **包含点(`.`)的键**：被识别为协议配置 (如 `onebot.v11`)
- **不包含点的键**：被识别为平台特定配置 (如 `token`, `secret`)

## 迁移示例

### 旧格式（不推荐）

```yaml
kook.my_bot:
  config:
    token: "1/ABCDEFG/xxxxx=="

  onebot.v11:
    access_token: "my_token"
```

### 新格式（推荐）

```yaml
kook.my_bot:
  # 平台配置
  token: "1/ABCDEFG/xxxxx=="

  # 协议配置
  onebot.v11:
    access_token: "my_token"
```

## 完整示例

### QQ 官方机器人

```yaml
qq.my_bot:
  # QQ 平台配置
  token: "your_qq_token"
  secret: "your_qq_secret"
  sandbox: false
  intents:
    - "GROUP_AT_MESSAGE_CREATE"
    - "C2C_MESSAGE_CREATE"
    - "PUBLIC_GUILD_MESSAGES"

  # OneBot V11 协议
  onebot.v11:
    use_http: true
    use_ws: true
    access_token: "qq_v11_token"
    heartbeat_interval: 5

  # Satori V1 协议（可选）
  satori.v1:
    use_http: true
    use_ws: true
    token: "qq_satori_token"
    platform: "qq"
```

### Kook 机器人

```yaml
kook.kook_bot:
  # Kook 平台配置
  token: "1/ABCDEFG/xxxxx=="

  # 同时启用多个协议
  onebot.v11:
    access_token: "kook_v11_token"

  onebot.v12:
    access_token: "kook_v12_token"

  satori.v1:
    token: "kook_satori_token"
    platform: "kook"

  milky.v1:
    access_token: "kook_milky_token"
```

### 钉钉机器人

```yaml
dingtalk.client_id:
  # 钉钉平台配置
  clientSecret: "your_client_secret"
  username: "钉钉机器人"
  avatar: "https://example.com/avatar.png"

  # 协议配置
  onebot.v11:
    use_http: true
    use_ws: true

  onebot.v12:
    use_http: true
    use_ws: true
```

## 配置优先级

账号特定配置 > `general` 默认配置

例如：

```yaml
general:
  onebot.v11:
    use_http: true
    use_ws: true
    access_token: ""
    heartbeat_interval: 5

kook.bot:
  token: "xxx"
  onebot.v11:
    access_token: "my_token" # 覆盖 general 中的 access_token
    # use_http, use_ws, heartbeat_interval 继承 general 配置
```

## 迁移步骤

1. **备份现有配置**

   ```bash
   cp config.yaml config.yaml.bak
   ```

2. **修改配置格式**
   - 移除 `config` 块，将平台配置直接放在账号下
   - 保持协议配置不变（已经是 `protocol.version` 格式）

3. **验证配置**
   - 启动程序并检查日志
   - 确认所有账号和协议正常加载

4. **清理备份**
   ```bash
   rm config.yaml.bak
   ```

## 常见问题

### Q: 为什么要去掉 `config` 块？

A: 扁平化的结构更加简洁，并且更便于编写 TypeScript 类型定义。通过键名是否包含点(`.`)就能区分平台配置和协议配置。

### Q: 旧格式还能用吗？

A: 理论上支持向后兼容，但强烈建议迁移到新格式以获得更好的类型提示和开发体验。

### Q: 如何知道哪些键是平台配置，哪些是协议配置？

A:

- 协议配置：键名包含点，如 `onebot.v11`, `satori.v1`
- 平台配置：键名不包含点，如 `token`, `secret`, `intents`

### Q: 可以不配置 `general` 吗？

A: 可以，但建议配置 `general` 作为默认值，这样每个账号只需要覆盖需要改变的配置项。

## 配置模板

参考 `src/config.sample.yaml` 获取完整的配置模板和说明。
