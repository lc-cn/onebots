# @onebots/adapter-icqq

onebots ICQQ 适配器 - 基于 ICQQ 协议的 QQ 机器人

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

| 类型  | 发送 | 接收 | 说明         |
| ----- | :--: | :--: | ------------ |
| 文本  |  ✅  |  ✅  | 纯文本消息   |
| 表情  |  ✅  |  ✅  | QQ 表情      |
| 图片  |  ✅  |  ✅  | 图片消息     |
| 语音  |  ✅  |  ✅  | 语音消息     |
| 视频  |  ✅  |  ✅  | 视频消息     |
| @提及 |  ✅  |  ✅  | @某人或@全体 |
| 回复  |  ✅  |  ✅  | 引用回复     |
| 分享  |  ✅  |  ✅  | 链接分享     |
| JSON  |  ✅  |  ✅  | JSON 卡片    |
| XML   |  ✅  |  ✅  | XML 卡片     |

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

权限受限动作仍可能被 QQ 服务端拒绝；适配器会把失败作为错误返回，不会伪造成功响应。当前未暴露的 ICQQ 特有能力（例如账号资料写入、好友分组和 OCR）不会被能力清单宣称为已支持。

### 事件支持

| 事件        | 支持 | 说明 |
| ----------- | :--: | ---- |
| 私聊消息    |  ✅  |      |
| 群消息      |  ✅  |      |
| 好友申请    |  ✅  |      |
| 群申请/邀请 |  ✅  |      |
| 群成员增加  |  ✅  |      |
| 群成员减少  |  ✅  |      |

## ⚠️ 注意事项

1. **签名服务器必须配置**：ICQQ 协议需要签名服务器才能正常工作
2. **账号安全**：建议使用小号测试，避免账号被封禁风险
3. **协议更新**：QQ 协议可能随时更新，如遇问题请更新 ICQQ 和签名服务
4. **数据目录**：建议配置独立的 `data_dir`，避免数据混乱

## 🔗 相关链接

- [ICQQ GitHub](https://github.com/icqqjs/icqq)
- [onebots 文档](https://onebots.dev)
- [签名服务部署教程](https://github.com/fuqiuluo/unidbg-fetch-qsign)
