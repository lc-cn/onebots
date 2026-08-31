import { ZulipError } from "./errors.js";
import type {
    ZulipEvent,
    ZulipEventsResponse,
    ZulipMessage,
    ZulipMessageResponse,
    ZulipQueueRegistration,
    ZulipSendMessageResponse,
    ZulipStreamsResponse,
    ZulipSubscribersResponse,
    ZulipUploadResponse,
    ZulipUser,
    ZulipUserResponse,
    ZulipUsersResponse,
} from "./types.js";

/** 解析当前 Bot 用户。 */
export function parseZulipUser(value: unknown): ZulipUser {
    if (!isZulipUser(value)) throw invalidResponse("用户");
    return value;
}

/** 解析单用户响应。 */
export function parseZulipUserResponse(value: unknown): ZulipUserResponse {
    if (!isUserResponse(value)) throw invalidResponse("单用户");
    return value;
}

/** 解析用户列表响应。 */
export function parseZulipUsersResponse(value: unknown): ZulipUsersResponse {
    if (!isUsersResponse(value)) throw invalidResponse("用户列表");
    return value;
}

/** 解析频道列表响应。 */
export function parseZulipStreamsResponse(value: unknown): ZulipStreamsResponse {
    if (!isStreamsResponse(value)) throw invalidResponse("频道列表");
    return value;
}

/** 解析频道订阅者响应。 */
export function parseZulipSubscribersResponse(value: unknown): ZulipSubscribersResponse {
    if (!isSubscribersResponse(value)) throw invalidResponse("频道订阅者");
    return value;
}

/** 解析单消息响应。 */
export function parseZulipMessageResponse(value: unknown): ZulipMessageResponse {
    if (!isMessageResponse(value)) throw invalidResponse("单消息");
    return value;
}

/** 解析消息列表响应。 */
export function parseZulipMessages(value: unknown): ZulipMessage[] {
    if (
        !isRecord(value) ||
        !Array.isArray(value.messages) ||
        !value.messages.every(isZulipMessage)
    ) {
        throw invalidResponse("消息列表");
    }
    return value.messages;
}

/** 解析发消息响应。 */
export function parseZulipSendMessageResponse(value: unknown): ZulipSendMessageResponse {
    if (!isSendMessageResponse(value)) throw invalidResponse("发送消息");
    return value;
}

/** 解析 Event Queue 注册响应。 */
export function parseZulipQueueRegistration(value: unknown): ZulipQueueRegistration {
    if (!isQueueRegistration(value)) throw invalidResponse("事件队列注册");
    return value;
}

/** 解析 Event Queue 拉取响应。 */
export function parseZulipEventsResponse(value: unknown): ZulipEventsResponse {
    if (!isEventsResponse(value)) throw invalidResponse("事件队列");
    return value;
}

/** 解析文件上传响应。 */
export function parseZulipUploadResponse(value: unknown): ZulipUploadResponse {
    if (!isEnvelope(value) || (typeof value.url !== "string" && typeof value.uri !== "string")) {
        throw invalidResponse("文件上传");
    }
    return {
        ...value,
        url: typeof value.url === "string" ? value.url : "",
        uri: typeof value.uri === "string" ? value.uri : undefined,
        filename: typeof value.filename === "string" ? value.filename : undefined,
    };
}

function isEnvelope(
    value: unknown,
): value is Record<string, unknown> & { result: "success"; msg: string } {
    return isRecord(value) && value.result === "success" && typeof value.msg === "string";
}

function isUserResponse(value: unknown): value is ZulipUserResponse {
    return isEnvelope(value) && isZulipUser(value.user);
}

function isUsersResponse(value: unknown): value is ZulipUsersResponse {
    return isEnvelope(value) && Array.isArray(value.members) && value.members.every(isZulipUser);
}

function isStreamsResponse(value: unknown): value is ZulipStreamsResponse {
    return isEnvelope(value) && Array.isArray(value.streams) && value.streams.every(isStream);
}

function isSubscribersResponse(value: unknown): value is ZulipSubscribersResponse {
    return (
        isEnvelope(value) &&
        Array.isArray(value.subscribers) &&
        value.subscribers.every(Number.isSafeInteger)
    );
}

function isMessageResponse(value: unknown): value is ZulipMessageResponse {
    return (
        isEnvelope(value) && isZulipMessage(value.message) && typeof value.raw_content === "string"
    );
}

function isSendMessageResponse(value: unknown): value is ZulipSendMessageResponse {
    return isEnvelope(value) && Number.isSafeInteger(value.id);
}

function isQueueRegistration(value: unknown): value is ZulipQueueRegistration {
    return (
        isEnvelope(value) &&
        typeof value.queue_id === "string" &&
        Number.isSafeInteger(value.last_event_id)
    );
}

function isEventsResponse(value: unknown): value is ZulipEventsResponse {
    return isEnvelope(value) && Array.isArray(value.events) && value.events.every(isZulipEvent);
}

function isZulipUser(value: unknown): value is ZulipUser {
    return (
        isRecord(value) &&
        Number.isSafeInteger(value.user_id) &&
        typeof value.email === "string" &&
        typeof value.full_name === "string"
    );
}

function isStream(value: unknown): value is ZulipStreamsResponse["streams"][number] {
    return (
        isRecord(value) && Number.isSafeInteger(value.stream_id) && typeof value.name === "string"
    );
}

function isZulipMessage(value: unknown): value is ZulipMessage {
    return (
        isRecord(value) &&
        Number.isSafeInteger(value.id) &&
        Number.isSafeInteger(value.sender_id) &&
        typeof value.sender_email === "string" &&
        typeof value.sender_full_name === "string" &&
        typeof value.content === "string" &&
        typeof value.timestamp === "number"
    );
}

function isZulipEvent(value: unknown): value is ZulipEvent {
    return isRecord(value) && Number.isSafeInteger(value.id) && typeof value.type === "string";
}

function invalidResponse(kind: string): ZulipError {
    return new ZulipError(`Zulip ${kind}响应结构无效`, { code: "ZULIP_INVALID_RESPONSE" });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
