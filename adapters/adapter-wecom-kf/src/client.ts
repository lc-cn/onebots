import { EventEmitter } from "node:events";
import { loadKfCursors, persistKfCursors } from "./cursor-store.js";
import { WeComKfError } from "./errors.js";
import {
    createKfApiError,
    createKfHttpError,
    isKfJsonResponse,
    kfApiErrorCode,
    parseKfJson,
    requireKfHttpsBase,
    resolveKfApiUrl,
} from "./http.js";
import { assertKfUploadSize } from "./media.js";
import { resolveKfMessageId } from "./message-id.js";
import type {
    KfAccount,
    KfCallOptions,
    KfCallbackEvent,
    KfCustomerBatchGetResponse,
    KfMsgItem,
    KfSendMsgResponse,
    KfServiceStateResponse,
    KfSyncMsgRequest,
    KfSyncMsgResponse,
    KfTokenResponse,
    WeComKfConfig,
} from "./types.js";

const DEFAULT_API_BASE = "https://qyapi.weixin.qq.com";
const TOKEN_MARGIN_MS = 120_000;
const INVALID_TOKEN_CODES = new Set([40014, 42001, 42007, 42009]);
const MAX_SYNC_PAGES = 1000;
const MAX_ACCOUNT_PAGES = 1000;

/** Client 原生事件契约，供独立嵌入时获得完整监听器类型推断。 */
export interface WeComKfClientEvents {
    ready: [];
    stop: [];
    raw_event: [item: KfMsgItem];
    kf_item: [payload: { open_kfid: string; item: KfMsgItem }];
    callback: [event: KfCallbackEvent];
    client_error: [error: WeComKfError];
}

/** 微信客服 API 客户端、游标同步器与统一事件入口。 */
export class WeComKfClient extends EventEmitter<WeComKfClientEvents> {
    readonly apiBaseUrl: string;
    private accessToken = "";
    private tokenExpiresAt = 0;
    private tokenGeneration = 0;
    private tokenRequest?: Promise<string>;
    private pollTimer?: ReturnType<typeof setInterval>;
    private lifecycleAbort?: AbortController;
    private lifecycleGeneration = 0;
    private startRequest?: Promise<void>;
    private started = false;
    private readonly cursors = new Map<string, string>();
    private readonly seenMessageIds = new Set<string>();
    private readonly syncQueues = new Map<string, Promise<KfMsgItem[]>>();

    constructor(
        readonly config: WeComKfConfig,
        private readonly fetcher: typeof fetch = fetch,
    ) {
        super();
        this.apiBaseUrl = requireKfHttpsBase(config.api_base_url || DEFAULT_API_BASE);
    }

    /** 初始化凭证、游标与可选补偿轮询；重复调用保持幂等。 */
    async start(): Promise<void> {
        if (this.startRequest) return this.startRequest;
        if (this.started) return;
        const request = this.initialize();
        this.startRequest = request;
        try {
            await request;
        } finally {
            if (this.startRequest === request) this.startRequest = undefined;
        }
    }

    private async initialize(): Promise<void> {
        const generation = ++this.lifecycleGeneration;
        const controller = new AbortController();
        this.started = true;
        this.lifecycleAbort = controller;
        const signal = controller.signal;
        try {
            for (const [openKfid, cursor] of await loadKfCursors(this.config.cursor_store_path))
                this.cursors.set(openKfid, cursor);
            await this.getAccessToken();
            ensureNotAborted(signal);
            if (this.config.enable_sync_poll) this.startPolling();
            this.emit("ready");
        } catch (error) {
            controller.abort();
            if (this.lifecycleGeneration === generation) {
                this.started = false;
                if (this.lifecycleAbort === controller) this.lifecycleAbort = undefined;
            }
            throw error;
        }
    }

    /** 停止轮询并取消当前生命周期内尚未完成的 API 同步。 */
    stop(): void {
        if (!this.started) return;
        this.started = false;
        this.lifecycleGeneration += 1;
        this.tokenGeneration += 1;
        this.startRequest = undefined;
        if (this.pollTimer) clearInterval(this.pollTimer);
        this.pollTimer = undefined;
        this.lifecycleAbort?.abort();
        this.lifecycleAbort = undefined;
        this.accessToken = "";
        this.tokenExpiresAt = 0;
        this.tokenRequest = undefined;
        this.emit("stop");
    }

    private startPolling(): void {
        if (!this.config.open_kfid) {
            throw new WeComKfError("启用轮询时必须配置 open_kfid", {
                code: "WECOM_KF_POLL_ACCOUNT_REQUIRED",
            });
        }
        const interval = this.config.sync_poll_interval_ms ?? 30_000;
        if (!Number.isSafeInteger(interval) || interval < 5_000) {
            throw new WeComKfError("sync_poll_interval_ms 必须是不小于 5000 的整数", {
                code: "WECOM_KF_INVALID_POLL_INTERVAL",
            });
        }
        const poll = (): void => {
            void this.synchronize(this.config.open_kfid!).catch(error => {
                if (!isAborted(error))
                    this.emit("client_error", WeComKfError.wrap(error, "WECOM_KF_POLL_ERROR"));
            });
        };
        poll();
        this.pollTimer = setInterval(poll, interval);
    }

    /** 获取缓存凭证；`force` 用于平台明确报告凭证失效后的单次刷新。 */
    async getAccessToken(force = false): Promise<string> {
        if (!force && this.accessToken && Date.now() < this.tokenExpiresAt - TOKEN_MARGIN_MS)
            return this.accessToken;
        if (this.tokenRequest) return this.tokenRequest;
        const request = this.fetchToken(this.tokenGeneration);
        this.tokenRequest = request;
        try {
            return await request;
        } finally {
            if (this.tokenRequest === request) this.tokenRequest = undefined;
        }
    }

    /** 调用受限官方路径，并统一处理凭证、JSON、平台错误与一次失效重试。 */
    call<T = unknown>(options: KfCallOptions): Promise<T> {
        return this.performCall<T>(options, true);
    }

    /**
     * 分页同步指定客服账号的消息与事件。
     * @param openKfid 客服账号 ID
     * @param callbackToken 官方回调提供的临时同步凭证；补偿轮询时省略
     * @returns 去重后已投递的原始条目
     */
    async synchronize(openKfid: string, callbackToken?: string): Promise<KfMsgItem[]> {
        if (!openKfid) throw invalid("open_kfid 必须是非空字符串");
        const signal = this.lifecycleAbort?.signal;
        ensureNotAborted(signal);
        const previous = this.syncQueues.get(openKfid) || Promise.resolve([]);
        const current = previous
            .catch(() => [])
            .then(() => this.synchronizeUnlocked(openKfid, callbackToken, signal));
        this.syncQueues.set(openKfid, current);
        try {
            return await current;
        } finally {
            if (this.syncQueues.get(openKfid) === current) this.syncQueues.delete(openKfid);
        }
    }

    /** 将已有连接取得的单个 `sync_msg` 条目送入统一事件管线。 */
    ingest(item: KfMsgItem, openKfid = item.open_kfid || this.config.open_kfid || ""): void {
        this.emit("raw_event", item);
        this.emit("kf_item", { open_kfid: openKfid, item });
    }

    /** 将已验签、解密并校验的回调事件送入统一事件管线。 */
    ingestCallback(event: KfCallbackEvent): void {
        this.emit("callback", event);
    }

    /** 向指定客户会话发送原生消息，并返回受 32 字节约束的消息 ID。 */
    async sendMessage(
        externalUserid: string,
        openKfid: string,
        message: Readonly<Record<string, unknown>>,
    ): Promise<string> {
        const msgid = resolveKfMessageId(message);
        const result = await this.call<KfSendMsgResponse>({
            method: "POST",
            path: "/cgi-bin/kf/send_msg",
            body: { ...message, touser: externalUserid, open_kfid: openKfid, msgid },
        });
        return result.msgid || msgid;
    }

    /** 使用平台事件 code 发送欢迎语、排队提示或结束语。 */
    async sendMessageOnEvent(
        code: string,
        message: Readonly<Record<string, unknown>>,
    ): Promise<string> {
        const msgid = resolveKfMessageId(message);
        const result = await this.call<KfSendMsgResponse>({
            method: "POST",
            path: "/cgi-bin/kf/send_msg_on_event",
            body: { ...message, code, msgid },
        });
        return result.msgid || msgid;
    }

    /** 使用官方分页接口列出当前凭证可见的全部客服账号。 */
    async listAccounts(): Promise<KfAccount[]> {
        const accounts: KfAccount[] = [];
        const limit = 100;
        for (let pageIndex = 0; pageIndex < MAX_ACCOUNT_PAGES; pageIndex++) {
            const offset = pageIndex * limit;
            const result = await this.call<{ account_list?: KfAccount[] }>({
                method: "POST",
                path: "/cgi-bin/kf/account/list",
                body: { offset, limit },
            });
            const accountPage = result.account_list || [];
            accounts.push(...accountPage);
            if (accountPage.length < limit) return accounts;
        }
        throw new WeComKfError("客服账号分页超过安全上限", {
            code: "WECOM_KF_PAGE_LIMIT",
        });
    }

    /** 按客服账号 ID 查找账号，不存在时抛出结构化错误。 */
    async getAccount(openKfid: string): Promise<KfAccount> {
        const account = (await this.listAccounts()).find(item => item.open_kfid === openKfid);
        if (!account)
            throw new WeComKfError(`未找到微信客服账号 ${openKfid}`, {
                code: "WECOM_KF_ACCOUNT_NOT_FOUND",
            });
        return account;
    }

    /** 批量查询微信客户资料与可选的进入会话上下文。 */
    customerBatchGet(
        externalUserIds: readonly string[],
        needContext = false,
    ): Promise<KfCustomerBatchGetResponse> {
        return this.call({
            method: "POST",
            path: "/cgi-bin/kf/customer/batchget",
            body: {
                external_userid_list: [...externalUserIds],
                need_enter_session_context: needContext ? 1 : 0,
            },
        });
    }

    /** 查询指定客服账号与客户之间的官方会话状态。 */
    getServiceState(openKfid: string, externalUserid: string): Promise<KfServiceStateResponse> {
        return this.call({
            method: "POST",
            path: "/cgi-bin/kf/service_state/get",
            body: { open_kfid: openKfid, external_userid: externalUserid },
        });
    }

    /** 变更会话状态，完整请求字段按官方 `service_state/trans` 传递。 */
    transferServiceState(request: Readonly<Record<string, unknown>>): Promise<unknown> {
        return this.call({
            method: "POST",
            path: "/cgi-bin/kf/service_state/trans",
            body: request,
        });
    }

    /** 上传不超过统一安全上限的临时素材，并返回平台 `media_id`。 */
    async uploadTemporaryMedia(
        type: "image" | "voice" | "video" | "file",
        data: Blob,
        filename: string,
    ): Promise<{ media_id: string; created_at?: string }> {
        assertKfUploadSize(data.size);
        const form = new FormData();
        form.set("media", data, filename);
        return this.call({
            method: "POST",
            path: "/cgi-bin/media/upload",
            query: { type },
            body: form,
        });
    }

    private async synchronizeUnlocked(
        openKfid: string,
        callbackToken?: string,
        signal?: AbortSignal,
    ): Promise<KfMsgItem[]> {
        const collected: KfMsgItem[] = [];
        const batchIds = new Set<string>();
        let cursor = this.cursors.get(openKfid) || "";
        for (let page = 0; page < MAX_SYNC_PAGES; page++) {
            ensureNotAborted(signal);
            const request: KfSyncMsgRequest = {
                open_kfid: openKfid,
                cursor: cursor || undefined,
                token: callbackToken,
                limit: callbackToken ? 1000 : 500,
                voice_format: 0,
            };
            const result = await this.call<KfSyncMsgResponse>({
                method: "POST",
                path: "/cgi-bin/kf/sync_msg",
                body: request,
                signal,
            });
            for (const item of result.msg_list || []) {
                const id = item.msgid;
                if (
                    id &&
                    this.config.deduplicate_messages !== false &&
                    (this.seenMessageIds.has(id) || batchIds.has(id))
                )
                    continue;
                if (id) batchIds.add(id);
                collected.push(item);
            }
            const nextCursor = result.next_cursor || cursor;
            if (result.has_more !== 1) {
                cursor = nextCursor;
                break;
            }
            if (!nextCursor || nextCursor === cursor) {
                throw new WeComKfError("sync_msg 分页未推进游标", {
                    code: "WECOM_KF_STALLED_CURSOR",
                    details: result,
                });
            }
            cursor = nextCursor;
            if (page === MAX_SYNC_PAGES - 1) {
                throw new WeComKfError("sync_msg 分页超过安全上限", {
                    code: "WECOM_KF_PAGE_LIMIT",
                });
            }
        }
        ensureNotAborted(signal);
        for (const item of collected) this.ingest(item, openKfid);
        for (const id of batchIds) this.rememberMessage(id);
        this.cursors.set(openKfid, cursor);
        await persistKfCursors(this.config.cursor_store_path, this.cursors);
        return collected;
    }

    private rememberMessage(id: string): void {
        if (this.config.deduplicate_messages === false) return;
        this.seenMessageIds.add(id);
        const limit = Math.max(100, this.config.message_deduplication_limit || 10_000);
        while (this.seenMessageIds.size > limit) {
            const oldest = this.seenMessageIds.values().next().value;
            if (typeof oldest !== "string") break;
            this.seenMessageIds.delete(oldest);
        }
    }

    private async fetchToken(generation: number): Promise<string> {
        const result = await this.performCall<KfTokenResponse>(
            {
                path: "/cgi-bin/gettoken",
                token: false,
                query: { corpid: this.config.corp_id, corpsecret: this.config.corp_secret },
            },
            false,
        );
        if (!result.access_token || !result.expires_in) {
            throw new WeComKfError("access_token 响应缺少必要字段", {
                code: "WECOM_KF_INVALID_TOKEN_RESPONSE",
                details: result,
            });
        }
        if (generation !== this.tokenGeneration) throw aborted();
        this.accessToken = result.access_token;
        this.tokenExpiresAt = Date.now() + result.expires_in * 1000;
        return result.access_token;
    }

    private async performCall<T>(options: KfCallOptions, retryToken: boolean): Promise<T> {
        const url = resolveKfApiUrl(this.apiBaseUrl, options.path, options.query);
        if (options.token !== false)
            url.searchParams.set("access_token", await this.getAccessToken());
        const headers = new Headers();
        let body: BodyInit | undefined;
        if (options.body instanceof FormData || typeof options.body === "string")
            body = options.body;
        else if (options.body !== undefined) {
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
            if (options.signal?.aborted) throw aborted();
            throw new WeComKfError("微信客服 API 网络请求失败", {
                code: "WECOM_KF_NETWORK_ERROR",
                path: options.path,
                cause: error,
            });
        }
        if (options.response_type === "buffer" && !isKfJsonResponse(response)) {
            if (!response.ok) throw createKfHttpError(response, options.path);
            return Buffer.from(await response.arrayBuffer()) as T;
        }
        const payload = await parseKfJson(response, options.path);
        const errorCode = kfApiErrorCode(payload);
        if (retryToken && INVALID_TOKEN_CODES.has(errorCode)) {
            this.accessToken = "";
            await this.getAccessToken(true);
            return this.performCall<T>(options, false);
        }
        if (!response.ok || errorCode !== 0)
            throw createKfApiError(response, payload, options.path);
        return payload as T;
    }
}

function invalid(message: string, path?: string): WeComKfError {
    return new WeComKfError(`微信客服 ${message}`, {
        code: "WECOM_KF_INVALID_PARAMETER",
        path,
    });
}

function ensureNotAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw aborted();
}

function aborted(): WeComKfError {
    return new WeComKfError("微信客服客户端已停止", { code: "WECOM_KF_ABORTED" });
}

function isAborted(error: unknown): boolean {
    return error instanceof WeComKfError && error.code === "WECOM_KF_ABORTED";
}
