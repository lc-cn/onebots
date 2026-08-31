import { defineKookActionRoutes } from "./platform-action-contract.js";

/** KOOK 频道/私信回应与消息置顶接口的稳定参数契约。 */
const MESSAGE_ROUTES = {
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

export const KOOK_MESSAGE_PLATFORM_ACTIONS = defineKookActionRoutes(MESSAGE_ROUTES);
