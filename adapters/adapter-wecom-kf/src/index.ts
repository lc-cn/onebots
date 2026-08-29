import { AdapterRegistry, type Schema } from "onebots";

export { WeComKfAdapter } from "./adapter.js";
export { weComKfCapabilities } from "./capabilities.js";
export { WeComKfClient } from "./client.js";
export type { WeComKfClientEvents } from "./client.js";
export { loadKfCursors, persistKfCursors } from "./cursor-store.js";
export { WeComKfError } from "./errors.js";
export { requireKfHttpsBase, resolveKfApiUrl } from "./http.js";
export { projectKfCallback, projectKfItem, projectKfSegments } from "./events.js";
export type { KfProjectionContext } from "./events.js";
export { compileKfMessages } from "./messages.js";
export type { KfOutboundMessage } from "./messages.js";
export { assertKfUploadSize, decodeKfBase64, MAX_KF_UPLOAD_BYTES } from "./media.js";
export { resolveKfMessageId } from "./message-id.js";
export { executeWeComKfPlatformAction, WECOM_KF_PLATFORM_ACTIONS } from "./platform-actions.js";
export { WeComKfWebhookHost } from "./webhook-host.js";
export type { WeComKfHttpContext } from "./webhook-host.js";
export type {
    KfAccount,
    KfApiResponse,
    KfCallOptions,
    KfCallbackEvent,
    KfCustomer,
    KfCustomerBatchGetResponse,
    KfMsgItem,
    KfSendMsgResponse,
    KfServiceStateResponse,
    KfSyncMsgRequest,
    KfSyncMsgResponse,
    KfTokenResponse,
    KfWebhookRequest,
    KfWebhookResponse,
    WeComKfConfig,
} from "./types.js";

const wecomKfSchema: Schema = {
    account_id: {
        type: "string",
        required: true,
        min: 1,
        label: "账号标识",
        description: "OneBots 内部区分微信客服实例的稳定标识",
    },
    corp_id: {
        type: "string",
        required: true,
        min: 1,
        label: "CorpID",
        description: "企业 ID，也是回调解密后的 receiveid 校验值",
        ui: { section: "credentials" },
    },
    corp_secret: {
        type: "string",
        required: true,
        min: 1,
        label: "微信客服 Secret",
        description: "微信客服 API 页面生成的 Secret，不是普通自建应用 Secret",
        sensitive: true,
        ui: { section: "credentials" },
    },
    token: {
        type: "string",
        required: true,
        min: 1,
        label: "回调 Token",
        sensitive: true,
        ui: { section: "transport" },
    },
    encoding_aes_key: {
        type: "string",
        required: true,
        min: 43,
        max: 43,
        label: "EncodingAESKey",
        sensitive: true,
        ui: { section: "transport" },
    },
    webhook_path: {
        type: "string",
        label: "Webhook 路径",
        placeholder: "/wecom-kf/{account_id}/webhook",
        description: "复用 OneBots 主 HTTP Host；留空按账号生成",
        ui: { section: "transport" },
    },
    open_kfid: {
        type: "string",
        label: "默认客服账号 ID",
        placeholder: "wk...",
        description: "无既有客户会话上下文时用于发送；回调中的账号优先",
        ui: { section: "delivery" },
    },
    cursor_store_path: {
        type: "string",
        label: "同步游标文件",
        placeholder: "./data/wecom-kf-cursor.json",
        description: "使用异步原子写入持久化各客服账号的 sync_msg 游标",
        ui: { section: "delivery" },
    },
    deduplicate_messages: {
        type: "boolean",
        default: true,
        label: "过滤重复消息",
        ui: { section: "delivery" },
    },
    message_deduplication_limit: {
        type: "number",
        default: 10000,
        min: 100,
        label: "消息去重缓存上限",
        ui: { section: "advanced" },
    },
    enable_sync_poll: {
        type: "boolean",
        default: false,
        label: "启用补偿轮询",
        description: "没有回调 Token 时主动 sync_msg；仅在确有需要时开启",
        ui: { section: "advanced" },
    },
    sync_poll_interval_ms: {
        type: "number",
        default: 30000,
        min: 5000,
        label: "轮询间隔（毫秒）",
        ui: { section: "advanced" },
    },
    api_base_url: {
        type: "string",
        default: "https://qyapi.weixin.qq.com",
        label: "API Base URL",
        description: "仅官方兼容 HTTPS 代理或测试入口需要覆盖",
        ui: { section: "advanced" },
    },
};

AdapterRegistry.registerSchema("wecom-kf", wecomKfSchema);
