import { randomUUID } from "node:crypto";
import type { GoogleChatAuth } from "./auth.js";
import { GoogleChatError } from "./errors.js";
import type { GoogleChatCallOptions, GoogleChatConfig, GoogleChatMediaResponse } from "./types.js";
import { isRecord, parseApiBaseUrl } from "./validation.js";

export class GoogleChatTransport {
    readonly apiBaseUrl: string;

    constructor(
        config: GoogleChatConfig,
        private readonly auth: Pick<GoogleChatAuth, "accessToken">,
        private readonly fetcher: typeof fetch = fetch,
    ) {
        this.apiBaseUrl = parseApiBaseUrl(config.api_base_url || "https://chat.googleapis.com")
            .toString()
            .replace(/\/$/u, "");
    }

    async call(
        method: string,
        path: string,
        options: GoogleChatCallOptions = {},
    ): Promise<unknown> {
        if (!isSafeApiPath(path)) {
            throw GoogleChatError.invalid(
                "Google Chat API path 必须是相对 API Base 的绝对 pathname",
            );
        }
        const url = new URL(`${this.apiBaseUrl}${path}`);
        for (const [key, value] of Object.entries(options.query || {})) {
            if (Array.isArray(value)) {
                for (const entry of value) url.searchParams.append(key, entry);
            } else if (value !== undefined) {
                url.searchParams.set(key, String(value));
            }
        }
        const headers = new Headers({
            accept: "application/json",
            authorization: `Bearer ${await this.auth.accessToken()}`,
        });
        let body: BodyInit | undefined;
        if (options.upload) {
            if (options.uploadMetadata) {
                const boundary = `onebots_${randomUUID()}`;
                const media =
                    options.upload instanceof Uint8Array
                        ? new Uint8Array(options.upload)
                        : options.upload;
                body = new Blob([
                    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(options.uploadMetadata)}\r\n`,
                    `--${boundary}\r\nContent-Type: ${options.contentType || "application/octet-stream"}\r\n\r\n`,
                    media,
                    `\r\n--${boundary}--\r\n`,
                ]);
                headers.set("content-type", `multipart/related; boundary=${boundary}`);
            } else {
                body =
                    options.upload instanceof Uint8Array
                        ? new Blob([new Uint8Array(options.upload)], {
                              type: options.contentType,
                          })
                        : options.upload;
                if (options.contentType) headers.set("content-type", options.contentType);
            }
        } else if (options.body !== undefined) {
            headers.set("content-type", "application/json");
            body = JSON.stringify(options.body);
        }
        let response: Response;
        try {
            response = await this.fetcher(url, {
                method: method.toUpperCase(),
                headers,
                body,
                signal: options.signal,
            });
        } catch (error) {
            throw GoogleChatError.network(
                `Google Chat 请求失败: ${method.toUpperCase()} ${url.pathname}`,
                error,
            );
        }
        const text = await response.text();
        let payload: unknown = {};
        try {
            payload = text ? JSON.parse(text) : {};
        } catch (error) {
            throw new GoogleChatError("Google Chat 返回了非 JSON 响应", {
                code: "GOOGLE_CHAT_INVALID_RESPONSE",
                status: response.status,
                cause: error,
            });
        }
        if (!response.ok) {
            const details = isRecord(payload) ? payload : {};
            const errorBody = isRecord(details.error) ? details.error : {};
            throw new GoogleChatError(
                typeof errorBody.message === "string"
                    ? errorBody.message
                    : `Google Chat HTTP ${response.status}`,
                {
                    code:
                        typeof errorBody.status === "string"
                            ? errorBody.status
                            : "GOOGLE_CHAT_HTTP_ERROR",
                    status: response.status,
                    details,
                },
            );
        }
        if (!isRecord(payload) && !Array.isArray(payload)) {
            throw new GoogleChatError("Google Chat JSON 响应必须是对象或数组", {
                code: "GOOGLE_CHAT_INVALID_RESPONSE",
            });
        }
        return payload;
    }

    async downloadMedia(
        resourceName: string,
        signal?: AbortSignal,
    ): Promise<GoogleChatMediaResponse> {
        if (!/^spaces\/[^/]+\/attachments\/[^/]+$/u.test(resourceName)) {
            throw GoogleChatError.invalid("resourceName 不是有效的 Chat media resource name");
        }
        const url = new URL(`${this.apiBaseUrl}/v1/media/${resourceName}`);
        url.searchParams.set("alt", "media");
        let response: Response;
        try {
            response = await this.fetcher(url, {
                headers: {
                    authorization: `Bearer ${await this.auth.accessToken()}`,
                },
                signal,
            });
        } catch (error) {
            throw GoogleChatError.network(`Google Chat 媒体下载失败: ${resourceName}`, error);
        }
        if (!response.ok) {
            throw new GoogleChatError(`Google Chat 媒体下载返回 HTTP ${response.status}`, {
                code: "GOOGLE_CHAT_MEDIA_HTTP_ERROR",
                status: response.status,
            });
        }
        const length = Number(response.headers.get("content-length"));
        if (Number.isFinite(length) && length > 200 * 1024 * 1024) {
            throw GoogleChatError.invalid("Google Chat 媒体超过 200 MiB 限制");
        }
        const data = new Uint8Array(await response.arrayBuffer());
        if (data.byteLength > 200 * 1024 * 1024) {
            throw GoogleChatError.invalid("Google Chat 媒体超过 200 MiB 限制");
        }
        return {
            data,
            contentType: response.headers.get("content-type") || undefined,
            contentRange: response.headers.get("content-range") || undefined,
        };
    }
}

function isSafeApiPath(path: string): boolean {
    if (!path.startsWith("/") || path.startsWith("//") || /[\\?#\u0000-\u001f\u007f]/u.test(path)) {
        return false;
    }
    try {
        return path
            .split("/")
            .every(segment => ![".", ".."].includes(decodeURIComponent(segment).toLowerCase()));
    } catch {
        return false;
    }
}
