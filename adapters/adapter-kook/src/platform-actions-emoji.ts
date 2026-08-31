import {
    defineKookActionRoutes,
    type KookActionParamRule,
    type KookActionRouteContract,
} from "./platform-action-contract.js";
import { KOOK_MAX_PAGE_SIZE } from "./pagination.js";

const REQUIRED_STRING = { type: "string", required: true } satisfies KookActionParamRule;

const EMOJI_ROUTES = {
    list_guild_emojis: {
        path: "/v3/guild-emoji/list",
        method: "GET",
        params: {
            guild_id: REQUIRED_STRING,
            page: { type: "integer", min: 1 },
            page_size: { type: "integer", min: 1, max: KOOK_MAX_PAGE_SIZE },
        },
    },
    update_guild_emoji: {
        path: "/v3/guild-emoji/update",
        method: "POST",
        params: {
            id: REQUIRED_STRING,
            name: { type: "string", required: true, minLength: 2, maxLength: 32 },
        },
    },
    delete_guild_emoji: {
        path: "/v3/guild-emoji/delete",
        method: "POST",
        params: { id: REQUIRED_STRING },
    },
} satisfies Readonly<Record<string, KookActionRouteContract>>;

export const KOOK_EMOJI_PLATFORM_ACTIONS = defineKookActionRoutes(EMOJI_ROUTES);
