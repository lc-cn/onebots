import {
    defineKookActionRoutes,
    type KookActionParamRule,
    type KookActionRouteContract,
} from "./platform-action-contract.js";

const REQUIRED_STRING = { type: "string", required: true } satisfies KookActionParamRule;
const OPTIONAL_STRING = { type: "string" } satisfies KookActionParamRule;
const REQUIRED_UINT = {
    type: "integer",
    required: true,
    min: 0,
    max: 0xffff_ffff,
} satisfies KookActionParamRule;
const OPTIONAL_UINT = {
    type: "integer",
    min: 0,
    max: 0xffff_ffff,
} satisfies KookActionParamRule;
const OPTIONAL_PAGE = { type: "integer", min: 1 } satisfies KookActionParamRule;
const OPTIONAL_FLAG = { type: "integer", values: [0, 1] } satisfies KookActionParamRule;
const OPTIONAL_PERMISSION_TARGET = {
    type: "string",
    values: ["role_id", "user_id"],
} satisfies KookActionParamRule;

const PERMISSION_ROUTES = {
    list_guild_roles: {
        path: "/v3/guild-role/list",
        method: "GET",
        params: {
            guild_id: REQUIRED_STRING,
            page: OPTIONAL_PAGE,
            page_size: OPTIONAL_PAGE,
        },
    },
    create_guild_role: {
        path: "/v3/guild-role/create",
        method: "POST",
        params: { guild_id: REQUIRED_STRING, name: OPTIONAL_STRING },
    },
    update_guild_role: {
        path: "/v3/guild-role/update",
        method: "POST",
        params: {
            guild_id: REQUIRED_STRING,
            role_id: REQUIRED_UINT,
            name: OPTIONAL_STRING,
            color: {
                type: "integer",
                min: 0,
                max: 0xff_ffff,
            },
            hoist: OPTIONAL_FLAG,
            mentionable: OPTIONAL_FLAG,
            permissions: OPTIONAL_UINT,
        },
    },
    delete_guild_role: {
        path: "/v3/guild-role/delete",
        method: "POST",
        params: { guild_id: REQUIRED_STRING, role_id: REQUIRED_UINT },
    },
    grant_guild_role: {
        path: "/v3/guild-role/grant",
        method: "POST",
        params: {
            guild_id: REQUIRED_STRING,
            user_id: REQUIRED_STRING,
            role_id: REQUIRED_UINT,
        },
    },
    revoke_guild_role: {
        path: "/v3/guild-role/revoke",
        method: "POST",
        params: {
            guild_id: REQUIRED_STRING,
            user_id: REQUIRED_STRING,
            role_id: REQUIRED_UINT,
        },
    },
    get_channel_permissions: {
        path: "/v3/channel-role/index",
        method: "GET",
        params: { channel_id: REQUIRED_STRING },
    },
    create_channel_permission: {
        path: "/v3/channel-role/create",
        method: "POST",
        params: {
            channel_id: REQUIRED_STRING,
            type: OPTIONAL_PERMISSION_TARGET,
            value: OPTIONAL_STRING,
        },
    },
    update_channel_permission: {
        path: "/v3/channel-role/update",
        method: "POST",
        params: {
            channel_id: REQUIRED_STRING,
            type: OPTIONAL_PERMISSION_TARGET,
            value: OPTIONAL_STRING,
            allow: OPTIONAL_UINT,
            deny: OPTIONAL_UINT,
        },
    },
    sync_channel_permissions: {
        path: "/v3/channel-role/sync",
        method: "POST",
        params: { channel_id: REQUIRED_STRING },
    },
    delete_channel_permission: {
        path: "/v3/channel-role/delete",
        method: "POST",
        params: {
            channel_id: REQUIRED_STRING,
            type: OPTIONAL_PERMISSION_TARGET,
            value: OPTIONAL_STRING,
        },
    },
} satisfies Readonly<Record<string, KookActionRouteContract>>;

export const KOOK_PERMISSION_PLATFORM_ACTIONS = defineKookActionRoutes(PERMISSION_ROUTES);
