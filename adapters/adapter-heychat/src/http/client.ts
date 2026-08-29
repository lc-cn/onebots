import { randomUUID } from "node:crypto";
import type { Agent } from "node:http";
import { createHttpsProxyAgent } from "onebots";
import { HeychatApiError, normalizeHeychatErrorCode } from "../errors.js";
import { createHeychatAckId } from "../utils.js";
import type {
    HeychatApiRequestOptions,
    HeychatApiResponse,
    HeychatConfig,
    HeychatOutboundMessage,
    HeychatRoomInfo,
    HeychatRoomListResult,
    HeychatRoomUsersResult,
    HeychatRoomViewResult,
    HeychatSendMessageResult,
} from "../types.js";

const DEFAULT_API_BASE = "https://chat.xiaoheihe.cn";
const DEFAULT_UPLOAD_BASE = "https://chat-upload.xiaoheihe.cn";
const DEFAULT_CHAT_VERSION = "1.30.0";
const DEFAULT_TIMEOUT = 30_000;

interface RawResponse {
    status: number;
    statusText: string;
    text: string;
}

/** 黑盒语音 REST 客户端；所有标准动作和扩展动作共享同一鉴权与错误边界。 */
export class HeychatHttpClient {
    private readonly token: string;
    private readonly apiBase: string;
    private readonly uploadBase: string;
    private readonly chatVersion: string;
    private readonly timeoutMs: number;
    private readonly proxy?: HeychatConfig["proxy"];

    constructor(config: HeychatConfig) {
        this.token = config.token;
        this.apiBase = normalizeBaseUrl(config.api_base_url || DEFAULT_API_BASE, "api_base_url");
        this.uploadBase = normalizeBaseUrl(
            config.upload_base_url || DEFAULT_UPLOAD_BASE,
            "upload_base_url",
        );
        this.chatVersion = config.chat_version || DEFAULT_CHAT_VERSION;
        this.timeoutMs = Math.max(1_000, config.request_timeout_ms || DEFAULT_TIMEOUT);
        this.proxy = config.proxy;
    }

    async callApi<T = unknown>(path: string, options: HeychatApiRequestOptions = {}): Promise<T> {
        const method = options.method || "GET";
        const url = this.buildUrl(path, options.query);
        const body =
            options.body === undefined ? undefined : Buffer.from(JSON.stringify(options.body));
        return this.request<T>(url, method, body, {
            accept: "application/json, text/plain, */*",
            ...(body ? { "content-type": "application/json;charset=UTF-8" } : {}),
        });
    }

    async uploadMedia(
        data: Uint8Array,
        filename: string,
        contentType = "application/octet-stream",
    ): Promise<string> {
        if (!data.byteLength) {
            throw new HeychatApiError("上传媒体文件不能为空", {
                code: "HEYCHAT_INVALID_UPLOAD",
            });
        }
        const boundary = `onebots-${randomUUID()}`;
        const safeFilename = filename.replace(/[\r\n"]/gu, "_") || "upload.bin";
        const prefix = Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeFilename}"\r\n` +
                `Content-Type: ${contentType}\r\n\r\n`,
        );
        const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
        const body = Buffer.concat([prefix, Buffer.from(data), suffix]);
        const result = await this.request<{ url?: string }>(
            this.buildUrl("/upload", undefined, this.uploadBase),
            "POST",
            body,
            {
                accept: "application/json, text/plain, */*",
                "content-type": `multipart/form-data; boundary=${boundary}`,
                "content-length": String(body.byteLength),
            },
        );
        if (!result.url) {
            throw new HeychatApiError("上传接口未返回媒体 URL", {
                code: "HEYCHAT_INVALID_UPLOAD_RESPONSE",
                details: result,
            });
        }
        return result.url;
    }

    async sendChannelMessage(
        roomId: string,
        channelId: string,
        message: HeychatOutboundMessage,
    ): Promise<HeychatSendMessageResult> {
        const ackId = createHeychatAckId();
        const result = await this.callApi<Record<string, unknown>>(
            "/chatroom/v2/channel_msg/send",
            {
                method: "POST",
                body: {
                    ...message,
                    room_id: roomId,
                    channel_id: channelId,
                    channel_type: 1,
                    heychat_ack_id: ackId,
                },
            },
        );
        return messageResult(result, ackId);
    }

    async sendPrivateMessage(
        userId: string,
        message: HeychatOutboundMessage,
    ): Promise<HeychatSendMessageResult> {
        const ackId = createHeychatAckId();
        const result = await this.callApi<Record<string, unknown>>("/chatroom/v3/msg/user", {
            method: "POST",
            body: {
                ...message,
                to_user_id: numericId(userId, "to_user_id"),
                heychat_ack_id: ackId,
            },
        });
        return messageResult(result, ackId);
    }

    async deleteChannelMessage(roomId: string, channelId: string, msgId: string): Promise<void> {
        await this.callApi("/chatroom/v2/channel_msg/delete", {
            method: "POST",
            body: { room_id: roomId, channel_id: channelId, msg_id: msgId },
        });
    }

    async getRoomInfo(roomId: string): Promise<HeychatRoomInfo> {
        const result = await this.getRoomView(roomId);
        const room: Partial<HeychatRoomInfo> = result.room || {};
        return {
            ...room,
            room_id: String(room.room_id || result.room_id || roomId),
            room_name: stringProperty(room, "room_name", "name"),
            room_avatar: stringProperty(room, "room_avatar", "avatar"),
            member_count: numberProperty(room, "member_count", "user_count"),
        };
    }

    getRoomView(roomId: string): Promise<HeychatRoomViewResult> {
        return this.callApi("/chatroom/v2/room/view", {
            query: { room_id: roomId },
        });
    }

    async listJoinedRooms(): Promise<HeychatRoomInfo[]> {
        const rooms: HeychatRoomInfo[] = [];
        for (let offset = 0; ; offset += 50) {
            const page = await this.callApi<HeychatRoomListResult>("/chatroom/v2/room/joined", {
                query: { offset, limit: 50 },
            });
            const values = page.rooms || [];
            rooms.push(...values);
            if (!values.length || rooms.length >= (page.total ?? rooms.length)) break;
        }
        return rooms;
    }

    async listRoomUsers(
        roomId: string,
        userId?: string,
        offset = 0,
        limit = 50,
    ): Promise<HeychatRoomUsersResult> {
        return this.callApi("/chatroom/v2/room/users", {
            query: {
                room_id: roomId,
                offset,
                limit: userId ? 1 : Math.min(50, Math.max(1, limit)),
                heybox_id: userId ? numericId(userId, "heybox_id") : undefined,
            },
        });
    }

    private buildUrl(
        path: string,
        query?: Readonly<Record<string, string | number | boolean | undefined>>,
        base = this.apiBase,
    ): URL {
        if (!path.startsWith("/") || path.startsWith("//") || path.includes("..")) {
            throw new HeychatApiError("API path 必须是安全绝对路径", {
                code: "HEYCHAT_INVALID_API_PATH",
                details: path,
            });
        }
        const url = new URL(`${base}${path}`);
        const defaults: Record<string, string> = {
            client_type: "heybox_chat",
            x_client_type: "web",
            os_type: "web",
            x_os_type: "bot",
            x_app: "heybox_chat",
            chat_os_type: "bot",
            chat_version: this.chatVersion,
        };
        for (const [key, value] of Object.entries(defaults)) url.searchParams.set(key, value);
        for (const [key, value] of Object.entries(query || {})) {
            if (value !== undefined) url.searchParams.set(key, String(value));
        }
        return url;
    }

    private async request<T>(
        url: URL,
        method: "GET" | "POST",
        body: Buffer | undefined,
        headers: Record<string, string>,
    ): Promise<T> {
        let response: RawResponse;
        try {
            response = await this.rawRequest(url, method, body, { ...headers, token: this.token });
        } catch (error) {
            throw HeychatApiError.wrap(error, "HEYCHAT_NETWORK_ERROR");
        }

        const payload = parseResponse(response.text, url.pathname);
        const message = platformMessage(payload);
        if (response.status < 200 || response.status >= 300) {
            throw new HeychatApiError(
                `黑盒语音 HTTP ${response.status}: ${message || response.statusText}`,
                {
                    code: "HEYCHAT_HTTP_ERROR",
                    status: response.status,
                    path: url.pathname,
                    details: payload,
                },
            );
        }
        if (!isSuccessfulPayload(payload)) {
            throw new HeychatApiError(`黑盒语音 API 错误: ${message || "请求失败"}`, {
                code: normalizeHeychatErrorCode(message || String(payload.status)),
                status: response.status,
                path: url.pathname,
                details: payload,
            });
        }
        return (payload.result ?? payload.data ?? payload) as T;
    }

    private async rawRequest(
        url: URL,
        method: string,
        body: Buffer | undefined,
        headers: Record<string, string>,
    ): Promise<RawResponse> {
        const transport =
            url.protocol === "https:" ? await import("node:https") : await import("node:http");
        const proxyAgent = this.proxy?.url
            ? ((await createHttpsProxyAgent(this.proxy)) as Agent | null)
            : null;
        return new Promise((resolve, reject) => {
            const request = transport.request(
                url,
                { method, headers, ...(proxyAgent ? { agent: proxyAgent } : {}) },
                response => {
                    const chunks: Buffer[] = [];
                    response.once("error", reject);
                    response.on("data", chunk => chunks.push(Buffer.from(chunk)));
                    response.on("end", () => {
                        resolve({
                            status: response.statusCode || 0,
                            statusText: response.statusMessage || "",
                            text: Buffer.concat(chunks).toString("utf8"),
                        });
                    });
                },
            );
            request.setTimeout(this.timeoutMs, () => {
                request.destroy(new Error(`请求超时（${this.timeoutMs}ms）`));
            });
            request.once("error", reject);
            if (body) request.write(body);
            request.end();
        });
    }
}

function normalizeBaseUrl(value: string, name: string): string {
    if (!URL.canParse(value)) {
        throw new HeychatApiError(`配置 ${name} 不是有效 URL`, {
            code: "HEYCHAT_INVALID_CONFIG_URL",
            details: value,
        });
    }
    const url = new URL(value);
    if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (url.protocol === "http:" && !isLoopback(url.hostname))
    ) {
        throw new HeychatApiError(
            `配置 ${name} 必须是无凭据、查询参数或片段的 HTTPS URL（本机测试可用 HTTP）`,
            {
                code: "HEYCHAT_INVALID_CONFIG_URL",
                details: value,
            },
        );
    }
    return `${url.origin}${url.pathname.replace(/\/+$/u, "")}`;
}

function isLoopback(hostname: string): boolean {
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function parseResponse(text: string, path: string): HeychatApiResponse {
    if (!text) return {};
    try {
        const value = JSON.parse(text) as unknown;
        if (value && typeof value === "object" && !Array.isArray(value)) {
            return value as HeychatApiResponse;
        }
    } catch (error) {
        throw new HeychatApiError("黑盒语音响应不是有效 JSON", {
            code: "HEYCHAT_INVALID_RESPONSE",
            path,
            details: text.slice(0, 500),
            cause: error,
        });
    }
    throw new HeychatApiError("黑盒语音响应结构无效", {
        code: "HEYCHAT_INVALID_RESPONSE",
        path,
        details: text.slice(0, 500),
    });
}

function isSuccessfulPayload(payload: HeychatApiResponse): boolean {
    return (
        payload.status === undefined ||
        payload.status === true ||
        payload.status === "true" ||
        payload.status === "ok"
    );
}

function platformMessage(payload: HeychatApiResponse): string {
    return typeof payload.msg === "string"
        ? payload.msg
        : typeof payload.message === "string"
          ? payload.message
          : "";
}

function messageResult(result: Record<string, unknown>, ackId: string): HeychatSendMessageResult {
    return {
        msg_id: String(result.msg_id || result.chatmobile_ack_id || result.heychat_ack_id || ackId),
        heychat_ack_id: String(result.heychat_ack_id || ackId),
    };
}

function numericId(value: string, name: string): number {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id < 0) {
        throw new HeychatApiError(`${name} 必须是安全整数 ID`, {
            code: "HEYCHAT_INVALID_ID",
            details: value,
        });
    }
    return id;
}

function stringProperty(value: object, ...keys: string[]): string | undefined {
    const record = value as Record<string, unknown>;
    for (const key of keys) if (typeof record[key] === "string") return record[key];
    return undefined;
}

function numberProperty(value: object, ...keys: string[]): number | undefined {
    const record = value as Record<string, unknown>;
    for (const key of keys) if (typeof record[key] === "number") return record[key];
    return undefined;
}
