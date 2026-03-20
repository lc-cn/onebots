# @onebots/adapter-wecom-kf

OneBots 适配 **企业微信 · 微信客服**（[官方文档概述](https://developer.work.weixin.qq.com/document/path/94638)）：通过回调 `kf_msg_or_event` 触发 **`sync_msg` 拉取消息**，使用 **`send_msg`** 主动回复。

与 `@onebots/adapter-wecom`（自建应用 `/cgi-bin/message/send`）**不是**同一套 API，请勿混用。

## 前置条件

1. 企业已开通 **微信客服**，并在 **应用管理 → 微信客服 → API** 中为 **自建应用** 勾选「可调用接口的应用」。
2. 在 **通过 API 管理微信客服账号** 中，将需要机器人托管的客服号改为 API 管理（原生接待规则将暂停，需自行 `sync_msg` / `send_msg`）。
3. 客服账号的 **接待人员** 必须在自建应用 **可见范围** 内，否则常见错误 **`60030`**。

## 安装

```bash
pnpm add @onebots/adapter-wecom-kf
# 依赖主包 onebots
```

## 启动

```bash
npx onebots -r wecom-kf -p onebot-v11 -c config.yaml
```

## 配置示例 `config.yaml`

```yaml
wecom-kf.mykf:
  corp_id: 'wwxxxxxxxx'
  corp_secret: '应用Secret'
  token: '回调Token'
  encoding_aes_key: 'EncodingAESKey'
  open_kfid: 'wkxxxx'   # 默认客服账号，回调中的 OpenKfId 优先
  agent_id: '1000001'   # 发送图片/文件等需先上传临时素材时填写
  cursor_store_path: './data/wecom-kf-cursor.json'  # 可选，持久化 sync_msg 游标
  enable_sync_poll: false   #  true：无 token 定时 sync_msg（易触发频次限制）
  sync_poll_interval_ms: 30000
  onebot.v11:
    access_token: 'your_token'
```

## 回调 URL

在微信客服 / 接收消息 中填写（将 `account_id` 换成配置键名，如 `mykf`）：

```text
https://你的域名/wecom-kf/mykf/webhook
```

需同时支持 **GET**（URL 校验）与 **POST**（`Encrypt` 密文）。

### 可信域名校验文件（如 `WW_verify_xxx.txt`）

企业微信要求校验文件能通过 **站点根路径** 下载。在 OneBots 全局配置中设置 `public_static_dir`（例如 `static`），将 txt 放在该目录下即可由网关对外提供；Docker 可将文件放入挂载卷内的 `/data/static`。

## 消息流说明

1. 企业微信 POST 密文事件，解密后若为 `kf_msg_or_event`，从 XML 取 `Token`、`OpenKfId`。
2. 使用 `sync_msg`（带 `token` + `open_kfid` + 本地 `cursor`）分页拉取 **`msg_list`**。
3. 将 **客户消息**（`origin === 3`）与 **接待人员消息**（`origin === 5`）转为 OneBots `message`；`msgtype === event` 转为 `notice`（`notice_type: custom`）。
4. 回复：协议层 `sendMessage` → `send_msg`（`touser` 为 `external_userid`）。

受限于微信客服规则：用户发消息后 **48 小时内**、最多 **5 条** 等限制以官方最新文档为准。

## Bot 进阶 API

`Account` 的 `client` 为 `WeComKfBot`，还可调用：

- `serviceStateGet` / `serviceStateTrans`（[会话分配](https://developer.work.weixin.qq.com/document/path/94669)）
- `customerBatchGet`（[客户基础信息](https://developer.work.weixin.qq.com/document/path/95159)）

## 相关链接

- [接收消息和事件 / sync_msg](https://developer.work.weixin.qq.com/document/path/94670)
- [发送消息 send_msg](https://developer.work.weixin.qq.com/document/path/94677)
