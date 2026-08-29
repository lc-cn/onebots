# @onebots/adapter-icqq

基于 ICQQ 的 QQ 个人账号适配器。适配器使用严格类型构建，并将消息、事件、群管理、QQ 频道、文件和 ICQQ 原生扩展动作统一暴露给 OneBots 协议层。

## 📦 安装

### 1. 配置 GitHub Packages 访问

由于 `@icqqjs/icqq` 是托管在 GitHub Packages 的私有包，需要先配置访问权限。

在项目根目录的 `.npmrc` 文件中添加：

```
@icqqjs:registry=https://npm.pkg.github.com
```

### 2. 登录 GitHub Packages

```bash
npm login --scope=@icqqjs --auth-type=legacy --registry=https://npm.pkg.github.com
```

- **UserName**: 你的 GitHub 账号
- **Password**: 前往 https://github.com/settings/tokens/new 获取，scopes 勾选 `read:packages`
- **E-Mail**: 你的公开邮箱地址

### 3. 安装依赖

```bash
npm install @onebots/adapter-icqq
# 或
pnpm add @onebots/adapter-icqq
```

## ⚙️ 配置

在 `config.yaml` 中配置 ICQQ 账号：

```yaml
# ICQQ 机器人账号配置
icqq.123456789: # 你的 QQ 号
  # 密码登录（可选，不填则扫码登录）
  password: "your_password"

  # 协议配置
  protocol:
    # 登录平台: 1=安卓手机, 2=安卓平板, 3=安卓手表, 4=MacOS, 5=iPad, 6=Tim
    platform: 2
    # 签名服务器地址（重要！未配置可能导致登录失败）
    sign_api_addr: "http://your-sign-server:8080"
    # 数据存储目录
    data_dir: "./data/icqq"
    # 群聊和频道中过滤自己的消息
    ignore_self: true
    # 被风控时是否尝试用分片发送
    resend: true
    # 触发离线事件后的重新登录间隔秒数
    reconn_interval: 5
    # 是否缓存群员列表
    cache_group_member: true
    # 自动选择最优服务器
    auto_server: true

  # OneBot V11 协议配置
  onebot.v11:
    access_token: "your_v11_token"

  # OneBot V12 协议配置
  onebot.v12:
    access_token: "your_v12_token"
```

## 📋 配置项说明

### 基础配置

| 配置项     | 类型   | 必填 | 说明                    |
| ---------- | ------ | ---- | ----------------------- |
| `password` | string | 否   | QQ 密码，不填则扫码登录 |
| `protocol` | object | 否   | 协议配置                |

Web 管理端会根据 Schema 将账号凭据、连接、消息过滤、发送策略和高级设置分区展示；密码使用敏感输入框，不需要编辑原始 JSON。

### 协议配置 (protocol)

| 配置项               | 类型    | 默认值   | 说明                       |
| -------------------- | ------- | -------- | -------------------------- |
| `platform`           | number  | 2        | 登录平台                   |
| `sign_api_addr`      | string  | -        | 签名服务器地址             |
| `data_dir`           | string  | `./data` | 数据存储目录               |
| `ignore_self`        | boolean | true     | 群聊和频道中过滤自己的消息 |
| `resend`             | boolean | true     | 被风控时是否尝试用分片发送 |
| `reconn_interval`    | number  | 5        | 重新登录间隔秒数           |
| `cache_group_member` | boolean | true     | 是否缓存群员列表           |
| `auto_server`        | boolean | true     | 自动选择最优服务器         |
| `ffmpeg_path`        | string  | -        | ffmpeg 路径                |
| `ffprobe_path`       | string  | -        | ffprobe 路径               |

### 登录平台 (platform)

| 值  | 平台             |
| --- | ---------------- |
| 1   | 安卓手机         |
| 2   | 安卓平板（推荐） |
| 3   | 安卓手表         |
| 4   | MacOS            |
| 5   | iPad             |
| 6   | Tim              |

## 🔐 签名服务器

ICQQ 协议需要签名服务器才能正常登录和收发消息。签名服务器的部署请参考：

- [unidbg-fetch-qsign](https://github.com/fuqiuluo/unidbg-fetch-qsign)
- 其他兼容的签名服务

配置示例：

```yaml
protocol:
  sign_api_addr: "http://127.0.0.1:8080"
```

## 🚀 使用示例

### 启动服务

```bash
# 注册 ICQQ 适配器和 OneBot V11 协议
onebots -r icqq -p onebot.v11
```

### 扫码登录

如果不配置密码，启动时会提示扫码登录。控制台会输出二维码图片路径或显示二维码。

### 滑块验证

如果触发滑块验证，控制台会输出验证链接，需要手动完成验证后将 ticket 提交。

### 设备锁验证

如果触发设备锁验证，控制台会输出验证链接和手机号，需要手动完成验证。

## 📝 支持的功能

### 消息类型

| 类型           | 发送 | 接收 | 说明                                      |
| -------------- | :--: | :--: | ----------------------------------------- |
| 文本           |  ✅  |  ✅  | 纯文本消息                                |
| 表情           |  ✅  |  ✅  | QQ 表情                                   |
| 图片           |  ✅  |  ✅  | 图片消息                                  |
| 语音           |  ✅  |  ✅  | 语音消息                                  |
| 视频           |  ✅  |  ✅  | 视频消息                                  |
| @提及          |  ✅  |  ✅  | @某人或@全体                              |
| 回复           |  ✅  |  ✅  | 引用回复                                  |
| 分享           |  ✅  |  ✅  | 链接分享                                  |
| JSON           |  ✅  |  ✅  | JSON 卡片                                 |
| XML            |  ✅  |  ✅  | XML 卡片                                  |
| ICQQ 原生元素  |  ✅  |  -   | 使用 `icqq` 段受控传入 ICQQ `MessageElem` |
| 未识别原生元素 |  -   |  ✅  | 使用 `icqq_raw` 段保真返回，不伪装成文本  |

### API 功能

ICQQ 的能力通过统一 Adapter 接口暴露，协议层只会调用当前适配器真实声明为可用的动作。

| 分类    | 已支持能力                                                                                           |
| ------- | ---------------------------------------------------------------------------------------------------- |
| 消息    | 私聊、群聊与 QQ 频道发送，撤回、获取、历史记录、合并转发、标记已读                                   |
| 好友    | 列表、资料、删除、戳一戳、点赞、申请列表、处理申请                                                   |
| 群组    | 群与成员资料、邀请、踢人、禁言、全员禁言、匿名控制、管理员、名片、头衔、戳一戳、头像、申请列表与处理 |
| 群内容  | 公告、消息表态、设置与删除精华消息                                                                   |
| QQ 频道 | 频道列表与资料、频道成员列表与资料、子频道列表与资料                                                 |
| 文件    | 私聊/群文件上传与删除、群目录读取与管理、移动与重命名、下载地址                                      |
| 系统    | 状态、版本、Cookies、CSRF、凭据、媒体发送能力、清理缓存                                              |

权限受限动作仍可能被 QQ 服务端拒绝；适配器会把失败作为错误返回，不会伪造成功响应。`leave_group` 仅表示主动退群，ICQQ 本身没有对应的群解散调用，因此 `is_dismiss: true` 会被明确拒绝。

标准 `upload_file` 与 Milky 文件 URI 对齐，支持 HTTP(S)、本地路径/`file://` 和 Base64；所有来源在进入 ICQQ 上传前统一执行严格解码、空内容检查及安全文件名处理。

账号客户端采用 generation 隔离：并发启动只创建一个 ICQQ Client，停止或快速重启后，旧客户端迟到的上线、离线、登录失败和心跳回调都不会覆盖新状态。

### ICQQ 原生扩展动作

通用 Adapter 无法准确表达的能力通过 `executePlatformAction()` 暴露，并全部进入能力清单。主要包括：

| 分类       | 扩展动作                                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| 账号与状态 | Client Key、PSKey、NT 图片 RKey、在线状态、运行统计、UID/UIN 转换                                                       |
| 账号资料   | 获取资料、修改昵称/性别/生日/说明/签名/头像                                                                             |
| 好友与资源 | 好友分组管理、备注/分组设置、加好友策略、共群查询、漫游表情、陌生人列表、图片 OCR、视频地址                             |
| 群与频道   | 群签到、群分享、加群策略、群备注、发言限频、@全体余量、禁言名单、匿名身份、成员消息屏蔽、从群添加好友、频道帖子分享地址 |
| 消息       | 群临时消息、讨论组消息、删除群消息表态                                                                                  |
| 缓存同步   | 重载好友、陌生人、群、频道和黑名单                                                                                      |

扩展动作的参数名沿用 ICQQ 语义，并在调用底层客户端前严格验证类型。QQ 号与群号同时接受安全整数和纯数字字符串，便于 OneBot v11/v12、Milky 使用各自 canonical ID 类型。可通过 `get_supported_actions` 获取当前版本的完整动作名，避免依赖文档中的静态清单。

### 事件支持

| 事件                  | 支持 | 说明                                                    |
| --------------------- | :--: | ------------------------------------------------------- |
| 私聊/群消息           |  ✅  | 保留 `raw_event`，群消息附带 ICQQ 发送者与 `at_me` 扩展 |
| 好友申请、群申请/邀请 |  ✅  | opaque `flag` 原样保留，可直接用于处理申请              |
| 群成员增加/减少       |  ✅  | 区分主动退出、被踢、机器人被踢，并保留群解散标记        |
| 群禁言与管理员变更    |  ✅  | 包含操作者、目标成员和禁言时长                          |
| 好友/群消息撤回       |  ✅  | 统一投影为 `message_deleted`                            |
| 好友/群戳一戳         |  ✅  | 统一投影为 `interaction`                                |

所有标准事件都携带原始 ICQQ 事件；标准字段暂时无法覆盖的新字段不会在投影时丢失。

## ⚠️ 注意事项

1. **签名服务器必须配置**：ICQQ 协议需要签名服务器才能正常工作
2. **账号安全**：建议使用小号测试，避免账号被封禁风险
3. **协议更新**：QQ 协议可能随时更新，如遇问题请更新 ICQQ 和签名服务
4. **数据目录**：建议配置独立的 `data_dir`，避免数据混乱

## 🔗 相关链接

- [ICQQ GitHub](https://github.com/icqqjs/icqq)
- [onebots 文档](https://onebots.dev)
- [签名服务部署教程](https://github.com/fuqiuluo/unidbg-fetch-qsign)
