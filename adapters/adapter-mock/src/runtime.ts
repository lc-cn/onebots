import { MockError } from "./errors.js";
import type {
    MockAutoEventType,
    MockConfig,
    MockFriendRequest,
    MockGroup,
    MockHeartbeat,
    MockIncomingMessage,
    MockMessage,
} from "./types.js";

const AUTO_EVENT_TYPES = new Set<MockAutoEventType>([
    "private_message",
    "group_message",
    "friend_request",
    "heartbeat",
]);

export function validateMockConfig(config: MockConfig): void {
    if (!config.account_id)
        throw new MockError("Mock account_id 不能为空", { code: "MOCK_INVALID_CONFIG" });
    for (const [field, value] of [
        ["latency", config.latency],
        ["event_interval", config.event_interval],
    ] as const) {
        if (value !== undefined && (!Number.isSafeInteger(value) || value < 0))
            throw new MockError(`Mock ${field} 必须是非负整数`, {
                code: "MOCK_INVALID_CONFIG",
            });
    }
    if (config.event_interval === 0)
        throw new MockError("Mock event_interval 必须大于 0", { code: "MOCK_INVALID_CONFIG" });
    if (config.random_seed !== undefined && !Number.isSafeInteger(config.random_seed))
        throw new MockError("Mock random_seed 必须是安全整数", { code: "MOCK_INVALID_CONFIG" });
    if (config.auto_event_types?.some(type => !AUTO_EVENT_TYPES.has(type)))
        throw new MockError("Mock auto_event_types 包含未知事件类型", {
            code: "MOCK_INVALID_CONFIG",
            details: config.auto_event_types,
        });
    validateUsers(config.friends);
    validateGroups(config.groups);
}

export function createMockRandom(seed: number | undefined): () => number {
    if (seed === undefined) return Math.random;
    let state = seed >>> 0;
    return () => {
        state += 0x6d2b79f5;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

export function cloneMockGroup(group: MockGroup): MockGroup {
    return {
        ...group,
        members: group.members?.map(member => ({ ...member })),
    };
}

export function collectMockMessages(
    ids: ReadonlySet<string>,
    messages: ReadonlyMap<string, MockMessage>,
): MockMessage[] {
    const result: MockMessage[] = [];
    for (const id of ids) {
        const message = messages.get(id);
        if (message) result.push({ ...message });
    }
    return result;
}

export function assertMockMessage(event: unknown): asserts event is MockIncomingMessage {
    if (
        !isRecord(event) ||
        (event.type !== "private" && event.type !== "group") ||
        typeof event.message_id !== "string" ||
        !event.message_id ||
        typeof event.user_id !== "string" ||
        !event.user_id ||
        typeof event.content !== "string" ||
        typeof event.time !== "number" ||
        !Number.isFinite(event.time) ||
        (event.nickname !== undefined && typeof event.nickname !== "string") ||
        (event.group_name !== undefined && typeof event.group_name !== "string") ||
        (event.type === "group" && (typeof event.group_id !== "string" || !event.group_id))
    )
        throw invalidEvent("消息", event);
}

export function assertMockRequest(event: unknown): asserts event is MockFriendRequest {
    if (
        !isRecord(event) ||
        event.type !== "friend" ||
        typeof event.user_id !== "string" ||
        !event.user_id ||
        typeof event.flag !== "string" ||
        !event.flag ||
        (event.nickname !== undefined && typeof event.nickname !== "string") ||
        (event.comment !== undefined && typeof event.comment !== "string") ||
        (event.time !== undefined &&
            (typeof event.time !== "number" || !Number.isFinite(event.time)))
    )
        throw invalidEvent("好友请求", event);
}

export function assertMockHeartbeat(event: unknown): asserts event is MockHeartbeat {
    if (!isRecord(event) || typeof event.time !== "number" || !Number.isFinite(event.time))
        throw invalidEvent("心跳", event);
}

function invalidEvent(kind: string, details: unknown): MockError {
    return new MockError(`Mock ${kind}事件结构无效`, {
        code: "MOCK_INVALID_EVENT",
        details,
    });
}

function validateUsers(users: MockConfig["friends"]): void {
    if (
        users?.some(
            user =>
                !isRecord(user) ||
                typeof user.user_id !== "string" ||
                !user.user_id ||
                typeof user.nickname !== "string" ||
                !user.nickname,
        )
    )
        throw invalidConfig("friends 必须是包含 user_id 与 nickname 的对象列表", users);
}

function validateGroups(groups: MockConfig["groups"]): void {
    if (
        groups?.some(
            group =>
                !isRecord(group) ||
                typeof group.group_id !== "string" ||
                !group.group_id ||
                typeof group.group_name !== "string" ||
                !group.group_name ||
                !isOptionalNonNegativeInteger(group.member_count) ||
                !isOptionalNonNegativeInteger(group.max_member_count) ||
                group.members?.some(
                    member =>
                        !isRecord(member) ||
                        typeof member.user_id !== "string" ||
                        !member.user_id ||
                        typeof member.nickname !== "string" ||
                        !member.nickname ||
                        (member.role !== "owner" &&
                            member.role !== "admin" &&
                            member.role !== "member"),
                ) === true,
        )
    )
        throw invalidConfig("groups 包含无效群组或成员资料", groups);
}

function isOptionalNonNegativeInteger(value: unknown): boolean {
    return (
        value === undefined ||
        (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    );
}

function invalidConfig(message: string, details: unknown): MockError {
    return new MockError(`Mock ${message}`, {
        code: "MOCK_INVALID_CONFIG",
        details,
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
