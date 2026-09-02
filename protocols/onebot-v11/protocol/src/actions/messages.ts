import { requireNonEmptyStringParam, requirePositiveIntegerParam } from "onebots";
import type { CommonTypes } from "onebots";
import type { OneBotV11ActionContext, OneBotV11ActionHandler, OneBotV11Params } from "./types.js";

export function createMessageActions(
    context: OneBotV11ActionContext,
): Record<string, OneBotV11ActionHandler> {
    const sendPrivateMessage = async (params: OneBotV11Params): Promise<{ message_id: number }> => {
        const {
            user_id,
            message,
            auto_escape = false,
        } = params as {
            user_id: string | number;
            message: string | CommonTypes.Segment[];
            auto_escape?: boolean;
        };
        const result = await context.adapter.sendMessage(context.accountId, {
            scene_type: "private",
            scene_id: context.resolveId(user_id),
            message: context.parseMessage(message, auto_escape),
        });
        return { message_id: result.message_id.number };
    };

    const sendGroupMessage = async (params: OneBotV11Params): Promise<{ message_id: number }> => {
        const {
            group_id,
            message,
            auto_escape = false,
        } = params as {
            group_id: string | number;
            message: string | CommonTypes.Segment[];
            auto_escape?: boolean;
        };
        const result = await context.adapter.sendMessage(context.accountId, {
            scene_type: "group",
            scene_id: context.resolveId(group_id),
            message: context.parseMessage(message, auto_escape),
        });
        return { message_id: result.message_id.number };
    };

    const sendForwardMessage = async (
        params: OneBotV11Params,
        sceneType: "private" | "group",
    ): Promise<{ message_id: number }> => {
        if (!Array.isArray(params.messages)) throw new TypeError("messages 必须是转发节点数组");
        if (!context.adapter.describeCapabilities(context.accountId).actions.make_forward_message) {
            throw new Error("make_forward_message not implemented");
        }
        const forward = await context.adapter.callAction(
            context.accountId,
            "make_forward_message",
            { nodes: params.messages, dm: sceneType === "private" },
        );
        if (
            typeof forward !== "object" ||
            forward === null ||
            !("type" in forward) ||
            typeof forward.type !== "string" ||
            !("data" in forward)
        ) {
            throw new TypeError("make_forward_message 返回了无效消息段");
        }
        const sceneId = context.resolveId(
            sceneType === "private"
                ? requirePositiveIntegerParam(params, "user_id")
                : requirePositiveIntegerParam(params, "group_id"),
        );
        const result = await context.adapter.sendMessage(context.accountId, {
            scene_type: sceneType,
            scene_id: sceneId,
            message: [forward as CommonTypes.Segment],
        });
        return { message_id: result.message_id.number };
    };

    const getMessageHistory = async (
        params: OneBotV11Params,
        sceneType: "private" | "group",
    ): Promise<{ messages: ReturnType<typeof context.convertMessageInfo>[] }> => {
        const rawCount = params.count ?? 20;
        const count = Number(rawCount);
        if (!Number.isSafeInteger(count) || count <= 0) {
            throw new TypeError("count 必须是正整数");
        }
        const offset =
            sceneType === "group" && params.message_seq !== undefined
                ? Number(params.message_seq)
                : undefined;
        if (offset !== undefined && (!Number.isSafeInteger(offset) || offset < 0)) {
            throw new TypeError("message_seq 必须是非负整数");
        }
        const sceneId = context.resolveId(
            sceneType === "private"
                ? requirePositiveIntegerParam(params, "user_id")
                : requirePositiveIntegerParam(params, "group_id"),
        );
        const history = await context.adapter.getMessageHistory(context.accountId, {
            scene_type: sceneType,
            scene_id: sceneId,
            limit: count,
            offset,
            start_message_id:
                params.message_id === undefined
                    ? undefined
                    : context.resolveId(params.message_id as string | number),
        });
        const messages = history.map(message => context.convertMessageInfo(message));
        return { messages: params.reverseOrder === true ? messages.reverse() : messages };
    };

    return {
        send_private_msg: sendPrivateMessage,
        send_group_msg: sendGroupMessage,
        send_msg: async params => {
            const {
                message_type,
                user_id,
                group_id,
                message,
                auto_escape = false,
            } = params as {
                message_type: string;
                user_id?: string | number;
                group_id?: string | number;
                message: string | CommonTypes.Segment[];
                auto_escape?: boolean;
            };
            if (message_type === "private") {
                return sendPrivateMessage({ user_id, message, auto_escape });
            }
            if (message_type === "group") {
                return sendGroupMessage({ group_id, message, auto_escape });
            }
            throw new Error("Invalid message_type");
        },
        delete_msg: async params => {
            const { message_id } = params as { message_id: string | number };
            await context.adapter.deleteMessage(context.accountId, {
                message_id: context.resolveId(message_id),
            });
        },
        get_msg: async params => {
            const { message_id } = params as { message_id: string | number };
            const message = await context.adapter.getMessage(context.accountId, {
                message_id: context.resolveId(message_id),
            });
            return context.convertMessageInfo(message);
        },
        get_forward_msg: async params => {
            const resourceId = requireNonEmptyStringParam(params, "id");
            const messages = await context.adapter.getForwardMessage(context.accountId, {
                resource_id: resourceId,
            });
            return { messages: messages.map(message => context.convertSegments(message.message)) };
        },
        get_friend_msg_history: params => getMessageHistory(params, "private"),
        get_group_msg_history: params => getMessageHistory(params, "group"),
        send_private_forward_msg: params => sendForwardMessage(params, "private"),
        send_group_forward_msg: params => sendForwardMessage(params, "group"),
        send_like: async params => {
            const userId = requirePositiveIntegerParam(params, "user_id");
            const times =
                params.times === undefined ? 1 : requirePositiveIntegerParam(params, "times");
            await context.adapter.sendLike(context.accountId, {
                user_id: context.adapter.resolveId(userId),
                times,
            });
        },
    };
}
