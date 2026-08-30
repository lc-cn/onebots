import { definePlatformActionContract, type PlatformActionHandler } from "onebots";
import type { WeComKfClient } from "./client.js";
import { WeComKfError } from "./errors.js";
import { WECOM_KF_KNOWLEDGE_ACTION_HANDLERS } from "./knowledge-actions.js";
import { decodeKfBase64 } from "./media.js";
import type { KfCallOptions } from "./types.js";

/** 单一动作注册表同时驱动能力发现与执行，避免动作名和实现分叉。 */
const PLATFORM_ACTION_HANDLERS = {
    wecom_kf_call: (client, params) => client.call(callOptions(params)),
    sync_messages: (client, params) =>
        client.synchronize(requireString(params, "open_kfid"), optionalString(params, "token")),
    send_native_message: (client, params) =>
        client.sendMessage(
            requireString(params, "external_userid"),
            requireString(params, "open_kfid"),
            requireRecord(params, "message"),
        ),
    send_message_on_event: (client, params) =>
        client.sendMessageOnEvent(requireString(params, "code"), requireRecord(params, "message")),
    list_kf_accounts: client => client.listAccounts(),
    get_kf_account: (client, params) => client.getAccount(requireString(params, "open_kfid")),
    add_kf_account: (client, params) =>
        post(client, "/cgi-bin/kf/account/add", requireRecord(params, "account")),
    update_kf_account: (client, params) =>
        post(client, "/cgi-bin/kf/account/update", requireRecord(params, "account")),
    delete_kf_account: (client, params) =>
        post(client, "/cgi-bin/kf/account/del", {
            open_kfid: requireString(params, "open_kfid"),
        }),
    add_contact_way: (client, params) =>
        post(client, "/cgi-bin/kf/add_contact_way", {
            open_kfid: requireString(params, "open_kfid"),
            scene: optionalString(params, "scene"),
        }),
    add_servicers: (client, params) =>
        servicerOperation(client, "/cgi-bin/kf/servicer/add", params),
    delete_servicers: (client, params) =>
        servicerOperation(client, "/cgi-bin/kf/servicer/del", params),
    list_servicers: (client, params) =>
        client.call({
            path: "/cgi-bin/kf/servicer/list",
            query: { open_kfid: requireString(params, "open_kfid") },
        }),
    get_service_state: (client, params) =>
        client.getServiceState(
            requireString(params, "open_kfid"),
            requireString(params, "external_userid"),
        ),
    transfer_service_state: (client, params) =>
        client.transferServiceState(requireRecord(params, "request")),
    get_customers: (client, params) => {
        const customerIds = requireStringArray(params, "external_userids");
        if (customerIds.length > 100) invalid("external_userids 不能超过 100 项");
        return client.customerBatchGet(
            customerIds,
            optionalBoolean(params, "need_context") || false,
        );
    },
    get_upgrade_service_config: client =>
        client.call({ path: "/cgi-bin/kf/customer/get_upgrade_service_config" }),
    upgrade_service: (client, params) =>
        post(client, "/cgi-bin/kf/customer/upgrade_service", requireRecord(params, "request")),
    cancel_upgrade_service: (client, params) =>
        post(client, "/cgi-bin/kf/customer/cancel_upgrade_service", {
            open_kfid: requireString(params, "open_kfid"),
            external_userid: requireString(params, "external_userid"),
        }),
    get_corp_statistic: (client, params) =>
        post(client, "/cgi-bin/kf/get_corp_statistic", requireRecord(params, "request")),
    get_servicer_statistic: (client, params) =>
        post(client, "/cgi-bin/kf/get_servicer_statistic", requireRecord(params, "request")),
    get_corp_qualification: client => client.call({ path: "/cgi-bin/kf/get_corp_qualification" }),
    ...WECOM_KF_KNOWLEDGE_ACTION_HANDLERS,
    upload_temporary_media: uploadMedia,
    get_temporary_media: (client, params) =>
        client.call({
            path: "/cgi-bin/media/get",
            query: { media_id: requireString(params, "media_id") },
            response_type: "buffer",
        }),
} satisfies Readonly<Record<string, PlatformActionHandler<WeComKfClient>>>;

const ACTION_PARAMETERS = {
    wecom_kf_call: ["method", "path", "query", "body", "token", "response_type"],
    sync_messages: ["open_kfid", "token"],
    send_native_message: ["external_userid", "open_kfid", "message"],
    send_message_on_event: ["code", "message"],
    list_kf_accounts: [],
    get_kf_account: ["open_kfid"],
    add_kf_account: ["account"],
    update_kf_account: ["account"],
    delete_kf_account: ["open_kfid"],
    add_contact_way: ["open_kfid", "scene"],
    add_servicers: ["open_kfid", "user_ids", "department_ids"],
    delete_servicers: ["open_kfid", "user_ids", "department_ids"],
    list_servicers: ["open_kfid"],
    get_service_state: ["open_kfid", "external_userid"],
    transfer_service_state: ["request"],
    get_customers: ["external_userids", "need_context"],
    get_upgrade_service_config: [],
    upgrade_service: ["request"],
    cancel_upgrade_service: ["open_kfid", "external_userid"],
    get_corp_statistic: ["request"],
    get_servicer_statistic: ["request"],
    get_corp_qualification: [],
    add_knowledge_group: ["name"],
    update_knowledge_group: ["group_id", "name"],
    delete_knowledge_group: ["group_id"],
    list_knowledge_groups: ["cursor", "limit", "group_id"],
    add_knowledge_intent: ["request"],
    update_knowledge_intent: ["request"],
    delete_knowledge_intent: ["intent_id"],
    list_knowledge_intents: ["cursor", "limit", "group_id", "intent_id"],
    upload_temporary_media: ["type", "data", "mime_type", "filename"],
    get_temporary_media: ["media_id"],
} satisfies { readonly [TAction in keyof typeof PLATFORM_ACTION_HANDLERS]: readonly string[] };

const PLATFORM_ACTIONS = definePlatformActionContract(PLATFORM_ACTION_HANDLERS, ACTION_PARAMETERS, {
    unsupported: action =>
        new WeComKfError(`未知微信客服平台动作: ${action}`, {
            code: "WECOM_KF_UNKNOWN_ACTION",
        }),
    unexpectedParameter: (action, parameter) =>
        new WeComKfError(`微信客服动作 ${action} 不接受参数 ${parameter}`, {
            code: "WECOM_KF_INVALID_PARAMETER",
        }),
});

export const WECOM_KF_PLATFORM_ACTIONS = PLATFORM_ACTIONS.actions;
export type WeComKfPlatformAction =
    typeof WECOM_KF_PLATFORM_ACTIONS extends ReadonlySet<infer T> ? T : never;

/** 微信客服常用原生动作；wecom_kf_call 覆盖后续新增接口。 */
export async function executeWeComKfPlatformAction(
    client: WeComKfClient,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    return PLATFORM_ACTIONS.execute(client, action, params);
}

function callOptions(params: Readonly<Record<string, unknown>>): KfCallOptions {
    const methodValue = optionalString(params, "method")?.toUpperCase();
    if (methodValue && methodValue !== "GET" && methodValue !== "POST")
        invalid("method 必须是 GET 或 POST");
    const method: "GET" | "POST" | undefined =
        methodValue === "GET" || methodValue === "POST" ? methodValue : undefined;
    const responseType = optionalString(params, "response_type");
    if (responseType && responseType !== "json" && responseType !== "buffer")
        invalid("response_type 必须是 json 或 buffer");
    const options = {
        method,
        path: requireString(params, "path"),
        query: scalarRecord(params, "query"),
        body: params.body,
        token: optionalBoolean(params, "token"),
    };
    return responseType === "buffer"
        ? { ...options, response_type: "buffer" }
        : { ...options, response_type: responseType === "json" ? "json" : undefined };
}

function post(client: WeComKfClient, path: string, body: unknown): Promise<unknown> {
    return client.call({ method: "POST", path, body });
}

function servicerOperation(
    client: WeComKfClient,
    path: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    const users = stringArray(params, "user_ids");
    const departments = numberArray(params, "department_ids");
    if (!users.length && !departments.length) invalid("user_ids 与 department_ids 至少提供一项");
    return post(client, path, {
        open_kfid: requireString(params, "open_kfid"),
        userid_list: users,
        department_id_list: departments,
    });
}

async function uploadMedia(
    client: WeComKfClient,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    const type = requireString(params, "type");
    if (!isMediaType(type)) invalid("type 必须是 image/voice/video/file");
    const bytes = decodeKfBase64(requireString(params, "data"));
    return client.uploadTemporaryMedia(
        type,
        new Blob([Uint8Array.from(bytes)], {
            type: optionalString(params, "mime_type") || "application/octet-stream",
        }),
        optionalString(params, "filename") || "upload",
    );
}

function requireString(params: Readonly<Record<string, unknown>>, name: string): string {
    const value = params[name];
    if (typeof value !== "string" || !value) invalid(`${name} 必须是非空字符串`);
    return value;
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

function optionalBoolean(
    params: Readonly<Record<string, unknown>>,
    name: string,
): boolean | undefined {
    const value = params[name];
    if (value === undefined) return undefined;
    if (typeof value !== "boolean") invalid(`${name} 必须是布尔值`);
    return value;
}

function requireRecord(
    params: Readonly<Record<string, unknown>>,
    name: string,
): Record<string, unknown> {
    const value = params[name];
    if (!isRecord(value)) invalid(`${name} 必须是对象`);
    return structuredClone(value);
}

function requireStringArray(params: Readonly<Record<string, unknown>>, name: string): string[] {
    const result = stringArray(params, name);
    if (!result.length) invalid(`${name} 必须是非空字符串数组`);
    return result;
}

function stringArray(params: Readonly<Record<string, unknown>>, name: string): string[] {
    const value = params[name];
    if (value === undefined) return [];
    if (!Array.isArray(value)) invalid(`${name} 必须是字符串数组`);
    const result: string[] = [];
    for (const item of value) {
        if (typeof item !== "string" || !item) invalid(`${name} 必须是字符串数组`);
        result.push(item);
    }
    return result;
}

function numberArray(params: Readonly<Record<string, unknown>>, name: string): number[] {
    const value = params[name];
    if (value === undefined) return [];
    if (!Array.isArray(value)) invalid(`${name} 必须是数字数组`);
    const result: number[] = [];
    for (const item of value) {
        if (typeof item !== "number" || !Number.isSafeInteger(item) || item < 1) {
            invalid(`${name} 必须是正整数数组`);
        }
        result.push(item);
    }
    return result;
}

function scalarRecord(
    params: Readonly<Record<string, unknown>>,
    name: string,
): Record<string, string | number | boolean | undefined> | undefined {
    const value = params[name];
    if (value === undefined) return undefined;
    if (!isRecord(value)) invalid(`${name} 必须是对象`);
    const result: Record<string, string | number | boolean | undefined> = {};
    for (const [key, item] of Object.entries(value)) {
        if (
            item !== undefined &&
            typeof item !== "string" &&
            typeof item !== "number" &&
            typeof item !== "boolean"
        )
            invalid(`${name}.${key} 必须是标量`);
        result[key] = item;
    }
    return result;
}

function isMediaType(value: string): value is "image" | "voice" | "video" | "file" {
    return value === "image" || value === "voice" || value === "video" || value === "file";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalid(message: string): never {
    throw new WeComKfError(`微信客服 ${message}`, { code: "WECOM_KF_INVALID_PARAMETER" });
}
