import { createHmac } from "node:crypto";
import { MetaError } from "./errors.js";
import type {
    MetaGraphCallOptions,
    MetaGraphConfig,
    MetaGraphMethod,
    MetaGraphResult,
    MetaGraphUsage,
    MetaQueryValue,
} from "./types.js";
import {
    assertSafeGraphPath,
    isRecord,
    parseMetaApiOrigin,
    parseMetaApiVersion,
} from "./validation.js";

const DEFAULT_API_VERSION = "v25.0";
const MAX_JSON_RESPONSE_BYTES = 10 * 1024 * 1024;

/** Facebook 与 Instagram 共用的、不会泄漏 token 到 URL 的 Graph API transport。 */
export class MetaGraphTransport {
    readonly apiOrigin: string;
    readonly apiVersion: string;
    private readonly appSecretProof?: string;

    constructor(
        private readonly config: MetaGraphConfig,
        private readonly fetcher: typeof fetch = fetch,
    ) {
        if (!config.accessToken) throw MetaError.invalid("Meta access token 不能为空");
        this.apiOrigin = parseMetaApiOrigin(config.apiOrigin || "https://graph.facebook.com")
            .toString()
            .replace(/\/$/u, "");
        this.apiVersion = parseMetaApiVersion(config.apiVersion || DEFAULT_API_VERSION);
        if ((config.useAppSecretProof ?? true) && config.appSecret) {
            this.appSecretProof = createHmac("sha256", config.appSecret)
                .update(config.accessToken)
                .digest("hex");
        }
    }

    async call<T = unknown>(
        method: MetaGraphMethod,
        path: string,
        options: MetaGraphCallOptions = {},
    ): Promise<T> {
        return (await this.callWithMetadata<T>(method, path, options)).data;
    }

    async callWithMetadata<T = unknown>(
        method: MetaGraphMethod,
        path: string,
        options: MetaGraphCallOptions = {},
    ): Promise<MetaGraphResult<T>> {
        if (method !== "GET" && method !== "POST" && method !== "DELETE") {
            throw MetaError.invalid("Meta Graph method 必须是 GET、POST 或 DELETE");
        }
        assertSafeGraphPath(path);
        if (options.body !== undefined && options.form) {
            throw MetaError.invalid("Meta Graph 请求不能同时提供 body 与 form");
        }
        if (method === "GET" && (options.body !== undefined || options.form)) {
            throw MetaError.invalid("Meta Graph GET 请求不能包含 body");
        }
        const url = new URL(`${this.apiOrigin}/${this.apiVersion}${path}`);
        appendQuery(url, options.query);
        if (this.appSecretProof) url.searchParams.set("appsecret_proof", this.appSecretProof);
        const headers = new Headers({
            accept: "application/json",
            authorization: `Bearer ${this.config.accessToken}`,
        });
        let body: BodyInit | undefined;
        if (options.form) {
            body = options.form;
        } else if (options.body !== undefined) {
            headers.set("content-type", "application/json");
            body = serializeJson(options.body);
        }
        let response: Response;
        try {
            response = await this.fetcher(url, {
                method,
                headers,
                body,
                signal: options.signal,
            });
        } catch (error) {
            throw MetaError.network(`Meta Graph 请求失败: ${method} ${path}`, error);
        }
        const payload = await parseJsonResponse(response);
        if (!response.ok) throw graphError(response.status, payload);
        return { data: payload as T, usage: parseUsage(response.headers) };
    }
}

function appendQuery(url: URL, query: Readonly<Record<string, MetaQueryValue>> | undefined): void {
    for (const [key, value] of Object.entries(query || {})) {
        if (!key || /[\u0000-\u001f\u007f]/u.test(key)) {
            throw MetaError.invalid("Meta Graph query key 无效");
        }
        if (key.toLowerCase() === "access_token") {
            throw MetaError.invalid("access_token 不得放入 Meta Graph URL");
        }
        if (Array.isArray(value)) {
            for (const entry of value) url.searchParams.append(key, entry);
        } else if (value !== undefined) {
            if (typeof value === "number" && !Number.isFinite(value)) {
                throw MetaError.invalid(`Meta Graph query.${key} 必须是有限数字`);
            }
            url.searchParams.set(key, String(value));
        }
    }
}

async function parseJsonResponse(response: Response): Promise<unknown> {
    const lengthHeader = response.headers.get("content-length");
    if (lengthHeader !== null) {
        const declaredLength = Number(lengthHeader);
        if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_RESPONSE_BYTES) {
            throw responseTooLarge(response.status);
        }
    }
    const bytes = await readBoundedResponse(response, MAX_JSON_RESPONSE_BYTES);
    if (!bytes.byteLength) return {};
    const contentType = response.headers.get("content-type");
    if (contentType && !/^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/iu.test(contentType)) {
        throw new MetaError("Meta Graph 返回了非 JSON Content-Type", {
            code: "META_INVALID_RESPONSE",
            status: response.status,
            details: { content_type: contentType },
        });
    }
    try {
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch (error) {
        throw new MetaError("Meta Graph 返回了非 UTF-8 JSON 响应", {
            code: "META_INVALID_RESPONSE",
            status: response.status,
            cause: error,
        });
    }
}

function serializeJson(value: unknown): string {
    assertJsonValue(value, "body", new WeakSet<object>());
    try {
        const serialized = JSON.stringify(value);
        if (serialized === undefined) throw new TypeError("root value is not JSON serializable");
        return serialized;
    } catch (error) {
        throw MetaError.invalid("Meta Graph body 不是可序列化 JSON", { cause: String(error) });
    }
}

function assertJsonValue(value: unknown, path: string, seen: WeakSet<object>): void {
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number") {
        if (!Number.isFinite(value)) throw MetaError.invalid(`${path} 必须是有限数字`);
        return;
    }
    if (typeof value !== "object") throw MetaError.invalid(`${path} 不是 JSON 值`);
    if (seen.has(value)) throw MetaError.invalid(`${path} 包含循环引用`);
    seen.add(value);
    if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
            if (!(index in value)) throw MetaError.invalid(`${path} 不能包含稀疏数组项`);
        }
        value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`, seen));
    } else {
        if (Object.getPrototypeOf(value) !== Object.prototype) {
            throw MetaError.invalid(`${path} 必须是普通 JSON 对象`);
        }
        for (const [key, item] of Object.entries(value)) {
            assertJsonValue(item, `${path}.${key}`, seen);
        }
    }
    seen.delete(value);
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<Uint8Array> {
    if (!response.body) return new Uint8Array();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) {
                await reader.cancel("Meta Graph response exceeds safety limit");
                throw responseTooLarge(response.status);
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return result;
}

function responseTooLarge(status: number): MetaError {
    return new MetaError("Meta Graph JSON 响应超过 10 MiB", {
        code: "META_RESPONSE_TOO_LARGE",
        status,
    });
}

function graphError(status: number, payload: unknown): MetaError {
    const root = isRecord(payload) ? payload : {};
    const error = isRecord(root.error) ? root.error : {};
    const details: Record<string, unknown> = {
        type: error.type,
        graph_code: error.code,
        error_subcode: error.error_subcode,
        is_transient: error.is_transient,
        error_user_title: error.error_user_title,
        error_user_msg: error.error_user_msg,
        fbtrace_id: error.fbtrace_id,
    };
    return new MetaError(
        typeof error.message === "string" ? error.message : `Meta Graph HTTP ${status}`,
        {
            code:
                typeof error.code === "number"
                    ? `META_GRAPH_${error.code}`
                    : "META_GRAPH_HTTP_ERROR",
            status,
            details,
        },
    );
}

function parseUsage(headers: Headers): MetaGraphUsage {
    return {
        app: parseJsonHeader(headers.get("x-app-usage")),
        page: parseJsonHeader(headers.get("x-page-usage")),
        businessUseCase: parseJsonHeader(headers.get("x-business-use-case-usage")),
        traceId: headers.get("x-fb-trace-id") || undefined,
    };
}

function parseJsonHeader(value: string | null): unknown {
    if (!value) return undefined;
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}
