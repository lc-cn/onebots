# WeCom Custom Application

`@onebots/adapter-wecom` targets the official WeCom custom-application API. WeCom Customer Service (`kf/sync_msg` and `kf/send_msg`) is a separate product and uses [`wecom-kf`](./wecom-kf.md).

```yaml
wecom.internal_app:
  corp_id: ww1234567890abcdef
  corp_secret: your_application_secret
  agent_id: '1000001'
  token: your_callback_token
  encoding_aes_key: your_43_character_key
  deduplicate_webhooks: true
```

Configure `https://bot.example.com/wecom/internal_app/webhook` as the receive-message URL. The adapter only accepts signed encrypted callbacks and validates the decrypted CorpID.

Private/direct messages use the application-message API. Group scenes are real application-created `appchat` conversations; departments and tags are never projected as chats. Recall is available only when WeCom returned a server `msgid`; app-chat sends do not return one and are not falsely advertised as recallable. A common `at` segment becomes readable `@userid` text without claiming notification semantics.

Native actions cover media, message recall, template-card updates, app chats, contacts, departments, tags, invitations, and network metadata. `wecom_call` provides a constrained path for new official endpoints.

Every event retains the complete decrypted and encrypted XML in `raw_event`. See the [package README](https://github.com/lc-cn/onebots/tree/master/adapters/adapter-wecom) for embedding and action details.
