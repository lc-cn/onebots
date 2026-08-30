import { AdapterRegistry, type Schema } from "onebots";
import { ZULIP_EVENT_TYPE_LABELS } from "./event-metadata.js";
import { ZULIP_EVENT_TYPES } from "./types.js";

export { ZulipAdapter } from "./adapter.js";
export { ZulipClient, type ZulipClientEvents, type ZulipClientOptions } from "./client.js";
export { assertZulipConfig, resolveZulipReceiveMode } from "./config.js";
export { zulipCapabilities } from "./capabilities.js";
export { ZulipError } from "./errors.js";
export { projectZulipEvents, projectZulipMessage } from "./events.js";
export { compileZulipMessage, type ZulipMessageCompiler } from "./messages.js";
export {
    executeZulipPlatformAction,
    ZULIP_PLATFORM_ACTIONS,
    type ZulipPlatformAction,
} from "./platform-actions.js";
export type { ZulipTransport, ZulipHttpRequest } from "./http.js";
export type * from "./types.js";

export const zulipSchema: Schema = {
    account_id: {
        type: "string",
        required: true,
        label: "账号标识",
        description: "OneBots 内部使用的稳定账号 ID",
        ui: { section: "credentials" },
    },
    receive_mode: {
        type: "string",
        default: "event_queue",
        label: "事件接收方式",
        choices: [
            { value: "event_queue", label: "Zulip Event Queue" },
            { value: "manual", label: "手动接入已有事件源" },
        ],
        description: "manual 不注册事件队列，由现有连接调用 ZulipClient.ingest()",
        ui: { section: "transport" },
    },
    server_url: {
        type: "string",
        required: true,
        label: "Zulip 组织地址",
        placeholder: "https://chat.zulip.org",
        pattern:
            /^(?:https:\/\/[^\s]+|http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/[^\s]*)?)$/,
        ui: { section: "credentials" },
    },
    email: {
        type: "string",
        required: true,
        label: "Bot API 邮箱",
        placeholder: "bot@example.zulipchat.com",
        ui: { section: "credentials" },
    },
    api_key: {
        type: "string",
        required: true,
        label: "Bot API Key",
        sensitive: true,
        ui: { section: "credentials" },
    },
    default_topic: {
        type: "string",
        default: "general",
        label: "默认话题",
        description: "发送目标只有频道 ID 时使用；事件回复会保留原话题",
        ui: { section: "delivery" },
    },
    event_queue: {
        event_types: {
            type: "array",
            label: "事件类型",
            description: "留空使用适配器的消息、反应、成员、频道和状态事件集合",
            choices: ZULIP_EVENT_TYPES.map(value => ({
                label: ZULIP_EVENT_TYPE_LABELS[value] || value,
                value,
            })),
            ui: {
                section: "filter",
                widget: "choice-list",
                visibleWhen: { path: "receive_mode", oneOf: ["event_queue"] },
            },
        },
        all_public_streams: {
            type: "boolean",
            default: false,
            label: "接收所有公共频道",
            description: "开启后接收 Bot 未订阅但有权访问的公共频道消息",
            ui: {
                section: "filter",
                visibleWhen: { path: "receive_mode", oneOf: ["event_queue"] },
            },
        },
        retry_initial_delay_ms: {
            type: "number",
            min: 100,
            default: 1000,
            label: "初始重试延迟（毫秒）",
            ui: {
                section: "advanced",
                visibleWhen: { path: "receive_mode", oneOf: ["event_queue"] },
            },
        },
        retry_max_delay_ms: {
            type: "number",
            min: 1000,
            default: 30000,
            label: "最大重试延迟（毫秒）",
            ui: {
                section: "advanced",
                visibleWhen: { path: "receive_mode", oneOf: ["event_queue"] },
            },
        },
    },
    proxy: {
        url: {
            type: "string",
            label: "代理地址",
            placeholder: "http://127.0.0.1:7890",
            ui: { section: "advanced" },
        },
        username: {
            type: "string",
            label: "代理用户名",
            ui: { section: "advanced" },
        },
        password: {
            type: "string",
            label: "代理密码",
            sensitive: true,
            ui: { section: "advanced" },
        },
    },
};

AdapterRegistry.registerSchema("zulip", zulipSchema);
