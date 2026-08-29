import type { WebResponse } from "@microsoft/agents-hosting";
import { TeamsApiError } from "./errors.js";
import type { TeamsConfig, TeamsHttpContext, TeamsHttpResponse } from "./types.js";

/** 在内存中实现 Agents SDK 响应接口，作为所有 HTTP Host 的单一结构化边界。 */
export class StructuredAgentsResponse implements WebResponse {
    private ended = false;
    private sent = false;
    private statusCode = 200;
    private readonly headers: Record<string, string> = {};
    private body: unknown;

    get headersSent(): boolean {
        return this.sent;
    }

    get writableEnded(): boolean {
        return this.ended;
    }

    status(code: number): this {
        this.statusCode = code;
        return this;
    }

    setHeader(name: string, value: string): this {
        this.headers[name] = value;
        return this;
    }

    send(body?: unknown): this {
        this.body = body;
        this.sent = true;
        return this;
    }

    end(): this {
        this.ended = true;
        this.sent = true;
        return this;
    }

    toResponse(): TeamsHttpResponse {
        return {
            status: this.statusCode,
            headers: { ...this.headers },
            ...(this.body === undefined ? {} : { body: this.body }),
        };
    }
}

export function normalizeHeaders(
    headers: Readonly<Record<string, unknown>>,
): Record<string, string | string[] | undefined> {
    const normalized: Record<string, string | string[] | undefined> = {};
    for (const [key, value] of Object.entries(headers)) {
        if (
            typeof value === "string" ||
            (Array.isArray(value) && value.every(item => typeof item === "string"))
        ) {
            normalized[key.toLowerCase()] = value;
        }
    }
    return normalized;
}

/** 将宿主无关响应写回 OneBots/Koa Context。 */
export function applyTeamsHttpResponse(
    context: TeamsHttpContext,
    response: TeamsHttpResponse,
): void {
    context.status = response.status;
    for (const [name, value] of Object.entries(response.headers)) context.set(name, value);
    context.body = response.body;
}

export function resolveTeamsWebhookPath(config: TeamsConfig, defaultPath: string): string {
    const path = config.webhook_path || defaultPath;
    if (!/^\/(?!\/)(?:[^?#\u0000-\u001f\u007f])*$/u.test(path)) {
        throw TeamsApiError.invalid(
            "Teams webhook_path 必须是安全的绝对路径",
            "TEAMS_INVALID_WEBHOOK_PATH",
        );
    }
    return path;
}

export function resolveTeamsReceiveMode(config: TeamsConfig): "webhook" | "manual" {
    const mode = config.receive_mode || "webhook";
    if (mode !== "webhook" && mode !== "manual") {
        throw TeamsApiError.invalid(
            "Teams receive_mode 仅支持 webhook 或 manual",
            "TEAMS_INVALID_RECEIVE_MODE",
            { receive_mode: mode },
        );
    }
    return mode;
}

export function bodyValue(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw TeamsApiError.invalid("Teams Activity 请求体必须是对象", "TEAMS_ACTIVITY_INVALID");
    }
    const body = value as Record<string, unknown>;
    if (typeof body.type !== "string" || !body.type) {
        throw TeamsApiError.invalid("Teams Activity 请求体缺少 type", "TEAMS_ACTIVITY_INVALID");
    }
    return body;
}

export async function responsePayload(response: Response): Promise<unknown> {
    if (response.status === 204) return undefined;
    const text = await response.text();
    if (!text) return undefined;
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return text;
    }
}

export function recordValue(value: unknown, key: string): unknown {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)[key]
        : undefined;
}

export function recordString(value: unknown, key: string): string | undefined {
    const result = recordValue(value, key);
    return typeof result === "string" ? result : undefined;
}

export function graphErrorCode(value: unknown): string {
    const error = recordValue(value, "error");
    return recordString(error, "code") || "TEAMS_GRAPH_API_ERROR";
}

export function graphTokenAuthority(authority: string, tenantId: string): string {
    const url = new URL(requireHttpsConfigUrl(authority, "authority_endpoint"));
    return `${url.origin}/${encodeURIComponent(tenantId)}`;
}

export function allowedServiceUrlHosts(entries: TeamsConfig["allowed_service_urls"]): string[] {
    return (entries || []).map(entry => {
        const value = typeof entry === "string" ? entry : entry.url;
        return new URL(requireHttpsConfigUrl(value, "allowed_service_urls")).hostname;
    });
}

export function requireHttpsConfigUrl(value: string, name: string): string {
    if (!URL.canParse(value)) {
        throw new TeamsApiError(`Teams 配置 ${name} 必须是有效 HTTPS URL`, {
            code: "TEAMS_INVALID_CONFIG_URL",
            details: value,
        });
    }
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
        throw new TeamsApiError(`Teams 配置 ${name} 必须是无凭据、query 和 fragment 的 HTTPS URL`, {
            code: "TEAMS_INVALID_CONFIG_URL",
            details: value,
        });
    }
    return value;
}
