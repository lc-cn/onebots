import {
    defineKookActionRoutes,
    type KookActionParamRule,
    type KookActionRouteContract,
} from "./platform-action-contract.js";
import { KOOK_MAX_PAGE_SIZE } from "./pagination.js";

const REQUIRED_STRING = { type: "string", required: true } satisfies KookActionParamRule;
const OPTIONAL_STRING = { type: "string" } satisfies KookActionParamRule;
const OPTIONAL_PAGE_SIZE = {
    type: "integer",
    min: 1,
    max: KOOK_MAX_PAGE_SIZE,
} satisfies KookActionParamRule;

const THREAD_ROUTES = {
    list_thread_categories: {
        path: "/v3/category/list",
        method: "GET",
        params: { channel_id: REQUIRED_STRING },
    },
    create_thread: {
        path: "/v3/thread/create",
        method: "POST",
        params: {
            channel_id: REQUIRED_STRING,
            guild_id: REQUIRED_STRING,
            category_id: OPTIONAL_STRING,
            title: REQUIRED_STRING,
            cover: OPTIONAL_STRING,
            content: REQUIRED_STRING,
        },
    },
    reply_thread: {
        path: "/v3/thread/reply",
        method: "POST",
        params: {
            channel_id: REQUIRED_STRING,
            thread_id: REQUIRED_STRING,
            reply_id: OPTIONAL_STRING,
            content: REQUIRED_STRING,
        },
    },
    get_thread: {
        path: "/v3/thread/view",
        method: "GET",
        params: { channel_id: REQUIRED_STRING, thread_id: REQUIRED_STRING },
    },
    list_threads: {
        path: "/v3/thread/list",
        method: "GET",
        params: {
            channel_id: REQUIRED_STRING,
            category_id: OPTIONAL_STRING,
            sort: { type: "integer", values: [1, 2] },
            page_size: OPTIONAL_PAGE_SIZE,
            time: { type: "integer", min: 0 },
        },
    },
    delete_thread_item: {
        path: "/v3/thread/delete",
        method: "POST",
        params: {
            channel_id: REQUIRED_STRING,
            thread_id: OPTIONAL_STRING,
            post_id: OPTIONAL_STRING,
        },
        atLeastOne: [["thread_id", "post_id"]],
    },
    list_thread_posts: {
        path: "/v3/thread/post",
        method: "GET",
        params: {
            channel_id: REQUIRED_STRING,
            thread_id: REQUIRED_STRING,
            post_id: OPTIONAL_STRING,
            time: { type: "integer", min: 0 },
            page_size: OPTIONAL_PAGE_SIZE,
            order: { type: "string", required: true, values: ["asc", "desc"] },
            page: { type: "integer", required: true, min: 1 },
        },
    },
} satisfies Readonly<Record<string, KookActionRouteContract>>;

export const KOOK_THREAD_PLATFORM_ACTIONS = defineKookActionRoutes(THREAD_ROUTES);
