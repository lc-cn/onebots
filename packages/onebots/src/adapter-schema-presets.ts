/**
 * 未在进程启动时通过 -r 加载的适配器，其 registerSchema 不会执行，
 * Web 管理端拉取 /api/config/schema 时 adapters 会缺项，导致无法选平台、无表单项。
 * 此处预设与各适配器 index.ts 中 registerSchema 保持一致（变更时请同步修改）。
 */
import type { Schema } from "@onebots/core";

export const ADAPTER_SCHEMA_PRESETS: Record<string, Schema> = {
    "wecom-kf": {
        account_id: { type: "string", required: true, label: "账号标识" },
        corp_id: { type: "string", required: true, label: "企业 ID" },
        corp_secret: { type: "string", required: true, label: "自建应用 Secret（已授权微信客服 API）" },
        token: { type: "string", required: true, label: "回调 Token" },
        encoding_aes_key: { type: "string", required: true, label: "EncodingAESKey" },
        open_kfid: { type: "string", label: "默认客服 open_kfid" },
        agent_id: { type: "string", label: "应用 AgentId（上传临时素材时必填）" },
        enable_sync_poll: { type: "boolean", label: "启用无 token 轮询 sync_msg（易触发频次限制）" },
        sync_poll_interval_ms: { type: "number", label: "轮询间隔（毫秒）" },
        cursor_store_path: { type: "string", label: "sync_msg 游标 JSON 文件路径" },
    },
    icqq: {
        account_id: { type: "string", required: true, label: "QQ 号" },
        password: { type: "string", label: "密码(可选/支持扫码)" },
        protocol: {
            platform: { type: "number", enum: [1, 2, 3, 4, 5, 6], default: 2, label: "登录平台" },
            ver: { type: "string", label: "APK 版本" },
            sign_api_addr: { type: "string", label: "签名服务器地址" },
            data_dir: { type: "string", label: "数据目录" },
            log_config: { type: "object", label: "log4js 配置" },
            ignore_self: { type: "boolean", default: true, label: "过滤自己消息" },
            resend: { type: "boolean", default: true, label: "风控分片发送" },
            reconn_interval: { type: "number", default: 5, label: "重连间隔(秒)" },
            cache_group_member: { type: "boolean", default: true, label: "缓存群员列表" },
            auto_server: { type: "boolean", default: true, label: "自动选择服务器" },
            ffmpeg_path: { type: "string", label: "ffmpeg 路径" },
            ffprobe_path: { type: "string", label: "ffprobe 路径" },
        },
    },
    line: {
        account_id: { type: "string", required: true, label: "账号标识" },
        channel_access_token: { type: "string", required: true, label: "Channel Access Token" },
        channel_secret: { type: "string", required: true, label: "Channel Secret" },
        proxy: {
            url: { type: "string", label: "代理地址" },
            username: { type: "string", label: "代理用户名" },
            password: { type: "string", label: "代理密码" },
        },
    },
    email: {
        account_id: { type: "string", required: true, label: "账号标识" },
        from: { type: "string", required: true, label: "发件人邮箱" },
        fromName: { type: "string", label: "发件人名称" },
        smtp: {
            host: { type: "string", required: true, label: "SMTP 主机" },
            port: { type: "number", default: 587, label: "SMTP 端口" },
            secure: { type: "boolean", default: true, label: "TLS" },
            requireTLS: { type: "boolean", default: true, label: "STARTTLS" },
            user: { type: "string", required: true, label: "SMTP 用户名" },
            password: { type: "string", required: true, label: "SMTP 密码" },
            proxy: {
                url: { type: "string", label: "代理地址" },
                username: { type: "string", label: "代理用户名" },
                password: { type: "string", label: "代理密码" },
            },
        },
        imap: {
            host: { type: "string", required: true, label: "IMAP 主机" },
            port: { type: "number", default: 993, label: "IMAP 端口" },
            tls: { type: "boolean", default: true, label: "TLS" },
            user: { type: "string", required: true, label: "IMAP 用户名" },
            password: { type: "string", required: true, label: "IMAP 密码" },
            proxy: {
                url: { type: "string", label: "代理地址" },
                username: { type: "string", label: "代理用户名" },
                password: { type: "string", label: "代理密码" },
            },
            pollInterval: { type: "number", default: 30000, label: "轮询间隔(毫秒)" },
            mailbox: { type: "string", default: "INBOX", label: "邮箱文件夹" },
        },
    },
    whatsapp: {
        account_id: { type: "string", required: true, label: "账号标识" },
        businessAccountId: { type: "string", required: true, label: "Business Account ID" },
        phoneNumberId: { type: "string", required: true, label: "Phone Number ID" },
        accessToken: { type: "string", required: true, label: "Access Token" },
        webhookVerifyToken: { type: "string", required: true, label: "Webhook 验证令牌" },
        apiVersion: { type: "string", default: "v21.0", label: "API 版本" },
        proxy: {
            url: { type: "string", label: "代理地址" },
            username: { type: "string", label: "代理用户名" },
            password: { type: "string", label: "代理密码" },
        },
        webhook: {
            url: { type: "string", label: "Webhook URL" },
            fields: { type: "array", label: "订阅字段" },
        },
    },
    zulip: {
        account_id: { type: "string", required: true, label: "账号标识" },
        serverUrl: { type: "string", required: true, label: "服务器地址" },
        email: { type: "string", required: true, label: "邮箱地址" },
        apiKey: { type: "string", required: true, label: "API Key" },
        proxy: {
            url: { type: "string", label: "代理地址" },
            username: { type: "string", label: "代理用户名" },
            password: { type: "string", label: "代理密码" },
        },
        websocket: {
            enabled: { type: "boolean", default: true, label: "启用 WebSocket" },
            reconnectInterval: { type: "number", default: 3000, label: "重连间隔(毫秒)" },
            maxReconnectAttempts: { type: "number", default: 10, label: "最大重连次数" },
        },
    },
    mock: {
        account_id: { type: "string", required: true, label: "账号标识" },
        nickname: { type: "string", label: "用户名" },
        avatar: { type: "string", label: "头像 URL" },
        auto_events: { type: "boolean", label: "自动生成事件" },
        event_interval: { type: "number", label: "事件间隔(毫秒)" },
        latency: { type: "number", label: "模拟延迟(毫秒)" },
        friends: { type: "array", label: "预定义好友列表" },
        groups: { type: "array", label: "预定义群组列表" },
    },
};
