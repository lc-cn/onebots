# @onebots/adapter-douyin

基于 [`douyin-im`](https://github.com/zhinjs/douyin-im) 的 OneBots 抖音适配器。

## 已接入能力

- 扫码、短信验证码（可切换语音验证码）、手机号密码登录，以及会话持久化
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

首次启动后，在 OneBots Web 的「待办」中扫描二维码，或提交短信/语音验证码。短信和密码登录都必须配置 `mobile`，密码登录还必须配置 `password`。`account_id` 可先使用自定义别名，`douyin-im` 会在登录成功后保存稳定账号与设备会话。

抖音风控二次验证使用 `douyin-im` 内置的官方验证组件。OneBots 会把 SDK 返回的本机验证地址转换为 Web「待办」中的一次性同源链接，因此远程或纯 Headless 部署也可在浏览器中完成验证。链接使用仅存于内存的高熵能力路径、5 分钟后过期，并在验证结束或账号停止时立即撤销；不要复制或公开该链接。
