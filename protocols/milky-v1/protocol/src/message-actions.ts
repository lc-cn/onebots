import { type Adapter, requireNonEmptyStringParam, requirePositiveIntegerParam } from "onebots";
import { projectMilkyIncomingMessage } from "./message-entities.js";
import { compileMilkySegments, projectMilkySegments } from "./message-segments.js";
import type { Milky } from "./types.js";

export const MILKY_MESSAGE_ACTIONS = new Set([
    "send_private_message",
    "send_group_message",
    "recall_private_message",
    "recall_group_message",
    "get_message",
    "get_history_messages",
    "get_resource_temp_url",
    "get_forwarded_messages",
    "mark_message_as_read",
]);

/** 封装 Milky 消息场景、游标、段编解码与实体补全。 */
export async function executeMilkyMessageAction(
    adapter: Adapter,
    accountId: string,
    action: string,
    params: Record<string, unknown>,
): Promise<unknown> {
    switch (action) {
        case "send_private_message":
            return sendMessage(adapter, accountId, "private", params);
        case "send_group_message":
            return sendMessage(adapter, accountId, "group", params);
        case "recall_private_message":
            return recallMessage(adapter, accountId, "private", params);
        case "recall_group_message":
            return recallMessage(adapter, accountId, "group", params);
        case "get_message":
            return getMessage(adapter, accountId, params);
        case "get_history_messages":
            return getHistoryMessages(adapter, accountId, params);
        case "get_resource_temp_url":
            return getResourceTempUrl(adapter, accountId, params);
        case "get_forwarded_messages":
            return getForwardedMessages(adapter, accountId, params);
        case "mark_message_as_read":
            return markMessageAsRead(adapter, accountId, params);
        default:
            throw new TypeError(`未知 Milky 消息动作: ${action}`);
    }
}

async function sendMessage(
    adapter: Adapter,
    accountId: string,
    scene: "private" | "group",
    params: Record<string, unknown>,
): Promise<Milky.SendMessageResult> {
    const sceneKey = scene === "private" ? "user_id" : "group_id";
    const result = await adapter.sendMessage(accountId, {
        scene_type: scene,
        scene_id: adapter.resolveId(requirePositiveIntegerParam(params, sceneKey)),
        message: compileMilkySegments(
            requireSegments(params.message),
            sequence => adapter.resolveId(sequence).string,
        ),
    });
    return { message_seq: result.message_id.number, time: Math.floor(Date.now() / 1000) };
}

async function recallMessage(
    adapter: Adapter,
    accountId: string,
    scene: "private" | "group",
    params: Record<string, unknown>,
): Promise<Record<string, never>> {
    const sceneKey = scene === "private" ? "user_id" : "group_id";
    await adapter.deleteMessage(accountId, {
        message_id: adapter.resolveId(requirePositiveIntegerParam(params, "message_seq")),
        scene_type: scene,
        scene_id: adapter.resolveId(requirePositiveIntegerParam(params, sceneKey)),
    });
    return {};
}

async function getMessage(adapter: Adapter, accountId: string, params: Record<string, unknown>) {
    const scene = messageScene(params.message_scene);
    const message = await adapter.getMessage(accountId, {
        message_id: adapter.resolveId(requirePositiveIntegerParam(params, "message_seq")),
        scene_type: scene,
        scene_id: adapter.resolveId(requirePositiveIntegerParam(params, "peer_id")),
    });
    return { message: await projectMilkyIncomingMessage(adapter, accountId, message) };
}

async function getHistoryMessages(
    adapter: Adapter,
    accountId: string,
    params: Record<string, unknown>,
) {
    const scene = messageScene(params.message_scene);
    const limit = params.limit === undefined ? 20 : historyLimit(params.limit);
    const messages = await adapter.getMessageHistory(accountId, {
        scene_type: scene,
        scene_id: adapter.resolveId(requirePositiveIntegerParam(params, "peer_id")),
        limit,
        start_message_id:
            params.start_message_seq === undefined
                ? undefined
                : adapter.resolveId(requirePositiveIntegerParam(params, "start_message_seq")),
    });
    return {
        messages: await Promise.all(
            messages.map(message => projectMilkyIncomingMessage(adapter, accountId, message)),
        ),
        ...(messages.length < limit || messages[0] === undefined
            ? {}
            : { next_message_seq: messages[0].message_id.number }),
    };
}

async function getResourceTempUrl(
    adapter: Adapter,
    accountId: string,
    params: Record<string, unknown>,
) {
    return {
        url: await adapter.getResourceTempUrl(accountId, {
            resource_id: requireNonEmptyStringParam(params, "resource_id"),
        }),
    };
}

async function getForwardedMessages(
    adapter: Adapter,
    accountId: string,
    params: Record<string, unknown>,
) {
    const messages = await adapter.getForwardMessage(accountId, {
        resource_id: requireNonEmptyStringParam(params, "forward_id"),
    });
    return {
        messages: messages.map(message => ({
            message_seq: message.message_id.number,
            sender_name: message.sender.sender_name,
            avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${message.sender.sender_id.number}&s=640`,
            time: message.time,
            segments: projectMilkySegments(message.message),
        })),
    };
}

async function markMessageAsRead(
    adapter: Adapter,
    accountId: string,
    params: Record<string, unknown>,
): Promise<Record<string, never>> {
    await adapter.markMessageAsRead(accountId, {
        scene_type: messageScene(params.message_scene),
        scene_id: adapter.resolveId(requirePositiveIntegerParam(params, "peer_id")),
        message_id: adapter.resolveId(requirePositiveIntegerParam(params, "message_seq")),
    });
    return {};
}

function requireSegments(value: unknown): Milky.Segment[] {
    if (!Array.isArray(value)) throw new TypeError("message 必须是消息段数组");
    return value as Milky.Segment[];
}

function messageScene(value: unknown): "private" | "group" {
    if (value === "friend") return "private";
    if (value === "group") return "group";
    throw new TypeError("message_scene 必须是 friend 或 group");
}

function historyLimit(value: unknown): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 30) {
        throw new TypeError("limit 必须是 1 到 30 的整数");
    }
    return value;
}
