import { AdapterRegistry } from "onebots";
import type { Schema } from "onebots";

export type {
    MockConfig,
    MockUser,
    MockGroup,
    MockMember,
    MockMessage,
    MockEvent,
} from "./types.js";
export * from "./adapter.js";
export { MockBot } from "./bot.js";

export const mockSchema: Schema = {
    account_id: {
        type: "string",
        required: true,
        label: "账号标识",
        ui: { section: "credentials" },
    },
    nickname: { type: "string", label: "机器人昵称", ui: { section: "credentials" } },
    avatar: { type: "string", label: "头像 URL", ui: { section: "credentials" } },
    auto_events: {
        type: "boolean",
        default: false,
        label: "自动生成事件",
        ui: { section: "delivery" },
    },
    event_interval: {
        type: "number",
        default: 5000,
        min: 1,
        label: "事件间隔（毫秒）",
        ui: { section: "advanced" },
    },
    latency: {
        type: "number",
        default: 10,
        min: 0,
        label: "模拟延迟（毫秒）",
        ui: { section: "advanced" },
    },
    friends: { type: "array", label: "预定义好友", ui: { section: "advanced" } },
    groups: { type: "array", label: "预定义群组", ui: { section: "advanced" } },
};

AdapterRegistry.registerSchema("mock", mockSchema);
