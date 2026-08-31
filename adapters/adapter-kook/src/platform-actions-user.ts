import {
    defineKookActionRoutes,
    type KookActionParamRule,
    type KookActionRouteContract,
} from "./platform-action-contract.js";
import { KOOK_MAX_PAGE_SIZE } from "./pagination.js";

const REQUIRED_STRING = { type: "string", required: true } satisfies KookActionParamRule;
const OPTIONAL_PAGE = { type: "integer", min: 1 } satisfies KookActionParamRule;
const OPTIONAL_PAGE_SIZE = {
    type: "integer",
    min: 1,
    max: KOOK_MAX_PAGE_SIZE,
} satisfies KookActionParamRule;

/** KOOK 私信会话与用户亲密度接口。 */
const USER_ROUTES = {
    list_user_chats: {
        path: "/v3/user-chat/list",
        method: "GET",
        params: {
            page: OPTIONAL_PAGE,
            page_size: OPTIONAL_PAGE_SIZE,
        },
    },
    get_user_chat: {
        path: "/v3/user-chat/view",
        method: "GET",
        params: { chat_code: REQUIRED_STRING },
    },
    create_user_chat: {
        path: "/v3/user-chat/create",
        method: "POST",
        params: { target_id: REQUIRED_STRING },
    },
    delete_user_chat: {
        path: "/v3/user-chat/delete",
        method: "POST",
        params: { chat_code: REQUIRED_STRING },
    },
    get_intimacy: {
        path: "/v3/intimacy/index",
        method: "GET",
        params: { user_id: REQUIRED_STRING },
    },
    update_intimacy: {
        path: "/v3/intimacy/update",
        method: "POST",
        params: {
            user_id: REQUIRED_STRING,
            score: { type: "integer", min: 0, max: 2_200 },
            social_info: { type: "string", allowEmpty: true, maxLength: 500 },
            img_id: { type: "string" },
        },
    },
} satisfies Readonly<Record<string, KookActionRouteContract>>;

export const KOOK_USER_PLATFORM_ACTIONS = defineKookActionRoutes(USER_ROUTES);
