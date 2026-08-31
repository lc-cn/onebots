import {
    defineKookActionRoutes,
    type KookActionParamRule,
    type KookActionRouteContract,
} from "./platform-action-contract.js";

const REQUIRED_ID = { type: "integer", required: true, min: 1 } satisfies KookActionParamRule;
const REQUIRED_STRING = { type: "string", required: true } satisfies KookActionParamRule;
const OPTIONAL_STRING = { type: "string" } satisfies KookActionParamRule;

const GAME_ROUTES = {
    list_games: {
        path: "/v3/game",
        method: "GET",
        params: { type: { type: "integer", values: [0, 1, 2] } },
    },
    create_game: {
        path: "/v3/game/create",
        method: "POST",
        params: { name: REQUIRED_STRING, icon: OPTIONAL_STRING },
    },
    update_game: {
        path: "/v3/game/update",
        method: "POST",
        params: { id: REQUIRED_ID, name: OPTIONAL_STRING, icon: OPTIONAL_STRING },
    },
    delete_game: {
        path: "/v3/game/delete",
        method: "POST",
        params: { id: REQUIRED_ID },
    },
    set_game_activity: {
        path: "/v3/game/activity",
        method: "POST",
        params: {
            id: { type: "integer", min: 1 },
            data_type: { type: "integer", required: true, values: [1, 2] },
            software: {
                type: "string",
                values: ["cloudmusic", "qqmusic", "kugou"],
            },
            singer: OPTIONAL_STRING,
            music_name: OPTIONAL_STRING,
        },
        requiredWhen: [
            { param: "data_type", equals: 1, required: ["id"] },
            { param: "data_type", equals: 2, required: ["singer", "music_name"] },
        ],
    },
    delete_game_activity: {
        path: "/v3/game/delete-activity",
        method: "POST",
        params: { data_type: { type: "integer", required: true, values: [1, 2] } },
    },
} satisfies Readonly<Record<string, KookActionRouteContract>>;

export const KOOK_GAME_PLATFORM_ACTIONS = defineKookActionRoutes(GAME_ROUTES);
