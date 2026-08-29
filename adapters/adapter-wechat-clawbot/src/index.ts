import { AdapterRegistry } from "onebots";
import type { Schema } from "onebots";

export type { WechatClawbotConfig, WechatIlinkRuntimeConfig } from "./types.js";
export * from "./adapter.js";
export * from "./capabilities.js";
export * from "./events.js";
export * from "./platform-actions.js";
export * from "./sdk/ilink-bot.js";
export * from "./sdk/ilink-types.js";
export {
    ensureWechatClawbotContextTokenTable,
    SqliteClawbotContextTokenStore,
    WECHAT_CLAWBOT_CONTEXT_TOKEN_TABLE,
} from "./context-token-store.js";
export type { ClawbotContextTokenStore } from "./context-token-store.js";

/** 配置表单字段（端点 / 扫码等见适配器约定，README） */
const WechatClawbotSchema: Schema = {
    account_id: {
        type: "string",
        required: true,
        label: "账号标识",
        description: "OneBots 内部稳定 ID；首次启动会弹出微信扫码验证",
        ui: { section: "credentials" },
    },
    qr_login_timeout_ms: {
        type: "number",
        default: 480000,
        min: 60000,
        label: "扫码总超时（毫秒）",
        ui: { section: "transport" },
    },
    polling_timeout_ms: {
        type: "number",
        min: 1000,
        label: "长轮询超时（毫秒）",
        description: "通常无需修改；上游也可能动态下发下一次超时",
        ui: { section: "advanced" },
    },
    polling_retry_initial_delay_ms: {
        type: "number",
        default: 1000,
        min: 100,
        label: "首次重试延迟（毫秒）",
        description: "网络异常后采用指数退避；此值是第一次重试的等待时间",
        ui: { section: "advanced" },
    },
    polling_retry_max_delay_ms: {
        type: "number",
        default: 30000,
        min: 1000,
        label: "最大重试延迟（毫秒）",
        ui: { section: "advanced" },
    },
};

AdapterRegistry.registerSchema("wechat-clawbot", WechatClawbotSchema);
