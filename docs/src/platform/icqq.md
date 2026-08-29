# ICQQ 适配器

ICQQ 适配器基于 `@icqqjs/icqq`，以 QQ 个人账号会话接入 OneBots。它覆盖私聊、群聊、讨论组、QQ 频道、文件、群管理与登录验证，并保留 ICQQ 原始事件和扩展能力。

## 能力摘要

- 私聊、群聊和 QQ 频道消息发送；讨论组通过原生扩展动作发送
- 文本、表情、图片、语音、视频、@、回复、分享、JSON 与 XML 消息
- 撤回、历史、合并转发、已读、回应、精华消息和群公告
- 好友、群成员、群设置、QQ 频道、群文件与离线文件管理
- 扫码、密码、滑块、设备锁、短信和身份验证流程
- generation 隔离、无限网络恢复与安全心跳调度

## 完整事件面

适配器接收并投影 ICQQ 提供的以下事件：

- 私聊、群聊、讨论组与 QQ 频道消息；频道删除推送为 `message_deleted`
- 跨设备私聊同步，以及私聊/群聊已读同步
- 好友增加、减少和好友申请
- 群申请/邀请、成员增减、禁言、管理员、回应、撤回与戳一戳
- 输入状态、群打卡与群主转让

讨论组使用 `discuss:<id>` 作为隔离的场景 ID，避免与数字相同的 QQ 群碰撞。群打卡与群主转让没有对应的 canonical notice 类型，因此通过带 `raw_event` 和 ICQQ 扩展字段的 `custom` notice 无损交付。

## 安装

`@icqqjs/icqq` 来自 GitHub Packages。先配置 registry 并使用具备 `read:packages` 权限的 GitHub token 登录：

```ini
@icqqjs:registry=https://npm.pkg.github.com
```

```bash
npm login --scope=@icqqjs --auth-type=legacy --registry=https://npm.pkg.github.com
pnpm add @onebots/adapter-icqq
```

## 配置

```yaml
icqq.123456789:
  # 留空则扫码登录
  password: your_password
  protocol:
    platform: 2
    sign_api_addr: http://127.0.0.1:8080
    data_dir: data/icqq
    ignore_self: true
    resend: true
    reconn_interval: 5
    cache_group_member: true
    auto_server: true
```

Web 管理端会按账号凭据、连接、过滤、发送与高级设置分区展示这些字段。签名服务器、QQ 协议版本和账号风控要求可能随上游变化；生产使用前应在测试账号验证当前 ICQQ 与签名服务组合。

完整动作、消息段、平台扩展和错误契约见[包内 README](https://github.com/lc-cn/onebots/tree/master/adapters/adapter-icqq)。

## 相关链接

- [ICQQ 适配器配置](/config/adapter/icqq)
- [ICQQ GitHub](https://github.com/icqqjs/icqq)
- [unidbg-fetch-qsign](https://github.com/fuqiuluo/unidbg-fetch-qsign)
