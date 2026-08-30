import type { PlatformActionHandler } from "onebots";
import type { WeComKfClient } from "./client.js";
import { WeComKfError } from "./errors.js";

/**
 * 微信客服知识库动作。
 *
 * 复杂问答体保持官方结构原样传递；分组与分页参数则在边界处闭合校验，避免每个
 * 调用方重复拼接路径、方法和基础字段。
 */
export const WECOM_KF_KNOWLEDGE_ACTION_HANDLERS = {
    add_knowledge_group: (client, params) =>
        post(client, "/cgi-bin/kf/knowledge/add_group", {
            name: requireGroupName(params),
        }),
    update_knowledge_group: (client, params) =>
        post(client, "/cgi-bin/kf/knowledge/mod_group", {
            group_id: requireString(params, "group_id"),
            name: requireGroupName(params),
        }),
    delete_knowledge_group: (client, params) =>
        post(client, "/cgi-bin/kf/knowledge/del_group", {
            group_id: requireString(params, "group_id"),
        }),
    list_knowledge_groups: (client, params) =>
        post(client, "/cgi-bin/kf/knowledge/list_group", pageRequest(params, "group_id")),
    add_knowledge_intent: (client, params) =>
        post(client, "/cgi-bin/kf/knowledge/add_intent", officialRequest(params, "group_id")),
    update_knowledge_intent: (client, params) =>
        post(client, "/cgi-bin/kf/knowledge/mod_intent", officialRequest(params, "intent_id")),
    delete_knowledge_intent: (client, params) =>
        post(client, "/cgi-bin/kf/knowledge/del_intent", {
            intent_id: requireString(params, "intent_id"),
        }),
    list_knowledge_intents: (client, params) =>
        post(
            client,
            "/cgi-bin/kf/knowledge/list_intent",
            pageRequest(params, "group_id", "intent_id"),
        ),
} satisfies Readonly<Record<string, PlatformActionHandler<WeComKfClient>>>;

function post(
    client: WeComKfClient,
    path: string,
    body: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    return client.call({ method: "POST", path, body });
}

function officialRequest(
    params: Readonly<Record<string, unknown>>,
    requiredField: string,
): Record<string, unknown> {
    const request = params.request;
    if (!isRecord(request)) invalid("request 必须是官方请求对象");
    requireString(request, requiredField);
    return structuredClone(request);
}

function pageRequest(
    params: Readonly<Record<string, unknown>>,
    ...idFields: readonly string[]
): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const cursor = optionalString(params, "cursor");
    if (cursor) result.cursor = cursor;
    const limit = params.limit;
    if (limit !== undefined) {
        if (!Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 1000)
            invalid("limit 必须是 1 到 1000 的整数");
        result.limit = limit;
    }
    for (const field of idFields) {
        const value = optionalString(params, field);
        if (value) result[field] = value;
    }
    return result;
}

function requireString(params: Readonly<Record<string, unknown>>, name: string): string {
    const value = params[name];
    if (typeof value !== "string" || !value) invalid(`${name} 必须是非空字符串`);
    return value;
}

function requireGroupName(params: Readonly<Record<string, unknown>>): string {
    const name = requireString(params, "name");
    if (Array.from(name).length > 12) invalid("name 不能超过 12 个字符");
    return name;
}

function optionalString(
    params: Readonly<Record<string, unknown>>,
    name: string,
): string | undefined {
    const value = params[name];
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !value) invalid(`${name} 必须是非空字符串`);
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalid(message: string): never {
    throw new WeComKfError(`微信客服知识库 ${message}`, {
        code: "WECOM_KF_INVALID_PARAMETER",
    });
}
