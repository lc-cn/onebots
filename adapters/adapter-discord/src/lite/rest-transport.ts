import type { Agent } from "node:http";
import { buildProxyUrl, createProxyAgent } from "onebots";
import { assertDiscordProxyConfig, type ProxyConfig } from "../config-types.js";
import { DiscordError } from "../errors.js";

export interface DiscordHttpRequest {
    method: string;
    headers: Record<string, string>;
    body?: string | Uint8Array;
    signal?: AbortSignal;
}

export interface DiscordHttpResponse {
    status: number;
    /** Header 名必须规范化为小写。 */
    headers: Readonly<Record<string, string>>;
    body: string;
}

export interface DiscordHttpTransport {
    request(url: string, request: DiscordHttpRequest): Promise<DiscordHttpResponse>;
}

/** Node 原生 HTTPS 与 Web Fetch 共用的无策略传输层。 */
export class DefaultDiscordHttpTransport implements DiscordHttpTransport {
    private readonly proxyUrl?: string;
    private agent: Agent | null = null;
    private agentPromise?: Promise<void>;

    constructor(proxy?: ProxyConfig) {
        assertDiscordProxyConfig(proxy);
        if (proxy?.url) this.proxyUrl = buildProxyUrl(proxy);
    }

    async request(url: string, request: DiscordHttpRequest): Promise<DiscordHttpResponse> {
        if (isNodeRuntime()) return this.nodeRequest(url, request);
        return this.fetchRequest(url, request);
    }

    private async ensureAgent(): Promise<void> {
        if (!this.proxyUrl || this.agent) return;
        if (this.agentPromise) return this.agentPromise;
        const proxyUrl = this.proxyUrl;
        const initialize = (async () => {
            const agent = await createProxyAgent({ url: proxyUrl });
            if (!agent) {
                throw DiscordError.configuration(
                    "Discord REST 代理不可用",
                    "DISCORD_PROXY_UNAVAILABLE",
                );
            }
            this.agent = agent as Agent;
        })();
        this.agentPromise = initialize;
        try {
            await initialize;
        } finally {
            if (this.agentPromise === initialize) this.agentPromise = undefined;
        }
    }

    private async nodeRequest(
        url: string,
        request: DiscordHttpRequest,
    ): Promise<DiscordHttpResponse> {
        await this.ensureAgent();
        const https = await import("node:https");
        const target = new URL(url);
        return new Promise((resolve, reject) => {
            const outgoing = https.request(
                {
                    hostname: target.hostname,
                    port: target.port || 443,
                    path: target.pathname + target.search,
                    method: request.method,
                    headers: request.headers,
                    agent: this.agent ?? undefined,
                    signal: request.signal,
                },
                response => {
                    const chunks: Buffer[] = [];
                    response.on("data", (chunk: Buffer) => chunks.push(chunk));
                    response.on("end", () => {
                        const headers: Record<string, string> = {};
                        for (const [name, value] of Object.entries(response.headers)) {
                            if (value !== undefined) {
                                headers[name.toLowerCase()] = Array.isArray(value)
                                    ? value.join(", ")
                                    : String(value);
                            }
                        }
                        resolve({
                            status: response.statusCode ?? 0,
                            headers,
                            body: Buffer.concat(chunks).toString("utf8"),
                        });
                    });
                },
            );
            outgoing.on("error", reject);
            outgoing.setTimeout(30_000, () => {
                outgoing.destroy(
                    new DiscordError("Discord REST 请求超时", {
                        code: "DISCORD_REST_TIMEOUT",
                    }),
                );
            });
            if (request.body !== undefined) outgoing.write(request.body);
            outgoing.end();
        });
    }

    private async fetchRequest(
        url: string,
        request: DiscordHttpRequest,
    ): Promise<DiscordHttpResponse> {
        if (this.proxyUrl) {
            throw DiscordError.configuration(
                "当前 Fetch 运行时不支持 Discord proxy 配置",
                "DISCORD_PROXY_RUNTIME_UNSUPPORTED",
            );
        }
        const response = await fetch(url, {
            method: request.method,
            headers: request.headers,
            signal: request.signal,
            body:
                typeof request.body === "string"
                    ? request.body
                    : request.body
                      ? new Blob([Uint8Array.from(request.body).buffer])
                      : undefined,
        });
        const headers: Record<string, string> = {};
        response.headers.forEach((value, name) => {
            headers[name.toLowerCase()] = value;
        });
        return { status: response.status, headers, body: await response.text() };
    }
}

function isNodeRuntime(): boolean {
    return typeof process !== "undefined" && process.versions?.node !== undefined;
}
