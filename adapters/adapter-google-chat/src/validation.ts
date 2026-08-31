import { GoogleChatError } from "./errors.js";
import { GOOGLE_CHAT_EVENT_TYPES } from "./event-types.js";
import type { GoogleChatConfig } from "./types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertGoogleChatConfig(config: GoogleChatConfig): void {
    nonEmpty(config.account_id, "account_id");
    const authMode = config.auth_mode || "service-account";
    if (!(["service-account", "access-token"] as const).includes(authMode)) {
        throw GoogleChatError.invalid("auth_mode 必须是 service-account 或 access-token");
    }
    if (authMode === "service-account") {
        email(config.service_account_email, "service_account_email");
        if (!config.service_account_private_key?.includes("BEGIN PRIVATE KEY")) {
            throw GoogleChatError.invalid("service_account_private_key 必须是完整 PEM 私钥");
        }
    } else {
        nonEmpty(config.access_token, "access_token");
    }
    optionalStringArray(config.oauth_scopes, "oauth_scopes", value =>
        value.startsWith("https://www.googleapis.com/auth/chat."),
    );
    if (
        config.principal_name !== undefined &&
        !/^users\/(?:app|me|[A-Za-z0-9_@.+-]+)$/u.test(config.principal_name)
    ) {
        throw GoogleChatError.invalid("principal_name 必须是 users/app 或稳定的 users/{id}");
    }
    if (
        authMode === "service-account" &&
        config.principal_name &&
        config.principal_name !== "users/app"
    ) {
        throw GoogleChatError.invalid("service-account 的 principal_name 必须是 users/app");
    }
    if (authMode === "access-token" && config.principal_name === "users/app") {
        throw GoogleChatError.invalid("access-token 的 principal_name 不能是 users/app");
    }
    const receiveMode = config.receive_mode || "interaction-http";
    if (!(["interaction-http", "pubsub-push", "manual"] as const).includes(receiveMode)) {
        throw GoogleChatError.invalid("receive_mode 无效");
    }
    if (config.http_path && !/^\/(?!\/)[^?#\u0000-\u001f\u007f]*$/u.test(config.http_path)) {
        throw GoogleChatError.invalid("http_path 必须是安全的绝对 pathname");
    }
    if (receiveMode !== "manual") {
        nonEmpty(config.verification_audience, "verification_audience");
    }
    const verificationMode =
        config.verification_mode || (receiveMode === "pubsub-push" ? "pubsub" : "endpoint-url");
    if (!(["endpoint-url", "project-number", "pubsub"] as const).includes(verificationMode)) {
        throw GoogleChatError.invalid("verification_mode 无效");
    }
    if (receiveMode === "interaction-http" && verificationMode === "pubsub") {
        throw GoogleChatError.invalid("interaction-http 不能使用 pubsub 校验模式");
    }
    if (
        receiveMode === "interaction-http" &&
        verificationMode === "project-number" &&
        !/^\d+$/u.test(config.verification_audience || "")
    ) {
        throw GoogleChatError.invalid("project-number 模式的 verification_audience 必须是项目编号");
    }
    if (receiveMode === "interaction-http" && verificationMode === "endpoint-url") {
        let audience: URL;
        try {
            audience = new URL(config.verification_audience || "");
        } catch (error) {
            throw GoogleChatError.invalid("endpoint-url audience 必须是 HTTPS URL", {
                cause: String(error),
            });
        }
        if (audience.protocol !== "https:" || audience.username || audience.password) {
            throw GoogleChatError.invalid("endpoint-url audience 必须是无凭据的 HTTPS URL");
        }
    }
    if (receiveMode === "pubsub-push") {
        if (verificationMode !== "pubsub") {
            throw GoogleChatError.invalid("pubsub-push 必须使用 pubsub 校验模式");
        }
        email(config.pubsub_service_account_email, "pubsub_service_account_email");
    }
    const eventTypes = new Set<string>(GOOGLE_CHAT_EVENT_TYPES);
    optionalStringArray(config.event_types, "event_types", value => eventTypes.has(value));
    parseApiBaseUrl(config.api_base_url || "https://chat.googleapis.com");
}

export function parseApiBaseUrl(value: string): URL {
    let url: URL;
    try {
        url = new URL(value);
    } catch (error) {
        throw GoogleChatError.invalid("api_base_url 不是有效 URL", { cause: String(error) });
    }
    const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
        throw GoogleChatError.invalid("api_base_url 必须使用 HTTPS（本机测试可使用 HTTP）");
    }
    if (url.username || url.password || url.search || url.hash) {
        throw GoogleChatError.invalid("api_base_url 不得包含凭据、查询参数或片段");
    }
    return url;
}

export function requireRecord(value: unknown, field: string): Record<string, unknown> {
    if (!isRecord(value)) throw GoogleChatError.invalid(`${field} 必须是对象`);
    return value;
}

export function requireString(value: unknown, field: string): string {
    if (typeof value !== "string" || !value)
        throw GoogleChatError.invalid(`${field} 必须是非空字符串`);
    return value;
}

function nonEmpty(value: string | undefined, field: string): void {
    if (!value?.trim()) throw GoogleChatError.invalid(`${field} 不能为空`);
}

function email(value: string | undefined, field: string): void {
    nonEmpty(value, field);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value || "")) {
        throw GoogleChatError.invalid(`${field} 必须是有效邮箱地址`);
    }
}

function optionalStringArray(
    value: string[] | undefined,
    field: string,
    predicate: (item: string) => boolean,
): void {
    if (value === undefined) return;
    if (
        !Array.isArray(value) ||
        value.some(item => typeof item !== "string" || !item || !predicate(item))
    ) {
        throw GoogleChatError.invalid(`${field} 必须是有效的非空字符串数组`);
    }
    if (new Set(value).size !== value.length)
        throw GoogleChatError.invalid(`${field} 不能包含重复值`);
}
