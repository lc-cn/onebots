# WhatsApp 适配器配置

适配器直接接入 Meta WhatsApp Cloud API，并把 Webhook 挂载到 OneBots 现有 HTTP 服务。

## 配置示例

```yaml
whatsapp.my_bot:
  phone_number_id: "your_phone_number_id"
  business_account_id: "your_business_account_id"
  access_token: "your_long_lived_access_token"
  app_secret: "your_meta_app_secret"
  webhook_verify_token: "your_random_verify_token"
  api_version: "v23.0"

  onebot.v11:
    access_token: "your_onebots_token"
```

## 字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `phone_number_id` | 是 | WhatsApp > API Setup 中的 Phone Number ID |
| `business_account_id` | 是 | WhatsApp Business Account ID，模板管理等 API 会使用 |
| `access_token` | 是 | 建议使用系统用户生成的长期 Access Token |
| `app_secret` | 是 | Meta 应用 Secret，用于校验 `X-Hub-Signature-256` |
| `webhook_verify_token` | 是 | 自定义随机值，须与 Meta Webhook 配置一致 |
| `webhook_path` | 否 | 默认 `/whatsapp/{account_id}/webhook` |
| `api_version` | 是 | Graph API 版本，例如 `v23.0`；按应用当前启用版本填写 |
| `api_base_url` | 否 | 默认 `https://graph.facebook.com`，仅兼容网关或测试覆盖 |
| `deduplicate_webhooks` | 否 | 默认开启，过滤 Meta 重投递 |
| `webhook_deduplication_limit` | 否 | 去重缓存上限，默认 10000 |

## 配置 Meta Webhook

1. Callback URL 填写 `https://你的域名/whatsapp/my_bot/webhook`。
2. Verify Token 填写配置中的 `webhook_verify_token`。
3. 至少订阅 `messages` 字段；消息状态也通过这个字段投递。
4. 确保反向代理转发 `X-Hub-Signature-256`，且 OneBots 能读取未经修改的原始请求体。

旧版 camelCase 字段、`webhook.url`、`webhook.fields` 和适配器私有代理配置已移除，避免配置存在两套事实来源。

更多能力和原生调用示例见 [WhatsApp 平台文档](/platform/whatsapp)。
