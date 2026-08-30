import { EventEmitter } from "node:events";
import { emitAllAwaited, KeyedSingleFlight } from "onebots";
import { KfApiTransport } from "./api-transport.js";
import { deliverKfCallback, deliverKfItem, reportKfClientError } from "./client-events.js";
import { assertWeComKfConfig } from "./config.js";
import { KfCursorState } from "./cursor-state.js";
import { ensureKfNotAborted, invalidKfParameter, isKfAborted, WeComKfError } from "./errors.js";
import { resolveKfOpenKfId } from "./identity.js";
import { assertKfUploadSize } from "./media.js";
import { KfMessageDeduplicator } from "./message-deduplicator.js";
import { resolveKfMessageId } from "./message-id.js";
import {
    decodeKfAccounts,
    decodeKfCustomers,
    decodeKfMediaUpload,
    decodeKfSend,
    decodeKfServiceState,
    decodeKfSync,
} from "./response-decoders.js";
import type {
    KfAccount,
    KfBufferCallOptions,
    KfCallOptions,
    KfCallbackEvent,
    KfCustomerBatchGetResponse,
    KfJsonCallOptions,
    KfJsonResponse,
    KfMediaUploadResponse,
    KfMsgItem,
    KfServiceStateResponse,
    KfSyncMsgRequest,
    WeComKfConfig,
} from "./types.js";

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
    private readonly transport: KfApiTransport;
    private pollTimer?: ReturnType<typeof setInterval>;
    private lifecycleAbort?: AbortController;
    private lifecycleGeneration = 0;
    private startRequest?: Promise<void>;
    private started = false;
    private readonly cursorState: KfCursorState;
    private readonly knownOpenKfIds = new Set<string>();
    private readonly receivedMessages: KfMessageDeduplicator;
    private readonly messageFlights = new KeyedSingleFlight<string, boolean>();
    private readonly syncQueues = new Map<string, Promise<KfMsgItem[]>>();

    constructor(
        readonly config: WeComKfConfig,
        fetcher: typeof fetch = fetch,
    ) {
        super();
        assertWeComKfConfig(config);
        this.transport = new KfApiTransport(config, fetcher);
        this.apiBaseUrl = this.transport.apiBaseUrl;
        this.cursorState = new KfCursorState(config.cursor_store_path);
        this.receivedMessages = new KfMessageDeduplicator(
            config.deduplicate_messages !== false,
            config.message_deduplication_limit,
        );
        if (config.open_kfid) this.knownOpenKfIds.add(config.open_kfid);
    }

    get receiveMode(): "webhook" | "manual" {
        return this.config.receive_mode || "webhook";
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
            await this.cursorState.load();
            await this.getAccessToken();
            ensureKfNotAborted(signal);
            if (this.config.enable_sync_poll) this.startPolling();
            await emitAllAwaited(this, "ready");
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
    async stop(): Promise<void> {
        if (!this.started) return;
        this.started = false;
        this.lifecycleGeneration += 1;
        this.startRequest = undefined;
        if (this.pollTimer) clearInterval(this.pollTimer);
        this.pollTimer = undefined;
        this.lifecycleAbort?.abort();
        this.lifecycleAbort = undefined;
        this.transport.stop();
        this.messageFlights.clear();
        await emitAllAwaited(this, "stop");
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
                if (!isKfAborted(error))
                    reportKfClientError(this, WeComKfError.wrap(error, "WECOM_KF_POLL_ERROR"));
            });
        };
        poll();
        this.pollTimer = setInterval(poll, interval);
    }

    /** 获取缓存凭证；`force` 用于平台明确报告凭证失效后的单次刷新。 */
    async getAccessToken(force = false): Promise<string> {
        return this.transport.getAccessToken(force);
    }

    /** 调用受限官方路径，并统一处理凭证、JSON、平台错误与一次失效重试。 */
    call(options: KfBufferCallOptions): Promise<Buffer>;
    call(options: KfJsonCallOptions): Promise<KfJsonResponse>;
    call(options: KfCallOptions): Promise<KfJsonResponse | Buffer>;
    call(options: KfCallOptions): Promise<KfJsonResponse | Buffer> {
        return this.transport.call(options);
    }

    /** 分页同步指定客服账号的消息与事件，返回去重后已投递的原始条目。 */
    async synchronize(openKfid: string, callbackToken?: string): Promise<KfMsgItem[]> {
        if (!openKfid) throw invalidKfParameter("open_kfid 必须是非空字符串");
        this.knownOpenKfIds.add(openKfid);
        const signal = this.lifecycleAbort?.signal;
        ensureKfNotAborted(signal);
        const previous = this.syncQueues.get(openKfid) || Promise.resolve([]);
        const synchronize = (): Promise<KfMsgItem[]> =>
            this.synchronizeUnlocked(openKfid, callbackToken, signal);
        // 前一个调用者已经收到其失败；同账号队列仍须允许下一次补偿同步继续。
        const current = previous.then(synchronize, synchronize);
        this.syncQueues.set(openKfid, current);
        try {
            return await current;
        } finally {
            if (this.syncQueues.get(openKfid) === current) this.syncQueues.delete(openKfid);
        }
    }

    /** 将已有连接取得的单个 `sync_msg` 条目送入统一事件管线。 */
    async ingest(
        item: KfMsgItem,
        fallbackOpenKfId = this.config.open_kfid || "",
    ): Promise<boolean> {
        const id = item.msgid;
        if (id && this.receivedMessages.has(id)) return false;
        if (id) {
            return this.messageFlights.run(id, () => this.ingestUnlocked(item, fallbackOpenKfId));
        }
        return this.ingestUnlocked(item, fallbackOpenKfId);
    }

    private async ingestUnlocked(item: KfMsgItem, fallbackOpenKfId: string): Promise<boolean> {
        const id = item.msgid;
        if (id && this.receivedMessages.has(id)) return false;
        const openKfid = resolveKfOpenKfId(item, fallbackOpenKfId);
        if (openKfid) this.knownOpenKfIds.add(openKfid);
        try {
            await deliverKfItem(this, openKfid, item);
        } catch (error) {
            throw WeComKfError.wrap(error, "WECOM_KF_EVENT_DELIVERY_FAILED");
        }
        if (id) this.receivedMessages.commit(id);
        return true;
    }

    /** 将已验签、解密并校验的回调事件送入统一事件管线。 */
    async ingestCallback(event: KfCallbackEvent): Promise<void> {
        if (event.OpenKfId) this.knownOpenKfIds.add(event.OpenKfId);
        await deliverKfCallback(this, event);
    }

    /** 返回配置、回调、同步或账号目录中已经确认的真实客服账号 ID。 */
    getKnownOpenKfIds(): string[] {
        return [...this.knownOpenKfIds];
    }

    /** 向指定客户会话发送原生消息，并返回受 32 字节约束的消息 ID。 */
    async sendMessage(
        externalUserid: string,
        openKfid: string,
        message: Readonly<Record<string, unknown>>,
    ): Promise<string> {
        const msgid = resolveKfMessageId(message);
        const path = "/cgi-bin/kf/send_msg";
        const result = decodeKfSend(
            await this.call({
                method: "POST",
                path,
                body: { ...message, touser: externalUserid, open_kfid: openKfid, msgid },
            }),
            path,
        );
        return result.msgid || msgid;
    }

    /** 使用平台事件 code 发送欢迎语、排队提示或结束语。 */
    async sendMessageOnEvent(
        code: string,
        message: Readonly<Record<string, unknown>>,
    ): Promise<string> {
        const msgid = resolveKfMessageId(message);
        const path = "/cgi-bin/kf/send_msg_on_event";
        const result = decodeKfSend(
            await this.call({
                method: "POST",
                path,
                body: { ...message, code, msgid },
            }),
            path,
        );
        return result.msgid || msgid;
    }

    /** 使用官方分页接口列出当前凭证可见的全部客服账号。 */
    async listAccounts(): Promise<KfAccount[]> {
        const accounts: KfAccount[] = [];
        const limit = 100;
        for (let pageIndex = 0; pageIndex < MAX_ACCOUNT_PAGES; pageIndex++) {
            const offset = pageIndex * limit;
            const path = "/cgi-bin/kf/account/list";
            const result = decodeKfAccounts(
                await this.call({
                    method: "POST",
                    path,
                    body: { offset, limit },
                }),
                path,
            );
            const accountPage = result;
            accounts.push(...accountPage);
            for (const account of accountPage) this.knownOpenKfIds.add(account.open_kfid);
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
    async customerBatchGet(
        externalUserIds: readonly string[],
        needContext = false,
    ): Promise<KfCustomerBatchGetResponse> {
        const path = "/cgi-bin/kf/customer/batchget";
        return decodeKfCustomers(
            await this.call({
                method: "POST",
                path,
                body: {
                    external_userid_list: [...externalUserIds],
                    need_enter_session_context: needContext ? 1 : 0,
                },
            }),
            path,
        );
    }

    /** 查询指定客服账号与客户之间的官方会话状态。 */
    async getServiceState(
        openKfid: string,
        externalUserid: string,
    ): Promise<KfServiceStateResponse> {
        const path = "/cgi-bin/kf/service_state/get";
        return decodeKfServiceState(
            await this.call({
                method: "POST",
                path,
                body: { open_kfid: openKfid, external_userid: externalUserid },
            }),
            path,
        );
    }

    /** 变更会话状态，完整请求字段按官方 `service_state/trans` 传递。 */
    transferServiceState(request: Readonly<Record<string, unknown>>): Promise<KfJsonResponse> {
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
    ): Promise<KfMediaUploadResponse> {
        assertKfUploadSize(data.size);
        const form = new FormData();
        form.set("media", data, filename);
        const path = "/cgi-bin/media/upload";
        return decodeKfMediaUpload(
            await this.call({
                method: "POST",
                path,
                query: { type },
                body: form,
            }),
            path,
        );
    }

    private async synchronizeUnlocked(
        openKfid: string,
        callbackToken?: string,
        signal?: AbortSignal,
    ): Promise<KfMsgItem[]> {
        const collected: KfMsgItem[] = [];
        const batchIds = new Set<string>();
        let cursor = this.cursorState.get(openKfid);
        for (let page = 0; page < MAX_SYNC_PAGES; page++) {
            ensureKfNotAborted(signal);
            const request: KfSyncMsgRequest = {
                open_kfid: openKfid,
                cursor: cursor || undefined,
                token: callbackToken,
                limit: callbackToken ? 1000 : 500,
                voice_format: 0,
            };
            const path = "/cgi-bin/kf/sync_msg";
            const result = decodeKfSync(
                await this.call({
                    method: "POST",
                    path,
                    body: request,
                    signal,
                }),
                path,
            );
            for (const item of result.msg_list || []) {
                const id = item.msgid;
                if (
                    id &&
                    this.config.deduplicate_messages !== false &&
                    (this.receivedMessages.has(id) || batchIds.has(id))
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
        ensureKfNotAborted(signal);
        for (const item of collected) await this.ingest(item, openKfid);
        await this.cursorState.commit(openKfid, cursor);
        return collected;
    }
}
