import { isRecord as isMetaRecord } from "@onebots/meta";
import { FacebookMessengerError } from "./errors.js";
import {
    FACEBOOK_MESSENGER_EVENT_TYPES,
    FACEBOOK_MESSENGER_WEBHOOK_FIELDS,
    type FacebookMessengerConfig,
} from "./types.js";

export const isRecord = isMetaRecord;

export function requireRecord(value: unknown, field: string): Record<string, unknown> {
    if (!isRecord(value)) throw FacebookMessengerError.invalid(`${field} 必须是对象`);
    return value;
}

export function requireString(value: unknown, field: string): string {
    if (typeof value !== "string" || !value) {
        throw FacebookMessengerError.invalid(`${field} 必须是非空字符串`);
    }
    return value;
}

export function optionalString(value: unknown, field: string): string | undefined {
    if (value === undefined || value === null) return undefined;
    return requireString(value, field);
}

export function requireNumber(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw FacebookMessengerError.invalid(`${field} 必须是有限数字`);
    }
    return value;
}

export function requireArray(value: unknown, field: string): unknown[] {
    if (!Array.isArray(value)) throw FacebookMessengerError.invalid(`${field} 必须是数组`);
    return value;
}

export function assertFacebookMessengerConfig(config: FacebookMessengerConfig): void {
    requireString(config.account_id, "account_id");
    assertNumericMetaId(config.page_id, "page_id");
    requireString(config.page_access_token, "page_access_token");
    const mode = config.receive_mode || "webhook";
    if (mode !== "webhook" && mode !== "manual") {
        throw FacebookMessengerError.invalid("receive_mode 必须是 webhook 或 manual");
    }
    if (mode === "webhook" && (!config.app_secret || !config.verify_token)) {
        throw FacebookMessengerError.invalid("webhook 模式必须配置 app_secret 与 verify_token");
    }
    if (config.http_path && !/^\/(?!\/)[^?#\u0000-\u001f\u007f]*$/u.test(config.http_path)) {
        throw FacebookMessengerError.invalid("http_path 必须是安全绝对 pathname");
    }
    if (
        config.max_body_bytes !== undefined &&
        (!Number.isSafeInteger(config.max_body_bytes) ||
            config.max_body_bytes <= 0 ||
            config.max_body_bytes > 50 * 1024 * 1024)
    ) {
        throw FacebookMessengerError.invalid("max_body_bytes 必须是 1 到 50 MiB 的安全整数");
    }
    if (config.default_messaging_type === "MESSAGE_TAG" && !config.default_message_tag) {
        throw FacebookMessengerError.invalid(
            "default_messaging_type 为 MESSAGE_TAG 时必须配置 default_message_tag",
        );
    }
    if (
        config.default_messaging_type !== undefined &&
        !["RESPONSE", "UPDATE", "MESSAGE_TAG"].includes(config.default_messaging_type)
    ) {
        throw FacebookMessengerError.invalid("default_messaging_type 无效");
    }
    assertStringList(config.subscribed_fields, "subscribed_fields");
    assertStringList(config.event_types, "event_types");
    assertStringList(config.declared_permissions, "declared_permissions");
    if (
        config.subscribed_fields?.some(
            field => !(FACEBOOK_MESSENGER_WEBHOOK_FIELDS as readonly string[]).includes(field),
        )
    ) {
        throw FacebookMessengerError.invalid("subscribed_fields 包含当前 Messenger API 未定义字段");
    }
    if (
        config.event_types?.some(
            type => !(FACEBOOK_MESSENGER_EVENT_TYPES as readonly string[]).includes(type),
        )
    ) {
        throw FacebookMessengerError.invalid("event_types 包含当前适配器未定义事件");
    }
}

export function assertMetaId(value: unknown, field: string): string {
    const id = requireString(value, field);
    if (!/^[A-Za-z0-9_.:-]+$/u.test(id)) {
        throw FacebookMessengerError.invalid(`${field} 包含不安全字符`);
    }
    return id;
}

export function assertNumericMetaId(value: unknown, field: string): string {
    const id = requireString(value, field);
    if (!/^\d+$/u.test(id)) {
        throw FacebookMessengerError.invalid(`${field} 必须是十进制 Meta ID`);
    }
    return id;
}

function assertStringList(value: unknown, field: string): void {
    if (value === undefined) return;
    const values = requireArray(value, field);
    if (values.some(item => typeof item !== "string" || !item)) {
        throw FacebookMessengerError.invalid(`${field} 必须只包含非空字符串`);
    }
    if (new Set(values).size !== values.length) {
        throw FacebookMessengerError.invalid(`${field} 不能包含重复项`);
    }
}
