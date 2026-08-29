import { request as requestHttp, type Agent as HttpAgent } from "node:http";
import { request as requestHttps } from "node:https";
import { createProxyAgent } from "onebots";
import { ZulipError } from "./errors.js";
import type { ZulipConfig, ZulipHttpMethod, ZulipParams } from "./types.js";

export interface ZulipHttpRequest {
    method: ZulipHttpMethod;
    path: string;
    params?: ZulipParams;
    body?: Buffer;
    contentType?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
}

export type ZulipTransport = (request: ZulipHttpRequest) => Promise<unknown>;

/** 创建使用 Basic Auth、可选 HTTP/SOCKS 代理的 Zulip 原生 HTTP 传输。 */
export async function createZulipTransport(config: ZulipConfig): Promise<ZulipTransport> {
    const proxyAgent = config.proxy ? await createProxyAgent(config.proxy) : undefined;
    const agent = isHttpAgent(proxyAgent) ? proxyAgent : undefined;
    if (config.proxy && !agent) {
        throw new ZulipError("无法创建 Zulip 代理连接", { code: "ZULIP_PROXY_UNAVAILABLE" });
    }
    const authorization = `Basic ${Buffer.from(`${config.email}:${config.api_key}`).toString("base64")}`;
    const apiBase = new URL("api/v1/", normalizeServerUrl(config.server_url));

    return async request => {
        const target = new URL(assertZulipApiPath(request.path), apiBase);
        const form = request.body ? undefined : encodeZulipParams(request.params);
        if (request.method === "GET") {
            if (form) target.search = form;
        }
        const body = request.body || (form ? Buffer.from(form) : undefined);
        const headers: Record<string, string | number> = {
            Accept: "application/json",
            Authorization: authorization,
        };
        if (body) {
            headers["Content-Type"] =
                request.contentType || "application/x-www-form-urlencoded;charset=UTF-8";
            headers["Content-Length"] = body.byteLength;
        }
        return requestJson(target, {
            method: request.method,
            headers,
            body,
            agent,
            signal: request.signal,
            timeoutMs: request.timeoutMs,
        });
    };
}

interface NativeRequestOptions {
    method: ZulipHttpMethod;
    headers: Record<string, string | number>;
    body?: Buffer;
    agent?: HttpAgent;
    signal?: AbortSignal;
    timeoutMs?: number;
}

function requestJson(url: URL, options: NativeRequestOptions): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const request = (url.protocol === "http:" ? requestHttp : requestHttps)(
            url,
            {
                method: options.method,
                headers: options.headers,
                agent: options.agent,
                signal: options.signal,
            },
            response => {
                const chunks: Buffer[] = [];
                response.on("data", chunk => chunks.push(Buffer.from(chunk)));
                response.on("error", reject);
                response.on("end", () => {
                    const text = Buffer.concat(chunks).toString("utf8");
                    try {
                        resolve(parseZulipResponse(text, response.statusCode));
                    } catch (error) {
                        reject(error);
                    }
                });
            },
        );
        request.on("error", error => {
            if (options.signal?.aborted) {
                reject(options.signal.reason || error);
                return;
            }
            reject(
                error instanceof ZulipError
                    ? error
                    : new ZulipError("Zulip 网络请求失败", {
                          code: "ZULIP_NETWORK_ERROR",
                          cause: error,
                      }),
            );
        });
        if (options.timeoutMs) {
            request.setTimeout(options.timeoutMs, () => {
                request.destroy(
                    new ZulipError("Zulip 请求超时", { code: "ZULIP_REQUEST_TIMEOUT" }),
                );
            });
        }
        if (options.body) request.write(options.body);
        request.end();
    });
}

/** 按 Zulip API 约定将数组和对象 JSON 编码到表单参数。 */
export function encodeZulipParams(params: ZulipParams | undefined): string {
    const result = new URLSearchParams();
    for (const [key, value] of Object.entries(params || {})) {
        if (value === undefined) continue;
        if (typeof value === "object" && value !== null) result.set(key, JSON.stringify(value));
        else result.set(key, String(value));
    }
    return result.toString();
}

/** 解析 Zulip JSON envelope，并将 HTTP/平台错误转换为结构化错误。 */
export function parseZulipResponse(text: string, status?: number): unknown {
    let data: unknown;
    try {
        data = text ? JSON.parse(text) : {};
    } catch (error) {
        throw new ZulipError("Zulip 返回了无效 JSON", {
            code: "ZULIP_INVALID_JSON",
            status,
            details: text,
            cause: error,
        });
    }
    const envelope = isRecord(data) ? data : {};
    if ((status || 500) >= 400 || envelope.result === "error") {
        throw new ZulipError(stringValue(envelope.msg) || `Zulip HTTP ${status}`, {
            code: stringValue(envelope.code) || "ZULIP_API_ERROR",
            status,
            details: data,
        });
    }
    return data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function isHttpAgent(value: unknown): value is HttpAgent {
    return isRecord(value) && typeof value.addRequest === "function";
}

/** 校验底层调用只能访问当前 Zulip 组织的 API 相对路径。 */
export function assertZulipApiPath(path: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9_./{}%~-]*$/.test(path) || path.includes("..")) {
        throw new ZulipError("Zulip API path 必须是安全的相对路径", {
            code: "ZULIP_INVALID_API_PATH",
        });
    }
    return path.replace(/^\/+/, "");
}

function normalizeServerUrl(value: string): URL {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new ZulipError("server_url 仅支持 http 或 https", {
            code: "ZULIP_INVALID_SERVER_URL",
        });
    }
    if (url.username || url.password || url.search || url.hash) {
        throw new ZulipError("server_url 不能包含认证信息、查询参数或片段", {
            code: "ZULIP_INVALID_SERVER_URL",
        });
    }
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
    return url;
}
