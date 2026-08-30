import { RefreshableValue } from "onebots";
import { kfAborted, WeComKfError } from "./errors.js";
import {
    createKfApiError,
    createKfHttpError,
    isKfJsonResponse,
    kfApiErrorCode,
    parseKfJson,
    requireKfHttpsBase,
    resolveKfApiUrl,
} from "./http.js";
import { decodeKfEnvelope, decodeKfToken } from "./response-decoders.js";
import type {
    KfBufferCallOptions,
    KfCallOptions,
    KfJsonCallOptions,
    KfJsonResponse,
    WeComKfConfig,
} from "./types.js";

const DEFAULT_API_BASE = "https://qyapi.weixin.qq.com";
const TOKEN_MARGIN_MS = 120_000;
const INVALID_TOKEN_CODES = new Set([40014, 42001, 42007, 42009]);

/** 微信客服 API 的凭证缓存、请求编码、错误解码与单次失效重试边界。 */
export class KfApiTransport {
    readonly apiBaseUrl: string;
    private readonly tokens = new RefreshableValue<string>(TOKEN_MARGIN_MS);
    private tokenGeneration = 0;

    constructor(
        private readonly config: WeComKfConfig,
        private readonly fetcher: typeof fetch = fetch,
    ) {
        this.apiBaseUrl = requireKfHttpsBase(config.api_base_url || DEFAULT_API_BASE);
    }

    stop(): void {
        this.tokenGeneration += 1;
        this.tokens.clear();
    }

    async getAccessToken(force = false): Promise<string> {
        const generation = this.tokenGeneration;
        return this.tokens.get(() => this.fetchToken(generation), force);
    }

    call(options: KfBufferCallOptions): Promise<Buffer>;
    call(options: KfJsonCallOptions): Promise<KfJsonResponse>;
    call(options: KfCallOptions): Promise<KfJsonResponse | Buffer>;
    call(options: KfCallOptions): Promise<KfJsonResponse | Buffer> {
        return this.performCall(options, true);
    }

    private async fetchToken(generation: number): Promise<{ value: string; ttlMs: number }> {
        const path = "/cgi-bin/gettoken";
        const payload = await this.performCall(
            {
                path,
                token: false,
                query: { corpid: this.config.corp_id, corpsecret: this.config.corp_secret },
            },
            false,
        );
        if (Buffer.isBuffer(payload)) {
            throw new WeComKfError("access_token API 意外返回二进制内容", {
                code: "WECOM_KF_INVALID_RESPONSE",
                path,
            });
        }
        const result = decodeKfToken(payload, path);
        if (generation !== this.tokenGeneration) throw kfAborted();
        return { value: result.access_token, ttlMs: result.expires_in * 1000 };
    }

    private async performCall(
        options: KfCallOptions,
        retryToken: boolean,
    ): Promise<KfJsonResponse | Buffer> {
        const url = resolveKfApiUrl(this.apiBaseUrl, options.path, options.query);
        const requestToken = options.token === false ? undefined : await this.getAccessToken();
        if (requestToken) url.searchParams.set("access_token", requestToken);
        const headers = new Headers();
        let body: BodyInit | undefined;
        if (options.body instanceof FormData || typeof options.body === "string") {
            body = options.body;
        } else if (options.body !== undefined) {
            headers.set("Content-Type", "application/json; charset=utf-8");
            body = JSON.stringify(options.body);
        }
        let response: Response;
        try {
            response = await this.fetcher(url, {
                method: options.method || (body ? "POST" : "GET"),
                headers,
                body,
                signal: options.signal,
            });
        } catch (error) {
            if (options.signal?.aborted) throw kfAborted();
            throw new WeComKfError("微信客服 API 网络请求失败", {
                code: "WECOM_KF_NETWORK_ERROR",
                path: options.path,
                cause: error,
            });
        }
        if (options.response_type === "buffer" && !isKfJsonResponse(response)) {
            if (!response.ok) throw createKfHttpError(response, options.path);
            return Buffer.from(await response.arrayBuffer());
        }
        const payload = decodeKfEnvelope(await parseKfJson(response, options.path), options.path);
        const errorCode = kfApiErrorCode(payload);
        if (retryToken && INVALID_TOKEN_CODES.has(errorCode)) {
            if (requestToken && this.tokens.invalidate(requestToken)) {
                await this.getAccessToken(true);
            }
            return this.performCall(options, false);
        }
        if (!response.ok || errorCode !== 0) {
            throw createKfApiError(response, payload, options.path);
        }
        return payload;
    }
}
