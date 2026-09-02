import { isRecord as isMetaRecord } from "@onebots/meta";
import { InstagramError } from "./errors.js";
import { INSTAGRAM_EVENT_TYPES, INSTAGRAM_WEBHOOK_FIELDS, type InstagramConfig } from "./types.js";

export const isRecord = isMetaRecord;

export function requireRecord(value: unknown, field: string): Record<string, unknown> {
    if (!isRecord(value)) throw InstagramError.invalid(`${field} 必须是对象`);
    return value;
}

export function requireString(value: unknown, field: string): string {
    if (typeof value !== "string" || !value) {
        throw InstagramError.invalid(`${field} 必须是非空字符串`);
    }
    return value;
}

export function optionalString(value: unknown, field: string): string | undefined {
    if (value === undefined || value === null) return undefined;
    return requireString(value, field);
}

export function requireNumber(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw InstagramError.invalid(`${field} 必须是有限数字`);
    }
    return value;
}

export function requireArray(value: unknown, field: string): unknown[] {
    if (!Array.isArray(value)) throw InstagramError.invalid(`${field} 必须是数组`);
    return value;
}

export function assertInstagramConfig(config: InstagramConfig): void {
    requireString(config.account_id, "account_id");
    assertNumericMetaId(config.instagram_user_id, "instagram_user_id");
    requireString(config.access_token, "access_token");
    const mode = config.receive_mode || "webhook";
    if (mode !== "webhook" && mode !== "manual") {
        throw InstagramError.invalid("receive_mode 必须是 webhook 或 manual");
    }
    if (mode === "webhook" && (!config.app_secret || !config.verify_token)) {
        throw InstagramError.invalid("webhook 模式必须配置 app_secret 与 verify_token");
    }
    if (config.http_path && !/^\/(?!\/)[^?#\u0000-\u001f\u007f]*$/u.test(config.http_path)) {
        throw InstagramError.invalid("http_path 必须是安全绝对 pathname");
    }
    if (
        config.max_body_bytes !== undefined &&
        (!Number.isSafeInteger(config.max_body_bytes) ||
            config.max_body_bytes <= 0 ||
            config.max_body_bytes > 50 * 1024 * 1024)
    ) {
        throw InstagramError.invalid("max_body_bytes 必须是 1 到 50 MiB 的安全整数");
    }
    assertStringList(config.subscribed_fields, "subscribed_fields");
    assertStringList(config.event_types, "event_types");
    assertStringList(config.declared_permissions, "declared_permissions");
    if (
        config.subscribed_fields?.some(
            field => !(INSTAGRAM_WEBHOOK_FIELDS as readonly string[]).includes(field),
        )
    ) {
        throw InstagramError.invalid("subscribed_fields 包含当前 Instagram API 未定义字段");
    }
    if (
        config.event_types?.some(
            type => !(INSTAGRAM_EVENT_TYPES as readonly string[]).includes(type),
        )
    ) {
        throw InstagramError.invalid("event_types 包含当前适配器未定义事件");
    }
}

export function assertMetaId(value: unknown, field: string): string {
    const id = requireString(value, field);
    if (!/^[A-Za-z0-9_.:-]+$/u.test(id)) {
        throw InstagramError.invalid(`${field} 包含不安全字符`);
    }
    return id;
}

export function assertNumericMetaId(value: unknown, field: string): string {
    const id = requireString(value, field);
    if (!/^\d+$/u.test(id)) {
        throw InstagramError.invalid(`${field} 必须是十进制 Meta ID`);
    }
    return id;
}

export function assertHttpsUrl(value: unknown, field: string): string {
    const raw = requireString(value, field);
    if (!URL.canParse(raw)) throw InstagramError.invalid(`${field} 不是有效 URL`);
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) {
        throw InstagramError.invalid(`${field} 必须是无凭据 HTTPS URL`);
    }
    return url.toString();
}

function assertStringList(value: unknown, field: string): void {
    if (value === undefined) return;
    const values = requireArray(value, field);
    if (values.some(item => typeof item !== "string" || !item)) {
        throw InstagramError.invalid(`${field} 必须只包含非空字符串`);
    }
    if (new Set(values).size !== values.length) {
        throw InstagramError.invalid(`${field} 不能包含重复项`);
    }
}
