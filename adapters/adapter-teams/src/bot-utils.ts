import type { WebResponse } from "@microsoft/agents-hosting";
import type { RouterContext } from "onebots";
import { TeamsApiError } from "./errors.js";
import type { TeamsConfig } from "./types.js";

/** 将 Agents SDK 的响应接口桥接到 OneBots 已有的 Koa 服务。 */
export class KoaAgentsResponse implements WebResponse {
    private ended = false;
    private sent = false;

    constructor(private readonly context: RouterContext) {}

    get headersSent(): boolean {
        return this.sent;
    }

    get writableEnded(): boolean {
        return this.ended;
    }

    status(code: number): this {
        this.context.status = code;
        return this;
    }

    setHeader(name: string, value: string): this {
        this.context.set(name, value);
        return this;
    }

    send(body?: unknown): this {
        this.context.body = body;
        this.sent = true;
        return this;
    }

    end(): this {
        this.ended = true;
        return this;
    }
}

export function normalizeHeaders(
    headers: RouterContext["headers"],
): Record<string, string | string[] | undefined> {
    return Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
    );
}

export function bodyValue(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
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
    const url = new URL(authority);
    return `${url.origin}/${encodeURIComponent(tenantId)}`;
}

export function allowedServiceUrlHosts(entries: TeamsConfig["allowed_service_urls"]): string[] {
    return (entries || []).map(entry => {
        const value = typeof entry === "string" ? entry : entry.url;
        return new URL(requireHttpsConfigUrl(value, "allowed_service_urls")).hostname;
    });
}

export function requireHttpsConfigUrl(value: string, name: string): string {
    if (!URL.canParse(value) || new URL(value).protocol !== "https:") {
        throw new TeamsApiError(`Teams 配置 ${name} 必须是有效 HTTPS URL`, {
            code: "TEAMS_INVALID_CONFIG_URL",
            details: value,
        });
    }
    return value;
}
