# Microsoft Teams

Microsoft Teams 是微软推出的团队协作平台，支持聊天、视频会议、文件共享等功能。

## 状态

✅ **已实现并可用**

## 功能特性

- ✅ **私聊消息** - 支持与用户的一对一聊天
- ✅ **群聊消息** - 支持频道和群组消息
- ✅ **消息编辑** - 支持编辑已发送的消息
- ✅ **消息删除** - 支持删除消息
- ✅ **自适应卡片** - 支持发送丰富的自适应卡片
- ✅ **事件订阅** - 支持成员加入/离开等事件
- ✅ **Webhook 模式** - 通过 Webhook 接收事件

## 安装

```bash
npm install @onebots/adapter-teams
# 或
pnpm add @onebots/adapter-teams
```

## 配置示例

### 基本配置

```yaml
accounts:
  - platform: teams
    account_id: my_teams_bot
    protocol: onebot.v11
    
    # Microsoft Teams 配置
    app_id: your_app_id
    app_password: your_app_password
    webhook:
      url: https://your-domain.com/teams/my_teams_bot/webhook
      port: 8080
```

### 高级配置

```yaml
accounts:
  - platform: teams
    account_id: my_teams_bot
    protocol: onebot.v11
    
    app_id: your_app_id
    app_password: your_app_password
    webhook:
      url: https://your-domain.com/teams/my_teams_bot/webhook
      port: 8080
    # 可选：用于政府云等特殊环境
    channel_service: https://botframework.azure.us
    open_id_metadata: https://login.microsoftonline.us/common/v2.0/.well-known/openid-configuration
```

## 使用客户端 SDK

使用 `imhelper` 客户端 SDK 连接 Teams Bot：

```typescript
import { ImHelper } from '@onebots/imhelper';
import { TeamsAdapter } from '@onebots/adapter-teams';

const helper = new ImHelper({
  baseUrl: 'http://localhost:8080',
  platform: 'teams',
  accountId: 'my_teams_bot',
  accessToken: 'your_access_token',
});

// 监听消息
helper.on('message', (message) => {
  console.log('收到消息:', message.content);
  
  // 自动回复
  helper.sendMessage({
    scene_id: message.scene_id,
    scene_type: message.scene_type,
    message: [{ type: 'text', data: { text: '收到！' } }],
  });
});

// 连接
await helper.connect();
```

## Microsoft Teams 配置步骤

1. **创建 Azure Bot 资源**
   - 登录 [Azure Portal](https://portal.azure.com)
   - 创建 "Azure Bot" 资源
   - 获取 **App ID** 和 **App Password**

2. **配置 Messaging Endpoint**
   - 在 Azure Bot 资源中，设置 **Messaging endpoint**
   - URL 格式：`https://your-domain.com/teams/{account_id}/webhook`

3. **在 Teams 中测试**
   - 在 Microsoft Teams 中搜索你的 Bot
   - 开始对话测试

## 注意事项

1. **Webhook 模式**：Teams Bot 必须使用 Webhook 模式，不支持轮询
2. **HTTPS 要求**：生产环境的 Webhook URL 必须是 HTTPS
3. **消息限制**：Teams 对消息发送频率有限制
4. **自适应卡片**：Teams 支持丰富的自适应卡片格式，可以创建更丰富的交互体验

## 相关链接

- [适配器配置文档](/config/adapter/teams)
- [Microsoft Bot Framework 文档](https://dev.botframework.com/)
- [Teams Bot 开发文档](https://docs.microsoft.com/en-us/microsoftteams/platform/bots/what-are-bots)

