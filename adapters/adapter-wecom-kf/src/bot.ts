/**
 * 微信客服 API 与回调处理（sync_msg + send_msg）
 */
import { EventEmitter } from "node:events";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { RouterContext, Next } from "onebots";
import {
    decryptWeComPayload,
    extractEncryptFromXml,
    parseSimpleXml,
    verifyWeComSignature,
} from "./crypto.js";
import type {
    WeComKfConfig,
    WeComTokenResponse,
    KfSyncMsgRequest,
    KfSyncMsgResponse,
    KfMsgItem,
    KfSendMsgResponse,
    KfCustomerBatchGetResponse,
    KfServiceStateGetResponse,
} from "./types.js";

const WECOM_API = "https://qyapi.weixin.qq.com";

export class WeComKfBot extends EventEmitter {
    private readonly config: WeComKfConfig;
    private accessToken = "";
    private tokenExpireAt = 0;
    /** open_kfid -> next_cursor */
    private readonly cursorByKf = new Map<string, string>();
    private readonly seenMsgIds = new Set<string>();
    private pollTimer: ReturnType<typeof setInterval> | null = null;

    constructor(config: WeComKfConfig) {
        super();
        this.config = config;
        this.loadCursorsFromDisk();
    }

    getConfig(): WeComKfConfig {
        return this.config;
    }

    private loadCursorsFromDisk(): void {
        const p = this.config.cursor_store_path;
        if (!p || !existsSync(p)) return;
        try {
            const raw = JSON.parse(readFileSync(p, "utf-8")) as Record<string, string>;
            for (const [k, v] of Object.entries(raw)) {
                this.cursorByKf.set(k, v);
            }
        } catch {
            /* 忽略损坏文件 */
        }
    }

    private persistCursors(): void {
        const p = this.config.cursor_store_path;
        if (!p) return;
        try {
            const obj: Record<string, string> = {};
            for (const [k, v] of this.cursorByKf.entries()) {
                obj[k] = v;
            }
            writeFileSync(p, JSON.stringify(obj, null, 2), "utf-8");
        } catch {
            /* 忽略写入失败 */
        }
    }

    private pruneSeen(): void {
        if (this.seenMsgIds.size <= 4000) return;
        const arr = [...this.seenMsgIds];
        this.seenMsgIds.clear();
        arr.slice(-2000).forEach((id) => this.seenMsgIds.add(id));
    }

    private async requestJson<T>(path: string, body?: unknown): Promise<T> {
        const token = await this.getAccessToken();
        const url = `${WECOM_API}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        return res.json() as Promise<T>;
    }

    async getAccessToken(): Promise<string> {
        if (this.accessToken && Date.now() < this.tokenExpireAt) {
            return this.accessToken;
        }
        const url = new URL(`${WECOM_API}/cgi-bin/gettoken`);
        url.searchParams.set("corpid", this.config.corp_id);
        url.searchParams.set("corpsecret", this.config.corp_secret);
        const res = await fetch(url.toString());
        const data = (await res.json()) as WeComTokenResponse;
        if (data.errcode !== undefined && data.errcode !== 0) {
            throw new Error(`获取 access_token 失败: ${data.errmsg} (${data.errcode})`);
        }
        this.accessToken = data.access_token || "";
        this.tokenExpireAt = Date.now() + ((data.expires_in || 7200) - 120) * 1000;
        return this.accessToken;
    }

    async syncMsg(req: KfSyncMsgRequest): Promise<KfSyncMsgResponse> {
        return this.requestJson<KfSyncMsgResponse>("/cgi-bin/kf/sync_msg", req);
    }

    /**
     * 使用回调返回的 token 增量拉取消息（含 has_more 翻页）
     */
    async pullAllMessages(openKfid: string, callbackToken: string): Promise<KfMsgItem[]> {
        const collected: KfMsgItem[] = [];
        let cursor = this.cursorByKf.get(openKfid) || "";
        let hasMore = 1;
        while (hasMore === 1) {
            const data = await this.syncMsg({
                open_kfid: openKfid,
                token: callbackToken,
                cursor: cursor || undefined,
                limit: 1000,
                voice_format: 0,
            });
            if (data.errcode !== 0) {
                throw new Error(`sync_msg 失败: ${data.errmsg} (${data.errcode})`);
            }
            for (const item of data.msg_list || []) {
                const mid = item.msgid;
                if (mid) {
                    if (this.seenMsgIds.has(mid)) continue;
                    this.seenMsgIds.add(mid);
                    this.pruneSeen();
                }
                collected.push(item);
            }
            cursor = data.next_cursor || "";
            hasMore = data.has_more ?? 0;
        }
        this.cursorByKf.set(openKfid, cursor);
        this.persistCursors();
        return collected;
    }

    /**
     * 无 token 轮询（频率受限，仅作补偿）
     */
    async pullPollOnce(openKfid: string): Promise<KfMsgItem[]> {
        const collected: KfMsgItem[] = [];
        let cursor = this.cursorByKf.get(openKfid) || "";
        let hasMore = 1;
        while (hasMore === 1) {
            const data = await this.syncMsg({
                open_kfid: openKfid,
                cursor: cursor || undefined,
                limit: 500,
                voice_format: 0,
            });
            if (data.errcode !== 0) {
                this.emit("sync_error", data);
                return collected;
            }
            for (const item of data.msg_list || []) {
                const mid = item.msgid;
                if (mid) {
                    if (this.seenMsgIds.has(mid)) continue;
                    this.seenMsgIds.add(mid);
                    this.pruneSeen();
                }
                collected.push(item);
            }
            cursor = data.next_cursor || "";
            hasMore = data.has_more ?? 0;
        }
        this.cursorByKf.set(openKfid, cursor);
        this.persistCursors();
        return collected;
    }

    async sendMsg(body: Record<string, unknown>): Promise<KfSendMsgResponse> {
        return this.requestJson<KfSendMsgResponse>("/cgi-bin/kf/send_msg", body);
    }

    async customerBatchGet(externalUserIds: string[], needContext = 0): Promise<KfCustomerBatchGetResponse> {
        return this.requestJson<KfCustomerBatchGetResponse>("/cgi-bin/kf/customer/batchget", {
            external_userid_list: externalUserIds,
            need_enter_session_context: needContext,
        });
    }

    async serviceStateGet(openKfid: string, externalUserid: string): Promise<KfServiceStateGetResponse> {
        return this.requestJson<KfServiceStateGetResponse>("/cgi-bin/kf/service_state/get", {
            open_kfid: openKfid,
            external_userid: externalUserid,
        });
    }

    async serviceStateTrans(payload: {
        open_kfid: string;
        external_userid: string;
        service_state: number;
        servicer_userid?: string;
    }): Promise<{ errcode: number; errmsg: string }> {
        return this.requestJson("/cgi-bin/kf/service_state/trans", payload);
    }

    /**
     * 上传临时素材，得到 media_id（需配置 agent_id）
     */
    async uploadTempMedia(mediaType: string, data: Buffer, filename: string): Promise<string> {
        if (!this.config.agent_id) {
            throw new Error("发送媒体需配置 agent_id 以调用临时素材上传接口");
        }
        const token = await this.getAccessToken();
        const url = `${WECOM_API}/cgi-bin/media/upload?access_token=${encodeURIComponent(token)}&type=${encodeURIComponent(mediaType)}&agentid=${encodeURIComponent(this.config.agent_id)}`;
        const blob = new Blob([new Uint8Array(data)]);
        const form = new FormData();
        form.append("media", blob, filename);
        const res = await fetch(url, { method: "POST", body: form });
        const j = (await res.json()) as { errcode: number; errmsg: string; media_id?: string };
        if (j.errcode !== 0) {
            throw new Error(`上传临时素材失败: ${j.errmsg} (${j.errcode})`);
        }
        return j.media_id || "";
    }

    async start(): Promise<void> {
        await this.getAccessToken();
        this.emit("ready");
        if (this.config.enable_sync_poll && this.config.open_kfid) {
            const ms = this.config.sync_poll_interval_ms ?? 30000;
            this.pollTimer = setInterval(() => {
                void this.pullPollOnce(this.config.open_kfid!).then((items) => {
                    if (items.length) {
                        this.emit("kf_messages", { open_kfid: this.config.open_kfid, items });
                    }
                });
            }, ms);
        }
    }

    async stop(): Promise<void> {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        this.emit("stopped");
    }

    /**
     * 读取 Koa 请求体为字符串（兼容未被 koa-body 解析的流）
     */
    private async readRawBody(ctx: RouterContext): Promise<string> {
        const parsed = (ctx.request as { body?: unknown }).body;
        if (typeof parsed === "string" && parsed.length > 0) return parsed;
        if (Buffer.isBuffer(parsed) && parsed.length > 0) return parsed.toString("utf-8");
        if (parsed && typeof parsed === "object" && !Buffer.isBuffer(parsed)) {
            return JSON.stringify(parsed);
        }
        const chunks: Buffer[] = [];
        for await (const chunk of ctx.req) {
            chunks.push(chunk as Buffer);
        }
        return Buffer.concat(chunks).toString("utf-8");
    }

    /** GET/POST 微信客服接收消息回调 */
    async handleWebhook(ctx: RouterContext, next: Next): Promise<void> {
        try {
            if (ctx.method === "GET") {
                await this.handleVerifyUrl(ctx);
                await next();
                return;
            }
            if (ctx.method === "POST") {
                await this.handlePost(ctx);
                await next();
                return;
            }
            ctx.status = 405;
        } catch (e) {
            this.emit("error", e);
            ctx.status = 500;
            ctx.body = "error";
        }
    }

    private async handleVerifyUrl(ctx: RouterContext): Promise<void> {
        const q = ctx.query;
        const msgSignature = decodeURIComponent(String(q.msg_signature || ""));
        const timestamp = decodeURIComponent(String(q.timestamp || ""));
        const nonce = decodeURIComponent(String(q.nonce || ""));
        const echostr = decodeURIComponent(String(q.echostr || ""));
        if (!msgSignature || !timestamp || !nonce || !echostr) {
            ctx.status = 400;
            ctx.body = "缺少验证参数";
            return;
        }
        if (
            !verifyWeComSignature(this.config.token, msgSignature, timestamp, nonce, echostr)
        ) {
            ctx.status = 403;
            ctx.body = "签名校验失败";
            return;
        }
        const plain = decryptWeComPayload(echostr, this.config.encoding_aes_key);
        ctx.status = 200;
        ctx.body = plain;
    }

    private async handlePost(ctx: RouterContext): Promise<void> {
        const parsedBody = (ctx.request as { body?: unknown }).body;
        let raw = "";
        if (parsedBody && typeof parsedBody === "object" && !Buffer.isBuffer(parsedBody)) {
            const enc = (parsedBody as { Encrypt?: string }).Encrypt;
            if (typeof enc === "string" && enc) {
                await this.processEncryptedPost(ctx, enc);
                return;
            }
            raw = JSON.stringify(parsedBody);
        } else {
            raw = await this.readRawBody(ctx);
        }

        let encrypt: string | null = null;
        if (raw.trim().startsWith("{")) {
            try {
                const j = JSON.parse(raw) as { Encrypt?: string };
                encrypt = j.Encrypt || null;
            } catch {
                encrypt = null;
            }
        }
        if (!encrypt) {
            encrypt = extractEncryptFromXml(raw);
        }
        if (!encrypt) {
            ctx.status = 400;
            ctx.body = "";
            return;
        }
        await this.processEncryptedPost(ctx, encrypt);
    }

    /** 校验签名、解密并处理 kf_msg_or_event */
    private async processEncryptedPost(ctx: RouterContext, encrypt: string): Promise<void> {
        const q = ctx.query;
        const msgSignature = decodeURIComponent(String(q.msg_signature || ""));
        const timestamp = decodeURIComponent(String(q.timestamp || ""));
        const nonce = decodeURIComponent(String(q.nonce || ""));
        if (!verifyWeComSignature(this.config.token, msgSignature, timestamp, nonce, encrypt)) {
            ctx.status = 403;
            ctx.body = "";
            return;
        }
        const innerXml = decryptWeComPayload(encrypt, this.config.encoding_aes_key);
        const inner = parseSimpleXml(innerXml);
        const msgType = String(inner.MsgType || "");
        const event = String(inner.Event || "");

        if (msgType === "event" && event === "kf_msg_or_event") {
            const token = String(inner.Token || "");
            const openKfId = String(inner.OpenKfId || inner.OpenkfId || "");
            if (!token || !openKfId) {
                ctx.status = 200;
                ctx.body = "";
                return;
            }
            try {
                const items = await this.pullAllMessages(openKfId, token);
                this.emit("kf_messages", { open_kfid: openKfId, items });
            } catch (err) {
                this.emit("error", err);
            }
        }

        ctx.status = 200;
        ctx.body = "";
    }
}
