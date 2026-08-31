import { defineKookActionRoutes } from "./platform-action-contract.js";

const TEMPLATE_FIELDS = {
    title: { type: "string", maxLength: 64 },
    content: { type: "string" },
    test_data: { type: "string" },
    msgtype: { type: "integer", values: [1, 2, 3] },
    type: { type: "integer", values: [0] },
    test_channel: { type: "string", maxLength: 64 },
} as const;

/** KOOK 消息模板控制面的稳定参数契约。 */
const TEMPLATE_ROUTES = {
    list_message_templates: {
        path: "/v3/template/list",
        method: "GET",
        params: {},
    },
    create_message_template: {
        path: "/v3/template/create",
        method: "POST",
        params: {
            ...TEMPLATE_FIELDS,
            title: { ...TEMPLATE_FIELDS.title, required: true },
            content: { ...TEMPLATE_FIELDS.content, required: true },
        },
    },
    update_message_template: {
        path: "/v3/template/update",
        method: "POST",
        params: {
            id: { type: "string", required: true, maxLength: 16 },
            ...TEMPLATE_FIELDS,
        },
    },
    delete_message_template: {
        path: "/v3/template/delete",
        method: "POST",
        params: {
            id: { type: "string", required: true, maxLength: 16 },
        },
    },
} as const;

export const KOOK_TEMPLATE_PLATFORM_ACTIONS = defineKookActionRoutes(TEMPLATE_ROUTES);
