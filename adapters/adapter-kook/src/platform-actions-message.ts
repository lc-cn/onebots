import { definePlatformActionHandlers, type PlatformActionHandler } from "onebots";
import { defineKookActionRoutes } from "./platform-action-contract.js";
import type { KookBot } from "./bot.js";
import { KookError } from "./errors.js";

/** KOOK 频道/私信回应与消息置顶接口的稳定参数契约。 */
const MESSAGE_ROUTES = {
    list_channel_messages: {
        path: "/v3/message/list",
        method: "GET",
        params: {
            target_id: { type: "string", required: true },
            msg_id: { type: "string" },
            pin: { type: "integer", values: [0, 1] },
            flag: { type: "string", values: ["before", "around", "after"] },
            page_size: { type: "integer", min: 1, max: 50 },
        },
    },
    list_direct_messages: {
        path: "/v3/direct-message/list",
        method: "GET",
        params: {
            chat_code: { type: "string" },
            target_id: { type: "string" },
            msg_id: { type: "string" },
            flag: { type: "string", values: ["before", "around", "after"] },
            page: { type: "integer", min: 1 },
            page_size: { type: "integer", min: 1, max: 50 },
        },
        atLeastOne: [["chat_code", "target_id"]],
    },
    get_message_reactions: {
        path: "/v3/message/reaction-list",
        method: "GET",
        params: {
            msg_id: { type: "string", required: true },
            emoji: { type: "string", required: true },
        },
    },
    add_message_reaction: {
        path: "/v3/message/add-reaction",
        method: "POST",
        params: {
            msg_id: { type: "string", required: true },
            emoji: { type: "string", required: true },
        },
    },
    remove_message_reaction: {
        path: "/v3/message/delete-reaction",
        method: "POST",
        params: {
            msg_id: { type: "string", required: true },
            emoji: { type: "string", required: true },
            user_id: { type: "string" },
        },
    },
    get_direct_message_reactions: {
        path: "/v3/direct-message/reaction-list",
        method: "GET",
        params: {
            msg_id: { type: "string", required: true },
            emoji: { type: "string" },
        },
    },
    add_direct_message_reaction: {
        path: "/v3/direct-message/add-reaction",
        method: "POST",
        params: {
            msg_id: { type: "string", required: true },
            emoji: { type: "string", required: true },
        },
    },
    remove_direct_message_reaction: {
        path: "/v3/direct-message/delete-reaction",
        method: "POST",
        params: {
            msg_id: { type: "string", required: true },
            emoji: { type: "string", required: true },
            user_id: { type: "string" },
        },
    },
    pin_message: {
        path: "/v3/message/pin",
        method: "POST",
        params: {
            msg_id: { type: "string", required: true },
            target_id: { type: "string", required: true },
        },
    },
    unpin_message: {
        path: "/v3/message/unpin",
        method: "POST",
        params: {
            msg_id: { type: "string", required: true },
            target_id: { type: "string", required: true },
        },
    },
} as const;

const PIPE_MESSAGE_HANDLERS = {
    send_pipe_message: (bot: KookBot, params: Readonly<Record<string, unknown>>) =>
        bot.callApi("/v3/message/send-pipemsg", {
            method: "POST",
            query: pipeMessageQuery(params),
            body: pipeMessageBody(params.body),
        }),
} satisfies Readonly<Record<string, PlatformActionHandler<KookBot>>>;

const PIPE_MESSAGE_ACTIONS = definePlatformActionHandlers(
    PIPE_MESSAGE_HANDLERS,
    { send_pipe_message: ["access_token", "type", "target_id", "body"] },
    (action, parameter) =>
        KookError.invalid(
            `KOOK 动作 ${action} 不接受参数 ${parameter}`,
            "KOOK_ACTION_PARAM_UNKNOWN",
            { action, key: parameter },
        ),
);

export const KOOK_MESSAGE_PLATFORM_ACTIONS = {
    ...defineKookActionRoutes(MESSAGE_ROUTES),
    ...PIPE_MESSAGE_ACTIONS,
};

function pipeMessageQuery(
    params: Readonly<Record<string, unknown>>,
): Record<string, string | number> {
    const query: Record<string, string | number> = {
        access_token: requiredString(params.access_token, "access_token"),
    };
    if (params.type !== undefined) {
        if (
            typeof params.type !== "number" ||
            !Number.isInteger(params.type) ||
            ![1, 2, 3, 4, 8, 9, 10].includes(params.type)
        ) {
            throw KookError.invalid(
                "KOOK 管道消息 type 不是可发送的消息类型",
                "KOOK_ACTION_PARAM_INVALID",
                { action: "send_pipe_message", key: "type", value: params.type },
            );
        }
        query.type = params.type;
    }
    const targetId = optionalString(params.target_id);
    if (targetId) query.target_id = targetId;
    return query;
}

function pipeMessageBody(value: unknown): Readonly<Record<string, unknown>> {
    if (isRecord(value)) return value;
    throw KookError.invalid("KOOK 管道消息 body 必须是对象", "KOOK_ACTION_PARAM_INVALID", {
        action: "send_pipe_message",
        key: "body",
        value,
    });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function requiredString(value: unknown, key: string): string {
    const result = optionalString(value);
    if (result) return result;
    throw KookError.invalid(`KOOK 动作缺少参数 ${key}`, "KOOK_ACTION_PARAM_REQUIRED", {
        action: "send_pipe_message",
        key,
    });
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
