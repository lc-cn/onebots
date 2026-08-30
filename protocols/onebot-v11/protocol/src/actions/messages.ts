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
