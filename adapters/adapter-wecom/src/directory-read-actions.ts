import { definePlatformActionHandlers } from "onebots";
import type { WeComClient } from "./client.js";
import { WeComApiError } from "./errors.js";
import type { WeComActionHandler, WeComActionParams } from "./platform-action-context.js";
import {
    boundedInteger,
    invalid,
    optionalBoolean,
    optionalString,
    post,
    requireNumber,
    requireString,
} from "./platform-action-params.js";

const handlers = {
    get_user: async (client: WeComClient, params: WeComActionParams) =>
        client.getUserInfo(requireString(params, "user_id")),
    list_department_users: async (client: WeComClient, params: WeComActionParams) =>
        client.listDepartmentUsers(
            positiveInteger(params, "department_id"),
            optionalBoolean(params, "fetch_child") || false,
        ),
    list_department_user_ids: async (client: WeComClient, params: WeComActionParams) =>
        client.call({
            path: "/cgi-bin/user/simplelist",
            query: {
                department_id: positiveInteger(params, "department_id"),
                fetch_child: optionalBoolean(params, "fetch_child") ? 1 : 0,
            },
        }),
    list_user_ids: listUserIds,
    convert_user_id_to_open_id: async (client: WeComClient, params: WeComActionParams) =>
        post(client, "/cgi-bin/user/convert_to_openid", {
            userid: requireString(params, "user_id"),
        }),
    convert_open_id_to_user_id: async (client: WeComClient, params: WeComActionParams) =>
        post(client, "/cgi-bin/user/convert_to_userid", {
            openid: requireString(params, "open_id"),
        }),
    get_user_id_by_mobile: async (client: WeComClient, params: WeComActionParams) =>
        post(client, "/cgi-bin/user/getuserid", {
            mobile: requireString(params, "mobile"),
        }),
    get_user_id_by_email: async (client: WeComClient, params: WeComActionParams) =>
        post(client, "/cgi-bin/user/get_userid_by_email", {
            email: requireString(params, "email"),
            ...(params.email_type === undefined
                ? {}
                : { email_type: boundedInteger(params, "email_type", 1, 2, 1) }),
        }),
    complete_user_secondary_verification: async (client: WeComClient, params: WeComActionParams) =>
        client.call({
            path: "/cgi-bin/user/authsucc",
            query: { userid: requireString(params, "user_id") },
        }),
    get_department: async (client: WeComClient, params: WeComActionParams) =>
        client.call({
            path: "/cgi-bin/department/get",
            query: { id: positiveInteger(params, "department_id") },
        }),
    list_departments: async (client: WeComClient, params: WeComActionParams) =>
        client.call({
            path: "/cgi-bin/department/list",
            query: { id: optionalPositiveInteger(params, "department_id") },
        }),
    list_child_department_ids: async (client: WeComClient, params: WeComActionParams) =>
        client.call({
            path: "/cgi-bin/department/simplelist",
            query: { id: optionalPositiveInteger(params, "department_id") },
        }),
} satisfies Readonly<Record<string, WeComActionHandler>>;

/** 自建应用 token 可直接读取的通讯录与身份转换能力。 */
export const WECOM_DIRECTORY_READ_ACTIONS = definePlatformActionHandlers(
    handlers,
    {
        get_user: ["user_id"],
        list_department_users: ["department_id", "fetch_child"],
        list_department_user_ids: ["department_id", "fetch_child"],
        list_user_ids: ["cursor", "limit"],
        convert_user_id_to_open_id: ["user_id"],
        convert_open_id_to_user_id: ["open_id"],
        get_user_id_by_mobile: ["mobile"],
        get_user_id_by_email: ["email", "email_type"],
        complete_user_secondary_verification: ["user_id"],
        get_department: ["department_id"],
        list_departments: ["department_id"],
        list_child_department_ids: ["department_id"],
    },
    (action, parameter) =>
        new WeComApiError(`企业微信平台动作 ${action} 不接受参数 ${parameter}`, {
            code: "WECOM_UNEXPECTED_ACTION_PARAMETER",
        }),
);

function positiveInteger(params: WeComActionParams, name: string): number {
    const value = requireNumber(params, name);
    if (!Number.isSafeInteger(value) || value < 1) invalid(`${name} 必须是正安全整数`);
    return value;
}

function optionalPositiveInteger(params: WeComActionParams, name: string): number | undefined {
    if (params[name] === undefined) return undefined;
    return positiveInteger(params, name);
}

function listUserIds(client: WeComClient, params: WeComActionParams): Promise<unknown> {
    const cursor = optionalString(params, "cursor");
    return post(client, "/cgi-bin/user/list_id", {
        ...(cursor ? { cursor } : {}),
        limit: boundedInteger(params, "limit", 1, 10_000, 10_000),
    });
}
