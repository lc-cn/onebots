import { WeComKfError } from "./errors.js";
import type {
    KfAccount,
    KfCustomer,
    KfCustomerBatchGetResponse,
    KfJsonResponse,
    KfMediaUploadResponse,
    KfMsgItem,
    KfSendMsgResponse,
    KfServiceStateResponse,
    KfSyncMsgResponse,
    KfTokenResponse,
} from "./types.js";

/** 验证所有微信客服 JSON API 共享的 `errcode` / `errmsg` envelope。 */
export function decodeKfEnvelope(payload: unknown, path: string): KfJsonResponse {
    const value = record(payload, path);
    if (!Number.isSafeInteger(value.errcode) || typeof value.errmsg !== "string") {
        throw invalid(path, "响应缺少有效的 errcode 或 errmsg", payload);
    }
    return value as KfJsonResponse;
}

export function decodeKfToken(payload: KfJsonResponse, path: string): KfTokenResponse {
    const accessToken = optionalString(payload, "access_token", path);
    const expiresIn = optionalInteger(payload, "expires_in", path);
    if (!accessToken || !expiresIn || expiresIn <= 0)
        throw invalid(path, "access_token 响应缺少有效凭证或过期时间", payload);
    return { ...payload, access_token: accessToken, expires_in: expiresIn };
}

export function decodeKfSync(payload: KfJsonResponse, path: string): KfSyncMsgResponse {
    const hasMore = optionalInteger(payload, "has_more", path);
    if (hasMore !== undefined && hasMore !== 0 && hasMore !== 1)
        throw invalid(path, "has_more 必须是 0 或 1", payload);
    const list = optionalArray(payload, "msg_list", path)?.map((item, index) =>
        decodeMessage(item, `${path}.msg_list[${index}]`),
    );
    return {
        ...payload,
        next_cursor: optionalString(payload, "next_cursor", path),
        has_more: hasMore,
        msg_list: list,
    };
}

export function decodeKfSend(payload: KfJsonResponse, path: string): KfSendMsgResponse {
    return { ...payload, msgid: optionalString(payload, "msgid", path) };
}

export function decodeKfAccounts(payload: KfJsonResponse, path: string): KfAccount[] {
    return (optionalArray(payload, "account_list", path) || []).map((item, index) => {
        const account = record(item, `${path}.account_list[${index}]`);
        return {
            open_kfid: requiredString(account, "open_kfid", path),
            name: optionalString(account, "name", path),
            avatar: optionalString(account, "avatar", path),
            manage_privilege: optionalBoolean(account, "manage_privilege", path),
        };
    });
}

export function decodeKfCustomers(
    payload: KfJsonResponse,
    path: string,
): KfCustomerBatchGetResponse {
    const customers = optionalArray(payload, "customer_list", path)?.map((item, index) => {
        const customer = record(item, `${path}.customer_list[${index}]`);
        return {
            external_userid: requiredString(customer, "external_userid", path),
            nickname: optionalString(customer, "nickname", path),
            avatar: optionalString(customer, "avatar", path),
            gender: optionalInteger(customer, "gender", path),
            unionid: optionalString(customer, "unionid", path),
            enter_session_context: optionalRecord(customer, "enter_session_context", path),
        } satisfies KfCustomer;
    });
    return {
        ...payload,
        customer_list: customers,
        invalid_external_userid: optionalStringArray(payload, "invalid_external_userid", path),
    };
}

export function decodeKfServiceState(
    payload: KfJsonResponse,
    path: string,
): KfServiceStateResponse {
    return {
        ...payload,
        service_state: optionalInteger(payload, "service_state", path),
        servicer_userid: optionalString(payload, "servicer_userid", path),
    };
}

export function decodeKfMediaUpload(payload: KfJsonResponse, path: string): KfMediaUploadResponse {
    const type = optionalString(payload, "type", path);
    if (type !== undefined && !isMediaType(type))
        throw invalid(path, "type 不是有效临时素材类型", payload);
    return {
        ...payload,
        type,
        media_id: requiredString(payload, "media_id", path),
        created_at: optionalInteger(payload, "created_at", path),
    };
}

function isMediaType(value: string): value is "image" | "voice" | "video" | "file" {
    return value === "image" || value === "voice" || value === "video" || value === "file";
}

function decodeMessage(payload: unknown, path: string): KfMsgItem {
    const item = record(payload, path);
    optionalString(item, "msgid", path);
    optionalString(item, "open_kfid", path);
    optionalString(item, "external_userid", path);
    optionalString(item, "servicer_userid", path);
    optionalString(item, "msgtype", path);
    optionalInteger(item, "send_time", path);
    optionalInteger(item, "origin", path);
    if (item.event !== undefined) record(item.event, `${path}.event`);
    return item as KfMsgItem;
}

function record(value: unknown, path: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw invalid(path, "响应应为对象", value);
    return value as Record<string, unknown>;
}

function optionalRecord(
    value: Record<string, unknown>,
    field: string,
    path: string,
): Record<string, unknown> | undefined {
    return value[field] === undefined ? undefined : record(value[field], `${path}.${field}`);
}

function requiredString(value: Record<string, unknown>, field: string, path: string): string {
    const result = optionalString(value, field, path);
    if (!result) throw invalid(path, `${field} 必须是非空字符串`, value);
    return result;
}

function optionalString(
    value: Record<string, unknown>,
    field: string,
    path: string,
): string | undefined {
    const result = value[field];
    if (result === undefined) return undefined;
    if (typeof result !== "string") throw invalid(path, `${field} 必须是字符串`, value);
    return result || undefined;
}

function optionalInteger(
    value: Record<string, unknown>,
    field: string,
    path: string,
): number | undefined {
    const result = value[field];
    if (result === undefined) return undefined;
    if (typeof result !== "number" || !Number.isSafeInteger(result))
        throw invalid(path, `${field} 必须是安全整数`, value);
    return result;
}

function optionalBoolean(
    value: Record<string, unknown>,
    field: string,
    path: string,
): boolean | undefined {
    const result = value[field];
    if (result === undefined) return undefined;
    if (typeof result !== "boolean") throw invalid(path, `${field} 必须是布尔值`, value);
    return result;
}

function optionalArray(
    value: Record<string, unknown>,
    field: string,
    path: string,
): unknown[] | undefined {
    const result = value[field];
    if (result === undefined) return undefined;
    if (!Array.isArray(result)) throw invalid(path, `${field} 必须是数组`, value);
    return result;
}

function optionalStringArray(
    value: Record<string, unknown>,
    field: string,
    path: string,
): string[] | undefined {
    const result = optionalArray(value, field, path);
    if (!result) return undefined;
    const strings: string[] = [];
    for (const item of result) {
        if (typeof item !== "string") throw invalid(path, `${field} 必须是字符串数组`, value);
        strings.push(item);
    }
    return strings;
}

function invalid(path: string, message: string, details: unknown): WeComKfError {
    return new WeComKfError(`微信客服 API ${message}`, {
        code: "WECOM_KF_INVALID_RESPONSE",
        path,
        details,
    });
}
