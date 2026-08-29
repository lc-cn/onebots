# 企业微信 · 微信客服

`@onebots/adapter-wecom-kf` 对接微信客服的 `kf/sync_msg`、`kf/send_msg` 与会话管理 API。普通企业自建应用使用独立的 [`wecom`](./wecom.md)，两者不共享 Secret 或会话模型。

```yaml
wecom-kf.customer_service:
  corp_id: ww1234567890abcdef
  corp_secret: your_wecom_customer_service_secret
  token: your_callback_token
  encoding_aes_key: your_43_character_key
  open_kfid: wkxxxxxxxxxxxxxxxx
  cursor_store_path: ./data/wecom-kf-cursor.json
```

回调 URL 默认为 `https://bot.example.com/wecom-kf/customer_service/webhook`。回调必须是企业微信官方加密 XML，且解密载荷的 CorpID 必须匹配配置。

字段含义、默认值与 Web 表单分组见[微信客服配置](/config/adapter/wecom-kf)。

## 能力边界

- 回调校验后立即确认，Token 触发后台 `sync_msg`；同一客服账号串行分页并原子持久化游标。
- 停止会取消在途同步，快速重启使用 generation 隔离旧生命周期请求。
- 客户、接待人员、平台事件及未知条目均保留完整原始数据。
- 支持文本、媒体、文件、链接、位置、小程序、菜单与原生消息体。
- 支持客服账号、接待人员、客户详情、会话分配、事件响应消息、升级服务、统计与视频号绑定状态动作。
- 临时素材接口不需要 `agent_id`；媒体发送使用上传后得到的 `media_id`。
- 仅存在客户私聊，不声明好友列表、普通企业微信员工消息或群聊能力。
- `wecom_kf_call` 为后续官方接口提供受限底层入口。

完整动作、消息示例与 `ingest/acceptHttp` 嵌入契约见 [包 README](https://github.com/lc-cn/onebots/tree/master/adapters/adapter-wecom-kf)。

## 官方参考

- [微信客服概述](https://developer.work.weixin.qq.com/document/path/94638)
- [接收消息与事件](https://developer.work.weixin.qq.com/document/path/94670)
- [发送消息](https://developer.work.weixin.qq.com/document/path/94677)
- [会话分配](https://developer.work.weixin.qq.com/document/path/94669)
