import { EventEmitter } from "node:events";

import { ILINK_LONG_WAIT_MS, ILINK_QR_BOT_CLASS_DEFAULT } from "./internal/config.js";
import { delay } from "./internal/async-tools.js";
import { MissingReplyLaneFault, StaleCredentialFault, GatewayFault } from "./internal/errors.js";
import { pickCredentialOrNull } from "./internal/session-snapshot.js";
import { materializeUserSuppliedFile } from "./internal/load-bytes.js";
import { mapInboundWirePacket } from "./protocol/inbound-mapper.js";
import { TypingPhase, UploadKind } from "./protocol/wire-models.js";
import type {
    CredentialBlob,
    DownloadMediaOptions,
    DownloadMediaResult,
    InputFile,
    LoginOutcome,
    LoginTicket,
    NormalizedChatEvent,
    OnTextListener,
    PollingOptions,
    SendCommonOptions,
    SendMediaOptions,
    SessionStore,
    WaitForLoginOptions,
} from "./protocol/chat-event.js";
import { allocateLoginTicket, awaitLoginTicketResolution } from "./login/qr-handshake.js";
import {
    postFileBundle,
    postLiteralReply,
    postPhotoBundle,
    postVideoBundle,
} from "./outbound/assembler.js";
import { IlinkJsonTransport } from "./transport/ilink-json-transport.js";
import { JsonFileCredentialStore, MemoryCredentialStore } from "./state/persist.js";
import { pullUserMediaAttachment, stageBinaryForPeer, mapMimeFamilyToUploadKind } from "./cdn/payload-pipeline.js";
import type { IlinkContextTokenStore } from "../context-token-store.js";

export interface IlinkBotOptions {
    session?: Partial<CredentialBlob> | null;
    sessionStore?: SessionStore | string;
    token?: string;
    accountId?: string;
    baseUrl?: string;
    cdnBaseUrl?: string;
    routeTag?: string;
    polling?: boolean | PollingOptions;
    /**
     * 与 `contextTokenAccountKey` 同时传入时，context_token 只读写 SQLite（OneBots 主库），
     * 会话 JSON 不再持久化 contextTokens；写入带会话 `accountId` + 对端 peer，读取按 accountKey + peer。
     */
    contextTokenStore?: IlinkContextTokenStore;
    /** OneBots 配置账号键（如 `account_id`） */
    contextTokenAccountKey?: string;
}

/** {@link IlinkBot.clearSession} 选项 */
export interface ClearSessionOptions {
    /**
     * 未启用 `contextTokenStore` 时：为 true 则清除凭证但把 context_token 暂存内存，待下次 `useSession` 合并回快照。
     * 已启用 DB 存储时：context_token 始终在库中，本项无效。
     */
    preserveContextTokens?: boolean;
}

type RegexBinding = { pattern: RegExp; listener: OnTextListener };

/** iLink 会话运行时：凭证、长轮询、出站消息 */
export class IlinkBot extends EventEmitter {
    private readonly store: SessionStore;
    private readonly transport: IlinkJsonTransport;
    private snapshot: CredentialBlob | null = null;
    private readonly seedCredential: Partial<CredentialBlob> | null;
    private hydrated = false;
    private pollArmed = false;
    /** 子类在凭证失效重登前可 await 其结束并置 null */
    protected pollLoop: Promise<void> | null = null;
    private pollKnobs: PollingOptions;
    private readonly regexBindings: RegexBinding[] = [];
    private readonly typingPass = new Map<string, string>();
    private readonly contextTokenStore?: IlinkContextTokenStore;
    private readonly contextTokenAccountKey?: string;
    /** 已从会话文件迁入 DB 后写回空 contextTokens（仅 DB 模式用一次） */
    private didMigrateContextTokensFromFile = false;
    /** 凭证清理时暂存的 context_token（仅无 DB 存储时） */
    private contextTokensCarryover: Record<string, string> | null = null;

    constructor(options: IlinkBotOptions = {}) {
        super();
        this.seedCredential =
            options.session ??
            (options.token && options.accountId
                ? {
                      token: options.token,
                      accountId: options.accountId,
                      baseUrl: options.baseUrl,
                      cdnBaseUrl: options.cdnBaseUrl,
                      routeTag: options.routeTag,
                      contextTokens: {},
                  }
                : null);

        this.store =
            typeof options.sessionStore === "string"
                ? new JsonFileCredentialStore(options.sessionStore)
                : options.sessionStore ?? new MemoryCredentialStore();

        this.transport = new IlinkJsonTransport({
            baseUrl: options.baseUrl,
            cdnBaseUrl: options.cdnBaseUrl,
            routeTag: options.routeTag,
            token: options.token,
        });

        this.contextTokenStore = options.contextTokenStore;
        this.contextTokenAccountKey = options.contextTokenAccountKey;

        this.pollKnobs =
            typeof options.polling === "object" ? options.polling : { timeoutMs: ILINK_LONG_WAIT_MS };

        if (options.polling) {
            queueMicrotask(() => {
                void this.startPolling().catch((err: unknown) => this.emit("polling_error", err));
            });
        }
    }

    onText(pattern: RegExp, listener: OnTextListener): this {
        this.regexBindings.push({ pattern, listener });
        return this;
    }

    protected async ensureSessionLoaded(): Promise<CredentialBlob | null> {
        if (this.hydrated) return this.snapshot;

        const disk = pickCredentialOrNull(await this.store.load());
        const inline = pickCredentialOrNull(this.seedCredential);
        this.snapshot = disk ?? inline;

        if (this.snapshot) {
            this.transport.patchRuntimeTargets({
                token: this.snapshot.token,
                baseUrl: this.snapshot.baseUrl || undefined,
                cdnBaseUrl: this.snapshot.cdnBaseUrl,
                routeTag: this.snapshot.routeTag,
            });
        }

        await this.maybeMigrateContextTokensFromSessionFile();

        this.hydrated = true;
        return this.snapshot;
    }

    /** 会话落盘时不带 contextTokens（由 DB 或内存维护） */
    private stripForJsonSave(blob: CredentialBlob): CredentialBlob {
        if (!this.contextTokenStore) return blob;
        return { ...blob, contextTokens: {} };
    }

    /** 旧版 JSON 里若有 contextTokens，一次性写入 SQLite 并写回空对象 */
    private async maybeMigrateContextTokensFromSessionFile(): Promise<void> {
        if (this.didMigrateContextTokensFromFile) return;
        this.didMigrateContextTokensFromFile = true;
        if (!this.contextTokenStore || !this.contextTokenAccountKey || !this.snapshot) return;
        const ct = this.snapshot.contextTokens;
        if (!ct || Object.keys(ct).length === 0) return;
        for (const [peerId, tok] of Object.entries(ct)) {
            if (typeof tok === "string" && tok.length > 0) {
                this.contextTokenStore.set(this.contextTokenAccountKey, this.snapshot.accountId, peerId, tok);
            }
        }
        this.snapshot.contextTokens = {};
        await this.store.save(this.stripForJsonSave(this.snapshot));
    }

    private async persistSnapshot(): Promise<void> {
        if (!this.snapshot) return;
        this.snapshot.updatedAt = new Date().toISOString();
        await this.store.save(this.stripForJsonSave(this.snapshot));
    }

    async getSession(): Promise<CredentialBlob | null> {
        return this.ensureSessionLoaded();
    }

    async clearSession(options?: ClearSessionOptions): Promise<void> {
        if (
            !this.contextTokenStore &&
            options?.preserveContextTokens &&
            this.snapshot?.contextTokens
        ) {
            const prev = this.snapshot.contextTokens;
            const keys = Object.keys(prev);
            if (keys.length > 0) {
                this.contextTokensCarryover = { ...prev };
            }
        } else {
            this.contextTokensCarryover = null;
        }
        this.snapshot = null;
        this.hydrated = true;
        this.typingPass.clear();
        await this.store.clear();
        this.transport.patchRuntimeTargets({ token: undefined, routeTag: undefined });
    }

    async useSession(session: CredentialBlob): Promise<void> {
        const carried = this.contextTokenStore ? {} : (this.contextTokensCarryover ?? {});
        this.contextTokensCarryover = null;
        this.snapshot = {
            ...session,
            syncBuffer: session.syncBuffer ?? "",
            contextTokens: this.contextTokenStore
                ? {}
                : { ...carried, ...(session.contextTokens ?? {}) },
            updatedAt: new Date().toISOString(),
            createdAt: session.createdAt ?? new Date().toISOString(),
        };
        this.hydrated = true;
        this.transport.patchRuntimeTargets({
            token: session.token,
            baseUrl: session.baseUrl || undefined,
            cdnBaseUrl: session.cdnBaseUrl,
            routeTag: session.routeTag,
        });
        await this.persistSnapshot();
    }

    async createLoginSession(options?: { botType?: string; signal?: AbortSignal }): Promise<LoginTicket> {
        await this.ensureSessionLoaded();
        return allocateLoginTicket(this.transport, {
            botType: options?.botType ?? ILINK_QR_BOT_CLASS_DEFAULT,
            signal: options?.signal,
        });
    }

    async waitForLogin(sessionKey: string, options?: WaitForLoginOptions): Promise<LoginOutcome> {
        const outcome = await awaitLoginTicketResolution(this.transport, sessionKey, options);
        if (outcome.connected && outcome.session) {
            await this.useSession(outcome.session);
            this.emit("login", outcome.session);
        }
        return outcome;
    }

    async loginWithQr(options?: WaitForLoginOptions & { botType?: string }): Promise<{
        loginSession: LoginTicket;
        result: LoginOutcome;
    }> {
        const loginSession = await this.createLoginSession({
            botType: options?.botType,
            signal: options?.signal,
        });
        const result = await this.waitForLogin(loginSession.sessionKey, options);
        return { loginSession, result };
    }

    async getLatestContextToken(chatId: string): Promise<string | undefined> {
        const s = await this.ensureSessionLoaded();
        if (this.contextTokenStore && this.contextTokenAccountKey && s) {
            const fromDb = this.contextTokenStore.get(this.contextTokenAccountKey, s.accountId, chatId);
            if (fromDb) return fromDb;
        }
        return s?.contextTokens?.[chatId];
    }

    private insistSnapshot(s: CredentialBlob | null): CredentialBlob {
        if (!s) {
            throw new GatewayFault("SESSION_NOT_AVAILABLE", "未配置 iLink 会话：请先扫码或写入 token。");
        }
        return s;
    }

    private async obtainReplyContext(peerKey: string, override?: string): Promise<string> {
        const s = this.insistSnapshot(await this.ensureSessionLoaded());
        let ctx = override;
        if (ctx == null && this.contextTokenStore && this.contextTokenAccountKey) {
            ctx = this.contextTokenStore.get(this.contextTokenAccountKey, s.accountId, peerKey);
        }
        if (ctx == null) ctx = s.contextTokens?.[peerKey];
        if (!ctx) throw new MissingReplyLaneFault(peerKey);
        return ctx;
    }

    private async memorizeReplyContext(peerKey: string, contextToken?: string): Promise<void> {
        if (!contextToken) return;
        const s = this.insistSnapshot(await this.ensureSessionLoaded());
        if (this.contextTokenStore && this.contextTokenAccountKey) {
            this.contextTokenStore.set(this.contextTokenAccountKey, s.accountId, peerKey, contextToken);
        } else {
            s.contextTokens = s.contextTokens ?? {};
            s.contextTokens[peerKey] = contextToken;
        }
        await this.persistSnapshot();
    }

    async sendTextToUser(chatId: string, text: string, options: SendCommonOptions = {}): Promise<{ messageId: string }> {
        await this.ensureSessionLoaded();
        const ctx = await this.obtainReplyContext(chatId, options.contextToken);
        return postLiteralReply(this.transport, chatId, ctx, text);
    }

    async sendPhotoToUser(chatId: string, input: InputFile, options: SendMediaOptions = {}): Promise<{ messageId: string }> {
        await this.ensureSessionLoaded();
        const ctx = await this.obtainReplyContext(chatId, options.contextToken);
        const staged = await stageBinaryForPeer({
            transport: this.transport,
            input,
            peerKey: chatId,
            uploadKind: UploadKind.Image,
            filename: options.filename,
            contentType: options.contentType,
        });
        const mid = await postPhotoBundle(this.transport, chatId, ctx, staged, options.caption);
        return { messageId: mid };
    }

    async sendVideoToUser(chatId: string, input: InputFile, options: SendMediaOptions = {}): Promise<{ messageId: string }> {
        await this.ensureSessionLoaded();
        const ctx = await this.obtainReplyContext(chatId, options.contextToken);
        const staged = await stageBinaryForPeer({
            transport: this.transport,
            input,
            peerKey: chatId,
            uploadKind: UploadKind.Video,
            filename: options.filename,
            contentType: options.contentType,
        });
        const mid = await postVideoBundle(this.transport, chatId, ctx, staged, options.caption);
        return { messageId: mid };
    }

    async sendDocumentToUser(chatId: string, input: InputFile, options: SendMediaOptions = {}): Promise<{ messageId: string }> {
        await this.ensureSessionLoaded();
        const ctx = await this.obtainReplyContext(chatId, options.contextToken);
        const blob = await materializeUserSuppliedFile(input, {
            filename: options.filename,
            contentType: options.contentType,
        });
        const staged = await stageBinaryForPeer({
            transport: this.transport,
            input: { source: blob.buffer, filename: blob.fileName, contentType: blob.contentType },
            peerKey: chatId,
            uploadKind: mapMimeFamilyToUploadKind(blob.contentType),
            filename: blob.fileName,
            contentType: blob.contentType,
        });
        const mid = await postFileBundle(this.transport, chatId, ctx, staged, options.caption);
        return { messageId: mid };
    }

    async sendTypingToUser(chatId: string, options: SendCommonOptions = {}): Promise<void> {
        await this.ensureSessionLoaded();
        const s = this.insistSnapshot(this.snapshot);
        const ctx = await this.obtainReplyContext(chatId, options.contextToken);
        let ticket = this.typingPass.get(chatId);
        if (!ticket) {
            const cfg = await this.transport.loadPeerTypingConfig({
                ilinkUserId: chatId,
                contextToken: ctx,
            });
            if ((cfg.ret ?? 0) !== 0 || !cfg.typing_ticket) {
                throw new GatewayFault("TYPING_TICKET_UNAVAILABLE", `未拿到 typing_ticket：${chatId}`);
            }
            ticket = cfg.typing_ticket;
            this.typingPass.set(chatId, ticket);
        }
        await this.transport.signalTypingState({
            ilink_user_id: chatId,
            typing_ticket: ticket,
            status: TypingPhase.Active,
        });
        s.updatedAt = new Date().toISOString();
        await this.persistSnapshot();
    }

    async downloadInboundMedia(message: NormalizedChatEvent, options?: DownloadMediaOptions): Promise<DownloadMediaResult> {
        await this.ensureSessionLoaded();
        return pullUserMediaAttachment({ transport: this.transport, message, options });
    }

    private async fanOutInbound(evt: NormalizedChatEvent): Promise<void> {
        await this.memorizeReplyContext(evt.chat.id, evt.contextToken);
        this.emit("message", evt);
        if (evt.type !== "unknown") {
            this.emit(evt.type, evt);
        }
        if (evt.text) {
            for (const { pattern, listener } of this.regexBindings) {
                const hit = pattern.exec(evt.text);
                pattern.lastIndex = 0;
                if (hit) await listener(evt, hit);
            }
        }
    }

    async startPolling(options?: PollingOptions): Promise<void> {
        if (this.pollArmed) return this.pollLoop ?? Promise.resolve();

        await this.ensureSessionLoaded();
        const s = this.insistSnapshot(this.snapshot);
        this.pollArmed = true;
        const knobs = { ...this.pollKnobs, ...options };

        this.pollLoop = (async () => {
            let ceiling = knobs.timeoutMs ?? ILINK_LONG_WAIT_MS;
            while (this.pollArmed) {
                try {
                    const batch = await this.transport.pullUnreadBatch(s.syncBuffer ?? "", ceiling);
                    if ((batch.errcode ?? batch.ret ?? 0) === -14) {
                        throw new StaleCredentialFault(batch.errmsg ?? "凭证失效");
                    }
                    if ((batch.errcode ?? 0) !== 0 || (batch.ret ?? 0) !== 0) {
                        throw new GatewayFault(
                            "GET_UPDATES_FAILED",
                            `getupdates 异常 ret=${String(batch.ret ?? "")} errcode=${String(batch.errcode ?? "")}`,
                        );
                    }
                    if (batch.longpolling_timeout_ms && batch.longpolling_timeout_ms > 0) {
                        ceiling = batch.longpolling_timeout_ms;
                    }
                    if (typeof batch.get_updates_buf === "string") {
                        s.syncBuffer = batch.get_updates_buf;
                        await this.persistSnapshot();
                    }
                    for (const row of batch.msgs ?? []) {
                        await this.fanOutInbound(mapInboundWirePacket(row));
                    }
                } catch (err) {
                    if (err instanceof StaleCredentialFault) {
                        // 停止轮询并清除磁盘/内存会话，避免下次启动仍用坏凭证
                        this.pollArmed = false;
                        try {
                            await this.clearSession({ preserveContextTokens: true });
                        } catch (clearErr: unknown) {
                            this.emit("polling_error", clearErr);
                        }
                        this.emit("credential_stale", err);
                        continue;
                    }
                    this.emit("polling_error", err);
                    await delay(knobs.retryDelayMs ?? 2_000);
                }
            }
        })();

        return this.pollLoop;
    }

    async stopPolling(): Promise<void> {
        this.pollArmed = false;
        if (this.pollLoop) {
            await this.pollLoop.catch(() => {});
            this.pollLoop = null;
        }
    }
}
