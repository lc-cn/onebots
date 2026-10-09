# @onebots/adapter-douyin

基于 [`douyin-im`](https://github.com/zhinjs/douyin-im) 的 OneBots 抖音适配器。

## 已接入能力

- 扫码、短信验证码、手机号密码登录，以及会话持久化
- 私聊、陌生人会话和群聊消息接收
- 文本、@、图片发送；图片、视频、音频、文件、链接与回复消息接收
- 好友、陌生人、群和群成员查询
- 退群、邀请/移除群成员、审批入群申请
- 好友关系、群成员、群资料、撤回/删除、更新和表态事件

## 配置

```yaml
douyin.my-account:
  account_id: my-account
  login_method: qr
  onebot.v11:
    enable: true
```

首次启动后，在 OneBots Web 的「待办」中扫描二维码或提交短信验证码。`account_id` 可先使用自定义别名，`douyin-im` 会在登录成功后保存稳定账号与设备会话。

抖音风控二次验证使用 `douyin-im` 内置的官方验证组件。SDK 会在运行 OneBots 的主机上打开带一次性 token 的本地页面；当前 SDK 不向调用方返回该完整 URL，因此远程或纯 Headless 主机暂时无法从 Web 转发该页面。
