import {
    ADAPTER_COORDINATE,
    ADAPTER_SEMVER,
    ILINK_CDN_ROOT_DEFAULT,
    ILINK_FAST_RPC_MS,
    ILINK_HTTP_ORIGIN_DEFAULT,
    ILINK_LONG_WAIT_MS,
    ILINK_RPC_BUDGET_MS,
} from "../internal/config.js";
import { fuseAbortClock } from "../internal/async-tools.js";
import { StaleCredentialFault, GatewayFault } from "../internal/errors.js";
import { ephemeralWeixinHeaderTag } from "../internal/random-tags.js";
import { withTrailingSlash } from "../internal/url-utils.js";
import type { WireChannelFingerprint } from "../protocol/wire-models.js";
import type {
    CdnSlotGrant,
    CdnSlotRequest,
    ConfigWireAck,
    OutboundWireEnvelope,
    PollWireBatch,
    QrBitmapReply,
    QrPhaseReply,
    TypingWireAck,
    TypingWireEnvelope,
} from "../protocol/wire-models.js";

export interface TransportRuntimePatch {
    baseUrl?: string;
    cdnBaseUrl?: string;
    token?: string;
    routeTag?: string;
}

function fingerprintPayload(): WireChannelFingerprint {
    return { channel_version: `${ADAPTER_COORDINATE}@${ADAPTER_SEMVER}` };
}

/** 负责与 ilinkai 网关的全部 HTTP 交互 */
export class IlinkJsonTransport {
    baseUrl: string;
    cdnBaseUrl: string;
    token?: string;
    routeTag?: string;

    constructor(seed: TransportRuntimePatch = {}) {
        this.baseUrl = seed.baseUrl?.trim() || ILINK_HTTP_ORIGIN_DEFAULT;
        this.cdnBaseUrl = seed.cdnBaseUrl?.trim() || ILINK_CDN_ROOT_DEFAULT;
        this.token = seed.token?.trim() || undefined;
        this.routeTag = seed.routeTag?.trim() || undefined;
    }

    patchRuntimeTargets(patch: TransportRuntimePatch): void {
        if (patch.baseUrl?.trim()) this.baseUrl = patch.baseUrl.trim();
        if (patch.cdnBaseUrl?.trim()) this.cdnBaseUrl = patch.cdnBaseUrl.trim();
        if (patch.token !== undefined) this.token = patch.token?.trim() || undefined;
        if (patch.routeTag !== undefined) this.routeTag = patch.routeTag?.trim() || undefined;
    }

    private bareHeaders(): Record<string, string> {
        const h: Record<string, string> = {};
        if (this.routeTag) h.SKRouteTag = this.routeTag;
        return h;
    }

    private signedJsonHeaders(payload: string, bearer?: string): Record<string, string> {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            AuthorizationType: "ilink_bot_token",
            "Content-Length": String(Buffer.byteLength(payload, "utf-8")),
            "X-Wechat-UIN": ephemeralWeixinHeaderTag(),
        };
        const tok = bearer ?? this.token;
        if (tok?.trim()) headers.Authorization = `Bearer ${tok.trim()}`;
        if (this.routeTag) headers.SKRouteTag = this.routeTag;
        return headers;
    }

    private async exchangeJson<T>(path: string, jsonBody: object, budgetMs: number, bearer?: string): Promise<T> {
        const body = JSON.stringify({ ...jsonBody, base_info: fingerprintPayload() });
        const { signal, disarm } = fuseAbortClock(budgetMs);
        try {
            const response = await fetch(new URL(path, withTrailingSlash(this.baseUrl)), {
                method: "POST",
                headers: this.signedJsonHeaders(body, bearer),
                body,
                signal,
            });
            const raw = await response.text();
            if (!response.ok) {
                throw new GatewayFault("HTTP_ERROR", `HTTP ${response.status} ${response.statusText}: ${raw}`);
            }
            return JSON.parse(raw) as T;
        } finally {
            disarm();
        }
    }

    async openLoginBitmap(params?: { botType?: string; budgetMs?: number; signal?: AbortSignal }): Promise<QrBitmapReply> {
        const url = new URL(
            `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(params?.botType ?? "3")}`,
            withTrailingSlash(this.baseUrl),
        );
        const { signal, disarm } = fuseAbortClock(params?.budgetMs ?? ILINK_FAST_RPC_MS, params?.signal);
        try {
            const response = await fetch(url, { headers: this.bareHeaders(), signal });
            const raw = await response.text();
            if (!response.ok) {
                throw new GatewayFault("HTTP_ERROR", `HTTP ${response.status} ${response.statusText}: ${raw}`);
            }
            return JSON.parse(raw) as QrBitmapReply;
        } finally {
            disarm();
        }
    }

    async probeLoginPhase(params: {
        qrcode: string;
        budgetMs?: number;
        signal?: AbortSignal;
    }): Promise<QrPhaseReply> {
        const url = new URL(
            `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(params.qrcode)}`,
            withTrailingSlash(this.baseUrl),
        );
        const clock = fuseAbortClock(params.budgetMs ?? ILINK_LONG_WAIT_MS, params.signal);
        try {
            const response = await fetch(url, {
                headers: { "iLink-App-ClientVersion": "1", ...this.bareHeaders() },
                signal: clock.signal,
            });
            const raw = await response.text();
            if (!response.ok) {
                throw new GatewayFault("HTTP_ERROR", `HTTP ${response.status} ${response.statusText}: ${raw}`);
            }
            return JSON.parse(raw) as QrPhaseReply;
        } catch (err) {
            if (clock.signal.aborted) {
                return { status: "wait" };
            }
            throw err;
        } finally {
            clock.disarm();
        }
    }

    async pullUnreadBatch(cursor: string, ceilingMs?: number): Promise<PollWireBatch> {
        try {
            return await this.exchangeJson<PollWireBatch>(
                "ilink/bot/getupdates",
                { get_updates_buf: cursor ?? "" },
                ceilingMs ?? ILINK_LONG_WAIT_MS,
            );
        } catch (e) {
            if (e instanceof Error && e.name === "AbortError") {
                return { ret: 0, msgs: [], get_updates_buf: cursor ?? "" };
            }
            throw e;
        }
    }

    async reserveCdnUploadSlot(req: CdnSlotRequest & { timeoutMs?: number }): Promise<CdnSlotGrant> {
        return this.exchangeJson<CdnSlotGrant>(
            "ilink/bot/getuploadurl",
            {
                filekey: req.filekey,
                media_type: req.media_type,
                to_user_id: req.to_user_id,
                rawsize: req.rawsize,
                rawfilemd5: req.rawfilemd5,
                filesize: req.filesize,
                thumb_rawsize: req.thumb_rawsize,
                thumb_rawfilemd5: req.thumb_rawfilemd5,
                thumb_filesize: req.thumb_filesize,
                no_need_thumb: req.no_need_thumb,
                aeskey: req.aeskey,
            },
            req.timeoutMs ?? ILINK_RPC_BUDGET_MS,
        );
    }

    private sniffCredentialFault<T extends { ret?: number; errcode?: number; errmsg?: string }>(row: T): void {
        if ((row.errcode ?? row.ret ?? 0) === -14) {
            throw new StaleCredentialFault(row.errmsg ?? "凭证失效");
        }
    }

    async dispatchOutboundEnvelope(envelope: OutboundWireEnvelope, budgetMs?: number): Promise<void> {
        const ms = budgetMs ?? ILINK_RPC_BUDGET_MS;
        const row = await this.exchangeJson<{ ret?: number; errcode?: number; errmsg?: string }>(
            "ilink/bot/sendmessage",
            envelope as unknown as object,
            ms,
        );
        this.sniffCredentialFault(row);
        if ((row.errcode ?? 0) !== 0 || (row.ret ?? 0) !== 0) {
            throw new GatewayFault(
                "API_ERROR",
                `sendmessage 异常 ret=${String(row.ret ?? "")} errcode=${String(row.errcode ?? "")} errmsg=${String(row.errmsg ?? "")}`,
            );
        }
    }

    async loadPeerTypingConfig(params: {
        ilinkUserId: string;
        contextToken?: string;
        budgetMs?: number;
    }): Promise<ConfigWireAck> {
        const row = await this.exchangeJson<ConfigWireAck>(
            "ilink/bot/getconfig",
            {
                ilink_user_id: params.ilinkUserId,
                context_token: params.contextToken,
            },
            params.budgetMs ?? ILINK_FAST_RPC_MS,
        );
        this.sniffCredentialFault(row);
        return row;
    }

    async signalTypingState(body: TypingWireEnvelope, budgetMs?: number): Promise<TypingWireAck> {
        const row = await this.exchangeJson<TypingWireAck>(
            "ilink/bot/sendtyping",
            body,
            budgetMs ?? ILINK_FAST_RPC_MS,
        );
        this.sniffCredentialFault(row);
        return row;
    }
}
