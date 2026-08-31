import { defineKookActionRoutes } from "./platform-action-contract.js";

const INVITE_TARGET = ["guild_id", "channel_id"] as const;

/** KOOK 邀请控制面的稳定参数契约。 */
const INVITE_ROUTES = {
    list_invites: {
        path: "/v3/invite/list",
        method: "GET",
        params: {
            guild_id: { type: "string" },
            channel_id: { type: "string" },
            page: { type: "integer", min: 1 },
            page_size: { type: "integer", min: 1, max: 50 },
        },
        atLeastOne: [INVITE_TARGET],
    },
    create_invite: {
        path: "/v3/invite/create",
        method: "POST",
        params: {
            guild_id: { type: "string" },
            channel_id: { type: "string" },
            duration: {
                type: "integer",
                values: [0, 1_800, 3_600, 21_600, 43_200, 86_400, 604_800],
            },
            setting_times: { type: "integer", values: [-1, 1, 5, 10, 25, 50, 100] },
        },
        atLeastOne: [INVITE_TARGET],
    },
    delete_invite: {
        path: "/v3/invite/delete",
        method: "POST",
        params: {
            url_code: { type: "string", required: true },
            guild_id: { type: "string" },
            channel_id: { type: "string" },
        },
    },
    list_invitees: {
        path: "/v3/invite/invitees",
        method: "GET",
        params: {
            id: { type: "string" },
            invite_url: { type: "string" },
            guild_id: { type: "string" },
            status: { type: "integer", values: [-1, 0, 254] },
            start_time: { type: "string" },
            end_time: { type: "string" },
            page: { type: "integer", required: true, min: 1 },
            page_size: { type: "integer", required: true, min: 1, max: 50 },
        },
    },
} as const;

export const KOOK_INVITE_PLATFORM_ACTIONS = defineKookActionRoutes(INVITE_ROUTES);
