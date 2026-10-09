# 抖音

`@onebots/adapter-douyin` 基于 [`douyin-im`](https://github.com/zhinjs/douyin-im)，把抖音私聊、陌生人会话和群聊接入 OneBots 的统一账号、事件与协议出口。

## 安装与登录

在 Web「扩展」中安装 `@onebots/adapter-douyin`，激活候选运行版本后添加抖音账号。扫码登录只需填写稳定的账号别名：

```yaml
douyin.my-account:
  account_id: my-account
  login_method: qr
```

短信和密码登录都必须填写 `mobile`；短信登录将 `login_method` 设为 `sms`，密码登录还必须填写敏感字段 `password`。首次启动账号后，二维码、验证码输入和多账号选择会进入 Web「待办」；短信验证可在待办中切换为语音验证码。登录成功后，设备与会话保存在 OneBots 数据目录的 `data/douyin` 下。

## 能力

- 文本、@ 和图片发送；私聊、陌生人会话和群聊接收
- 图片、视频、音频、文件、链接、回复等入站消息段投影
- 好友、用户、群和群成员查询
- 退群、邀请/移除成员、审批入群申请
- 群成员、群资料、好友关系、消息撤回/删除/更新和表态事件

能力清单只声明适配器已经投影和实现的统一 API。`douyin-im` 提供但尚未完成 OneBots 统一语义的作品互动、关注等接口不会提前显示为可用能力。

## 安全验证限制

抖音风控可能要求浏览器二次验证。`douyin-im` 会生成含一次性 token 的本地验证页并在 OneBots 所在主机打开；当前 SDK 不返回完整 URL，因此不能安全地从远程 Web 端拼接或转发。Web「待办」会显示验证状态，验证操作需要在运行 OneBots 的桌面主机完成。
