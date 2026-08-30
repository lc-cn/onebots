import {
    defineKookActionRoutes,
    type KookActionParamRule,
    type KookActionRouteContract,
} from "./platform-action-contract.js";
import { KOOK_MAX_PAGE_SIZE } from "./pagination.js";

const REQUIRED_STRING = { type: "string", required: true } satisfies KookActionParamRule;
const OPTIONAL_STRING = { type: "string" } satisfies KookActionParamRule;
const OPTIONAL_PAGE = { type: "integer", min: 1 } satisfies KookActionParamRule;
const OPTIONAL_PAGE_SIZE = {
    type: "integer",
    min: 1,
    max: KOOK_MAX_PAGE_SIZE,
} satisfies KookActionParamRule;
const OPTIONAL_TIMESTAMP = { type: "integer", min: 0 } satisfies KookActionParamRule;
const REQUIRED_MUTE_TYPE = {
    type: "integer",
    required: true,
    values: [1, 2],
} satisfies KookActionParamRule;

const GUILD_ROUTES = {
    list_blacklist: {
        path: "/v3/blacklist/list",
        method: "GET",
        params: {
            guild_id: REQUIRED_STRING,
            page: OPTIONAL_PAGE,
            page_size: OPTIONAL_PAGE_SIZE,
        },
    },
    add_blacklist: {
        path: "/v3/blacklist/create",
        method: "POST",
        params: {
            guild_id: REQUIRED_STRING,
            target_id: REQUIRED_STRING,
            remark: OPTIONAL_STRING,
            del_msg_days: { type: "integer", min: 0, max: 7 },
        },
    },
    remove_blacklist: {
        path: "/v3/blacklist/delete",
        method: "POST",
        params: { guild_id: REQUIRED_STRING, target_id: REQUIRED_STRING },
    },
    list_guild_mutes: {
        path: "/v3/guild-mute/list",
        method: "GET",
        params: {
            guild_id: REQUIRED_STRING,
            return_type: { type: "string", values: ["detail"], default: "detail" },
        },
    },
    add_guild_mute: {
        path: "/v3/guild-mute/create",
        method: "POST",
        params: {
            guild_id: REQUIRED_STRING,
            user_id: REQUIRED_STRING,
            type: REQUIRED_MUTE_TYPE,
        },
    },
    remove_guild_mute: {
        path: "/v3/guild-mute/delete",
        method: "POST",
        params: {
            guild_id: REQUIRED_STRING,
            user_id: REQUIRED_STRING,
            type: REQUIRED_MUTE_TYPE,
        },
    },
    get_guild_boost_history: {
        path: "/v3/guild-boost/history",
        method: "GET",
        params: {
            guild_id: REQUIRED_STRING,
            start_time: OPTIONAL_TIMESTAMP,
            end_time: OPTIONAL_TIMESTAMP,
            page: OPTIONAL_PAGE,
            page_size: OPTIONAL_PAGE_SIZE,
        },
    },
    leave_guild: {
        path: "/v3/guild/leave",
        method: "POST",
        params: { guild_id: REQUIRED_STRING },
    },
    kick_guild_member: {
        path: "/v3/guild/kickout",
        method: "POST",
        params: { guild_id: REQUIRED_STRING, target_id: REQUIRED_STRING },
    },
    set_guild_member_nickname: {
        path: "/v3/guild/nickname",
        method: "POST",
        params: {
            guild_id: REQUIRED_STRING,
            nickname: { type: "string", minLength: 2, maxLength: 64 },
            user_id: OPTIONAL_STRING,
        },
    },
} satisfies Readonly<Record<string, KookActionRouteContract>>;

export const KOOK_GUILD_PLATFORM_ACTIONS = defineKookActionRoutes(GUILD_ROUTES);
