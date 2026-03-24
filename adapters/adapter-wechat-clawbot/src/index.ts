import { AdapterRegistry } from "onebots";
import type { Schema } from "onebots";

export type { WechatIlinkConfig } from "./types.js";
export * from "./adapter.js";
export * from "./bot.js";
export {
    ensureWechatClawbotContextTokenTable,
    SqliteClawbotContextTokenStore,
    WECHAT_CLAWBOT_CONTEXT_TOKEN_TABLE,
} from "./context-token-store.js";
export type { ClawbotContextTokenStore } from "./context-token-store.js";

/** 配置表单字段（端点 / 扫码等见适配器约定，README） */
const WechatClawbotSchema: Schema = {
    account_id: { type: "string", required: true, label: "账号标识" },
    qr_login_timeout_ms: { type: "number", default: 480000, label: "扫码总超时（毫秒）" },
    polling_timeout_ms: { type: "number", label: "getupdates 长轮询超时（毫秒）" },
    polling_retry_delay_ms: { type: "number", label: "轮询错误重试间隔（毫秒）" },
};

AdapterRegistry.registerSchema("wechat-clawbot", WechatClawbotSchema);
