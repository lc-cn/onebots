import { AdapterRegistry } from "onebots";
import type { Schema } from "onebots";

export type { WeComKfConfig } from "./types.js";
export * from "./adapter.js";
export * from "./bot.js";

const wecomKfSchema: Schema = {
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
};

AdapterRegistry.registerSchema("wecom-kf", wecomKfSchema);
