/**
 * 企业微信 Bot 客户端
 * 基于企业微信开放平台 API，使用 fetch 实现
 */
import { EventEmitter } from "events";
import type { RouterContext } from "onebots";
import {
    decryptWechatCallbackFor,
    extractWechatEncryptedPayload,
    parseWechatXml,
    verifyWechatCallbackSignature,
} from "onebots";
import type {
    WeComConfig,
    WeComTokenResponse,
    WeComSendMessageRequest,
    WeComSendMessageResponse,
    WeComEvent,
    WeComUser,
    WeComDepartment,
    WeComUserResponse,
    WeComDepartmentListResponse,
    WeComDepartmentMembersResponse,
} from "./types.js";

const WECOM_API_BASE = "https://qyapi.weixin.qq.com";

/**
 * HTTP 请求选项
 */
interface RequestOptions {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
    params?: Record<string, string | number | boolean>;
    skipAuth?: boolean;
}

export class WeComBot extends EventEmitter {
    private config: WeComConfig;
    private accessToken: string = "";
    private tokenExpireTime: number = 0;
    private me: WeComUser | null = null;

    constructor(config: WeComConfig) {
        super();
        this.config = config;
    }

    getConfig(): Readonly<WeComConfig> {
        return this.config;
    }

    /**
     * 发送 HTTP 请求
     */
    private async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
        const { method = "GET", headers = {}, body, params, skipAuth = false } = options;

        // 构建 URL
        const url = new URL(`${WECOM_API_BASE}${path}`);
        if (params) {
            for (const [key, value] of Object.entries(params)) {
                if (value !== undefined) {
                    url.searchParams.append(key, String(value));
                }
            }
        }

        // 自动添加 token（除了获取 token 的请求）
        if (!skipAuth && !path.includes("/gettoken")) {
            const token = await this.getAccessToken();
            url.searchParams.append("access_token", token);
        }

        // 构建请求头
        const requestHeaders: Record<string, string> = {
            "Content-Type": "application/json",
            ...headers,
        };

        // 发送请求
        const response = await fetch(url.toString(), {
            method,
            headers: requestHeaders,
            body: body ? JSON.stringify(body) : undefined,
        });

        return response.json();
    }

    /**
     * GET 请求
     */
    async get<T = unknown>(
        path: string,
        params?: Record<string, string | number | boolean>,
    ): Promise<{ data: T }> {
        const data = await this.request<T>(path, { params });
        return { data };
    }

    /**
     * POST 请求
     */
    async post<T = unknown>(
        path: string,
        body?: Record<string, unknown>,
        params?: Record<string, string | number | boolean>,
    ): Promise<{ data: T }> {
        const data = await this.request<T>(path, { method: "POST", body, params });
        return { data };
    }

    /**
     * 获取访问令牌
     */
    async getAccessToken(): Promise<string> {
        if (this.accessToken && Date.now() < this.tokenExpireTime) {
            return this.accessToken;
        }

        const data = await this.request<WeComTokenResponse>("/cgi-bin/gettoken", {
            params: {
                corpid: this.config.corp_id,
                corpsecret: this.config.corp_secret,
            },
            skipAuth: true,
        });

        if (data.errcode !== 0) {
            throw new Error(`获取访问令牌失败: ${data.errmsg}`);
        }

        this.accessToken = data.access_token || "";
        this.tokenExpireTime = Date.now() + ((data.expires_in || 7200) - 60) * 1000; // 提前60秒刷新

        return this.accessToken;
    }

    /**
     * 启动 Bot
     */
    async start(): Promise<void> {
        try {
            // 获取访问令牌
            await this.getAccessToken();

            // 获取应用信息（企业微信没有直接的 getBotInfo API）
            this.me = {
                userid: this.config.agent_id,
                name: "WeCom Bot",
            };

            this.emit("ready");
        } catch (error) {
            this.emit("error", error);
            throw error;
        }
    }

    /**
     * 停止 Bot
     */
    async stop(): Promise<void> {
        this.emit("stopped");
    }

    /**
     * 处理 Webhook 请求（事件回调）
     */
    async handleWebhook(ctx: RouterContext): Promise<void> {
        const timestamp = firstQueryValue(ctx.query.timestamp);
        const nonce = firstQueryValue(ctx.query.nonce);
        const signature = firstQueryValue(ctx.query.signature);
        const messageSignature = firstQueryValue(ctx.query.msg_signature);
        const echo = firstQueryValue(ctx.query.echostr);

        try {
            if (ctx.method === "GET") {
                if (!echo || !timestamp || !nonce || !this.config.token) {
                    ctx.status = 400;
                    ctx.body = "缺少企业微信回调验证参数";
                    return;
                }

                if (messageSignature) {
                    if (
                        !verifyWechatCallbackSignature(
                            this.config.token,
                            messageSignature,
                            timestamp,
                            nonce,
                            echo,
                        )
                    ) {
                        ctx.status = 403;
                        ctx.body = "Invalid msg_signature";
                        return;
                    }
                    ctx.body = decryptWechatCallbackFor(
                        echo,
                        this.config.encoding_aes_key ?? "",
                        this.config.corp_id,
                    );
                    return;
                }

                if (
                    !signature ||
                    !verifyWechatCallbackSignature(this.config.token, signature, timestamp, nonce)
                ) {
                    ctx.status = 403;
                    ctx.body = "Invalid signature";
                    return;
                }
                ctx.body = echo;
                return;
            }

            const body = await this.readCallbackBody(ctx);
            const encrypted =
                typeof body === "string"
                    ? extractWechatEncryptedPayload(body)
                    : typeof body.Encrypt === "string"
                      ? body.Encrypt
                      : undefined;

            let fields: Record<string, string | number>;
            if (encrypted) {
                if (!this.config.token || !messageSignature || !timestamp || !nonce) {
                    throw new Error("加密回调缺少 token 或签名参数");
                }
                if (
                    !verifyWechatCallbackSignature(
                        this.config.token,
                        messageSignature,
                        timestamp,
                        nonce,
                        encrypted,
                    )
                ) {
                    ctx.status = 403;
                    ctx.body = "Invalid msg_signature";
                    return;
                }
                const xml = decryptWechatCallbackFor(
                    encrypted,
                    this.config.encoding_aes_key ?? "",
                    this.config.corp_id,
                );
                fields = parseWechatXml(xml);
            } else {
                if (this.config.token) {
                    if (
                        !signature ||
                        !timestamp ||
                        !nonce ||
                        !verifyWechatCallbackSignature(
                            this.config.token,
                            signature,
                            timestamp,
                            nonce,
                        )
                    ) {
                        ctx.status = 403;
                        ctx.body = "Invalid signature";
                        return;
                    }
                }
                fields = typeof body === "string" ? parseWechatXml(body) : toScalarRecord(body);
            }

            if (typeof fields.MsgType === "string" || typeof fields.EventType === "string") {
                this.emit("event", fields as unknown as WeComEvent);
            }
            ctx.body = "success";
        } catch (error) {
            this.emit("error", error);
            ctx.status = 400;
            ctx.body = error instanceof Error ? error.message : String(error);
        }
    }

    private async readCallbackBody(ctx: RouterContext): Promise<string | Record<string, unknown>> {
        const parsed = (ctx.request as { body?: unknown }).body;
        if (typeof parsed === "string" && parsed.length > 0) return parsed;
        if (Buffer.isBuffer(parsed) && parsed.length > 0) return parsed.toString("utf8");
        if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;

        const chunks: Buffer[] = [];
        for await (const chunk of ctx.req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw) throw new Error("企业微信回调请求体为空");
        return raw;
    }

    /**
     * 获取缓存的 Bot 信息
     */
    getCachedMe(): WeComUser | null {
        return this.me;
    }

    /**
     * 发送应用消息
     */
    async sendMessage(request: WeComSendMessageRequest): Promise<WeComSendMessageResponse> {
        const response = await this.post<WeComSendMessageResponse>("/cgi-bin/message/send", {
            ...request,
            agentid: parseInt(this.config.agent_id),
        });

        if (response.data.errcode !== 0) {
            throw new Error(`发送消息失败: ${response.data.errmsg}`);
        }

        return response.data;
    }

    /**
     * 获取用户信息
     */
    async getUserInfo(userId: string): Promise<WeComUser> {
        const response = await this.get<WeComUserResponse>("/cgi-bin/user/get", { userid: userId });

        if (response.data.errcode !== 0) {
            throw new Error(`获取用户信息失败: ${response.data.errmsg}`);
        }

        return response.data;
    }

    /**
     * 获取部门列表
     */
    async getDepartmentList(departmentId?: number): Promise<WeComDepartment[]> {
        const params: Record<string, string | number | boolean> = {};
        if (departmentId !== undefined) {
            params.id = departmentId;
        }

        const response = await this.get<WeComDepartmentListResponse>(
            "/cgi-bin/department/list",
            params,
        );

        if (response.data.errcode !== 0) {
            throw new Error(`获取部门列表失败: ${response.data.errmsg}`);
        }

        return response.data.department || [];
    }

    /**
     * 获取部门成员列表
     */
    async getDepartmentMembers(departmentId: number, fetchChild?: boolean): Promise<WeComUser[]> {
        const response = await this.get<WeComDepartmentMembersResponse>("/cgi-bin/user/list", {
            department_id: departmentId,
            fetch_child: fetchChild ? 1 : 0,
        });

        if (response.data.errcode !== 0) {
            throw new Error(`获取部门成员列表失败: ${response.data.errmsg}`);
        }

        return response.data.userlist || [];
    }

    /**
     * 获取 HTTP 客户端实例（返回 this 以便链式调用）
     */
    getHttpClient(): WeComBot {
        return this;
    }
}

function firstQueryValue(value: unknown): string | undefined {
    if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : undefined;
    return value == null ? undefined : String(value);
}

function toScalarRecord(input: Record<string, unknown>): Record<string, string | number> {
    return Object.fromEntries(
        Object.entries(input).filter(
            (entry): entry is [string, string | number] =>
                typeof entry[1] === "string" || typeof entry[1] === "number",
        ),
    );
}
