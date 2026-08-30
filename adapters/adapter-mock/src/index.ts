import { AdapterRegistry } from "onebots";
import type { Schema } from "onebots";

export type {
    MockAutoEventType,
    MockConfig,
    MockUser,
    MockGroup,
    MockMember,
    MockMessage,
    MockEvent,
    MockFriendRequest,
    MockHeartbeat,
    MockInboundEvent,
    MockInboundEventMap,
    MockIncomingMessage,
    MockMessageSent,
    MockReadyUser,
} from "./types.js";
export * from "./adapter.js";
export { mockCapabilities } from "./capabilities.js";
export { MockBot } from "./bot.js";
export type { MockBotEvents, MockBotOptions } from "./bot.js";
export { MockError } from "./errors.js";
export { createMockDataset, type MockDataset } from "./fixtures.js";
export { projectMockHeartbeat, projectMockMessage, projectMockRequest } from "./events.js";
export { compileMockMessage } from "./messages.js";
export {
    assertMockHeartbeat,
    assertMockMessage,
    assertMockRequest,
    cloneMockGroup,
    createMockRandom,
    validateMockConfig,
} from "./runtime.js";

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
        ui: { section: "advanced", visibleWhen: { path: "auto_events", oneOf: [true] } },
    },
    latency: {
        type: "number",
        default: 10,
        min: 0,
        label: "模拟延迟（毫秒）",
        ui: { section: "advanced" },
    },
    random_seed: {
        type: "number",
        label: "自动事件随机种子",
        description: "相同种子与模拟数据会得到相同的事件选择序列",
        ui: { section: "advanced", visibleWhen: { path: "auto_events", oneOf: [true] } },
    },
    auto_event_types: {
        type: "array",
        label: "自动事件类型",
        description: "留空时覆盖私聊、群聊、好友请求和心跳",
        choices: [
            { label: "私聊消息", value: "private_message" },
            { label: "群聊消息", value: "group_message" },
            { label: "好友请求", value: "friend_request" },
            { label: "心跳", value: "heartbeat" },
        ],
        ui: {
            section: "advanced",
            widget: "choice-list",
            itemLabel: "事件类型",
            addLabel: "添加事件类型",
            visibleWhen: { path: "auto_events", oneOf: [true] },
        },
    },
    friends: {
        type: "array",
        label: "预定义好友",
        ui: {
            section: "advanced",
            widget: "record-list",
            itemLabel: "好友",
            addLabel: "添加好友",
            fields: [
                { key: "user_id", label: "用户 ID", placeholder: "10001" },
                { key: "nickname", label: "昵称", placeholder: "测试好友" },
                { key: "avatar", label: "头像 URL" },
                { key: "remark", label: "备注" },
            ],
        },
    },
    groups: {
        type: "array",
        label: "预定义群组",
        description: "成员数组会在保存时保留；基础资料可直接增删编辑",
        ui: {
            section: "advanced",
            widget: "record-list",
            itemLabel: "群组",
            addLabel: "添加群组",
            fields: [
                { key: "group_id", label: "群 ID", placeholder: "100001" },
                { key: "group_name", label: "群名称", placeholder: "测试群" },
                { key: "member_count", label: "成员数", type: "number" },
                { key: "max_member_count", label: "成员上限", type: "number" },
            ],
        },
    },
};

AdapterRegistry.registerSchema("mock", mockSchema);
