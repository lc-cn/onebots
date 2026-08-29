import type { WeComKfClient } from "./client.js";
import { WeComKfError } from "./errors.js";
import { decodeKfBase64 } from "./media.js";
import type { KfCallOptions } from "./types.js";

export const WECOM_KF_PLATFORM_ACTIONS = new Set([
    "wecom_kf_call",
    "sync_messages",
    "send_native_message",
    "send_message_on_event",
    "list_kf_accounts",
    "get_kf_account",
    "add_kf_account",
    "update_kf_account",
    "delete_kf_account",
    "add_contact_way",
    "add_servicers",
    "delete_servicers",
    "list_servicers",
    "get_service_state",
    "transfer_service_state",
    "get_customers",
    "get_upgrade_service_config",
    "upgrade_service",
    "cancel_upgrade_service",
    "get_corp_statistic",
    "get_servicer_statistic",
    "get_corp_qualification",
    "upload_temporary_media",
    "get_temporary_media",
]);

/** 微信客服常用原生动作；wecom_kf_call 覆盖后续新增接口。 */
export function executeWeComKfPlatformAction(
    client: WeComKfClient,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    switch (action) {
        case "wecom_kf_call":
            return client.call(callOptions(params));
        case "sync_messages":
            return client.synchronize(
                requireString(params, "open_kfid"),
                optionalString(params, "token"),
            );
        case "send_native_message":
            return client.sendMessage(
                requireString(params, "external_userid"),
                requireString(params, "open_kfid"),
                requireRecord(params, "message"),
            );
        case "send_message_on_event":
            return client.sendMessageOnEvent(
                requireString(params, "code"),
                requireRecord(params, "message"),
            );
        case "list_kf_accounts":
            return client.listAccounts();
        case "get_kf_account":
            return client.getAccount(requireString(params, "open_kfid"));
        case "add_kf_account":
            return post(client, "/cgi-bin/kf/account/add", requireRecord(params, "account"));
        case "update_kf_account":
            return post(client, "/cgi-bin/kf/account/update", requireRecord(params, "account"));
        case "delete_kf_account":
            return post(client, "/cgi-bin/kf/account/del", {
                open_kfid: requireString(params, "open_kfid"),
            });
        case "add_contact_way":
            return post(client, "/cgi-bin/kf/add_contact_way", {
                open_kfid: requireString(params, "open_kfid"),
                scene: optionalString(params, "scene"),
            });
        case "add_servicers":
            return servicerOperation(client, "/cgi-bin/kf/servicer/add", params);
        case "delete_servicers":
            return servicerOperation(client, "/cgi-bin/kf/servicer/del", params);
        case "list_servicers":
            return client.call({
                path: "/cgi-bin/kf/servicer/list",
                query: { open_kfid: requireString(params, "open_kfid") },
            });
        case "get_service_state":
            return client.getServiceState(
                requireString(params, "open_kfid"),
                requireString(params, "external_userid"),
            );
        case "transfer_service_state":
            return client.transferServiceState(requireRecord(params, "request"));
        case "get_customers":
            return client.customerBatchGet(
                requireStringArray(params, "external_userids"),
                optionalBoolean(params, "need_context") || false,
            );
        case "get_upgrade_service_config":
            return client.call({ path: "/cgi-bin/kf/customer/get_upgrade_service_config" });
        case "upgrade_service":
            return post(
                client,
                "/cgi-bin/kf/customer/upgrade_service",
                requireRecord(params, "request"),
            );
        case "cancel_upgrade_service":
            return post(client, "/cgi-bin/kf/customer/cancel_upgrade_service", {
                open_kfid: requireString(params, "open_kfid"),
                external_userid: requireString(params, "external_userid"),
            });
        case "get_corp_statistic":
            return post(client, "/cgi-bin/kf/get_corp_statistic", requireRecord(params, "request"));
        case "get_servicer_statistic":
            return post(
                client,
                "/cgi-bin/kf/get_servicer_statistic",
                requireRecord(params, "request"),
            );
        case "get_corp_qualification":
            return client.call({ path: "/cgi-bin/kf/get_corp_qualification" });
        case "upload_temporary_media":
            return uploadMedia(client, params);
        case "get_temporary_media":
            return client.call({
                path: "/cgi-bin/media/get",
                query: { media_id: requireString(params, "media_id") },
                response_type: "buffer",
            });
        default:
            throw new WeComKfError(`未知微信客服平台动作: ${action}`, {
                code: "WECOM_KF_UNKNOWN_ACTION",
            });
    }
}

function callOptions(params: Readonly<Record<string, unknown>>): KfCallOptions {
    const method = optionalString(params, "method")?.toUpperCase();
    if (method && method !== "GET" && method !== "POST") invalid("method 必须是 GET 或 POST");
    const responseType = optionalString(params, "response_type");
    if (responseType && responseType !== "json" && responseType !== "buffer")
        invalid("response_type 必须是 json 或 buffer");
    return {
        method: method as KfCallOptions["method"],
        path: requireString(params, "path"),
        query: scalarRecord(params, "query"),
        body: params.body,
        token: optionalBoolean(params, "token"),
        response_type: responseType as KfCallOptions["response_type"],
    };
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
    if (!(["image", "voice", "video", "file"] as string[]).includes(type))
        invalid("type 必须是 image/voice/video/file");
    const bytes = decodeKfBase64(requireString(params, "data"));
    return client.uploadTemporaryMedia(
        type as "image" | "voice" | "video" | "file",
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
    return typeof value === "string" && value ? value : undefined;
}

function optionalBoolean(
    params: Readonly<Record<string, unknown>>,
    name: string,
): boolean | undefined {
    return typeof params[name] === "boolean" ? params[name] : undefined;
}

function requireRecord(
    params: Readonly<Record<string, unknown>>,
    name: string,
): Record<string, unknown> {
    const value = params[name];
    if (!isRecord(value)) invalid(`${name} 必须是对象`);
    return value;
}

function requireStringArray(params: Readonly<Record<string, unknown>>, name: string): string[] {
    const result = stringArray(params, name);
    if (!result.length) invalid(`${name} 必须是非空字符串数组`);
    return result;
}

function stringArray(params: Readonly<Record<string, unknown>>, name: string): string[] {
    const value = params[name];
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item))
        invalid(`${name} 必须是字符串数组`);
    return [...value] as string[];
}

function numberArray(params: Readonly<Record<string, unknown>>, name: string): number[] {
    const value = params[name];
    if (value === undefined) return [];
    if (
        !Array.isArray(value) ||
        value.some(item => typeof item !== "number" || !Number.isFinite(item))
    )
        invalid(`${name} 必须是数字数组`);
    return [...value] as number[];
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
        result[key] = item as string | number | boolean | undefined;
    }
    return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalid(message: string): never {
    throw new WeComKfError(`微信客服 ${message}`, { code: "WECOM_KF_INVALID_PARAMETER" });
}
