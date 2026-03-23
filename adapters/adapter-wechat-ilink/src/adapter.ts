/**
 * wechat-ilink：微信扩展（iLink Bot HTTP）适配器
 */
import { Account, AdapterRegistry, AccountStatus } from "onebots";
import { Adapter } from "onebots";
import { BaseApp } from "onebots";
import { WechatIlinkBot } from "./bot.js";
import { CommonEvent, type CommonTypes } from "onebots";
import type { WechatIlinkConfig } from "./types.js";
import type { IlinkBotMessage } from "./sdk/ilink-types.js";
import {
    ILINK_CDN_ROOT_DEFAULT,
    ILINK_HTTP_ORIGIN_DEFAULT,
    ILINK_QR_BOT_CLASS_DEFAULT,
} from "./sdk/internal/config.js";

function buildWechatIlinkQrBlocks(qrCodeUrl: string, _qrcode: string): Adapter.VerificationBlock[] {
    const blocks: Adapter.VerificationBlock[] = [];
    const img = qrCodeUrl.trim();
    if (img.startsWith("http://") || img.startsWith("https://")) {
        blocks.push({
            type: "image_url",
            url: img,
            alt: "iLink 登录二维码",
        });
    } else if (img.startsWith("data:image")) {
        const comma = img.indexOf(",");
        const base64 = comma >= 0 ? img.slice(comma + 1) : img;
        blocks.push({ type: "image", base64, alt: "iLink 登录二维码" });
    } else {
        blocks.push({ type: "image", base64: img, alt: "iLink 登录二维码" });
    }
    blocks.push({
        type: "text",
        content: "请使用微信扫描上方二维码；扫码成功后进程将自动继续，无需在此点击提交。",
    });
    return blocks;
}

function ilinkTimeToMs(t?: number): number {
    if (t == null || !Number.isFinite(t)) return Date.now();
    if (t >= 1_000_000_000_000) return Math.floor(t);
    return Math.floor(t * 1000);
}

export class WechatIlinkAdapter extends Adapter<WechatIlinkBot, "wechat-ilink"> {
    constructor(app: BaseApp) {
        super(app, "wechat-ilink");
        this.icon = "https://res.wx.qq.com/a/wx_fed/assets/res/OTE0YTAw.png";
    }

    async sendMessage(uin: string, params: Adapter.SendMessageParams): Promise<Adapter.SendMessageResult> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`未找到账号 ${uin}`);

        const bot = account.client;
        const { scene_type, message } = params;
        const sceneId = this.coerceId(params.scene_id as CommonTypes.Id | string | number);

        if (scene_type !== "private") {
            throw new Error(`wechat-ilink 仅支持私聊 (private)，当前: ${scene_type}`);
        }

        const chatId = sceneId.string;
        let lastId = "";

        if (!message || message.length === 0) {
            throw new Error("消息段为空");
        }

        for (const seg of message) {
            if (typeof seg === "string") {
                const r = await bot.sendTextToUser(chatId, seg);
                lastId = r.messageId;
            } else if (seg.type === "text") {
                const t = seg.data.text ?? "";
                if (t) {
                    const r = await bot.sendTextToUser(chatId, t);
                    lastId = r.messageId;
                }
            } else if (seg.type === "image") {
                const url = seg.data.url ?? seg.data.file;
                if (!url) throw new Error("图片消息缺少 url 或 file");
                const r = await bot.sendPhotoToUser(chatId, url, { caption: seg.data.summary });
                lastId = r.messageId;
            } else if (seg.type === "video") {
                const url = seg.data.url ?? seg.data.file;
                if (!url) throw new Error("视频消息缺少 url 或 file");
                const r = await bot.sendVideoToUser(chatId, url, { caption: seg.data.summary });
                lastId = r.messageId;
            } else if (seg.type === "file") {
                const url = seg.data.url ?? seg.data.file;
                if (!url) throw new Error("文件消息缺少 url 或 file");
                const r = await bot.sendDocumentToUser(chatId, url, { caption: seg.data.name });
                lastId = r.messageId;
            } else {
                throw new Error(`暂不支持的段类型: ${seg.type}`);
            }
        }

        return {
            message_id: this.createId(lastId || "0"),
        };
    }

    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`未找到账号 ${uin}`);
        const cfg = account.client.getConfig();
        return {
            user_id: this.createId(cfg.ilink_bot_id ?? uin),
            user_name: account.nickname || cfg.ilink_bot_id || "wechat-ilink",
            avatar: account.avatar || this.icon,
        };
    }

    async getVersion(uin: string): Promise<Adapter.VersionInfo> {
        return {
            app_name: "onebots wechat-ilink adapter",
            app_version: "1.0.0",
            impl: "wechat-ilink",
            version: "1.0.0",
        };
    }

    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const account = this.getAccount(uin);
        return {
            online: account?.status === AccountStatus.Online,
            good: account?.status === AccountStatus.Online,
        };
    }

    /**
     * iLink 侧无完整「好友列表」开放能力时，返回单条占位。
     * - `accountId`：机器人账号（CredentialBlob.accountId），不当作好友。
     * - `userId`：微信用户账号（CredentialBlob.userId），好友列表仅使用此项。
     */
    async getFriendList(uin: string, _params?: Adapter.GetFriendListParams): Promise<Adapter.FriendInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`未找到账号 ${uin}`);
        const session = await account.client.getSession();
        if (!session) {
            throw new Error("未加载 iLink 会话，无法获取好友列表");
        }
        if (!session.userId) {
            throw new Error("会话中缺少 userId（微信用户标识），无法组装好友列表");
        }
        return [
            {
                user_id: this.createId(session.userId),
                user_name: session.userId,
            },
        ];
    }

    private buildSegments(m: IlinkBotMessage): CommonTypes.Segment[] {
        const segments: CommonTypes.Segment[] = [];
        if (m.type === "text" && m.text) {
            segments.push({ type: "text", data: { text: m.text } });
        } else if (m.type === "photo") {
            if (m.caption) segments.push({ type: "text", data: { text: m.caption } });
            if (m.media?.fileId) {
                segments.push({
                    type: "image",
                    data: { url: `ilink-cdn:${m.media.fileId}` },
                });
            }
        } else if (m.type === "video") {
            if (m.caption) segments.push({ type: "text", data: { text: m.caption } });
            if (m.media?.fileId) {
                segments.push({
                    type: "video",
                    data: { url: `ilink-cdn:${m.media.fileId}` },
                });
            }
        } else if (m.type === "document") {
            if (m.caption) segments.push({ type: "text", data: { text: m.caption } });
            if (m.media?.fileId) {
                segments.push({
                    type: "file",
                    data: {
                        url: `ilink-cdn:${m.media.fileId}`,
                        name: m.media.kind === "document" ? m.media.fileName : undefined,
                    },
                });
            }
        } else if (m.type === "voice") {
            if (m.text) segments.push({ type: "text", data: { text: m.text } });
            if (m.media?.fileId) {
                segments.push({
                    type: "file",
                    data: { url: `ilink-cdn:${m.media.fileId}`, name: "voice.silk" },
                });
            }
        } else {
            segments.push({
                type: "text",
                data: { text: "[不支持的消息类型]" },
            });
        }
        if (segments.length === 0) {
            segments.push({ type: "text", data: { text: "" } });
        }
        return segments;
    }

    createAccount(config: Account.Config<"wechat-ilink">): Account<"wechat-ilink", WechatIlinkBot> {
        /** token / ilink_bot_id / 端点 / bot_type / qr_login 等由约定与会话文件驱动，不从 YAML 读取 */
        const wc: WechatIlinkConfig = {
            account_id: config.account_id,
            base_url: ILINK_HTTP_ORIGIN_DEFAULT,
            cdn_base_url: ILINK_CDN_ROOT_DEFAULT,
            bot_type: ILINK_QR_BOT_CLASS_DEFAULT,
            qr_login: true,
            qr_login_timeout_ms: config.qr_login_timeout_ms ?? 480_000,
            polling_timeout_ms: config.polling_timeout_ms,
            polling_retry_delay_ms: config.polling_retry_delay_ms,
        };

        const bot = new WechatIlinkBot(wc);
        const account = new Account<"wechat-ilink", WechatIlinkBot>(this, bot, config);

        bot.on("qr", (payload: { qrCodeUrl: string; qrcode: string }) => {
            this.logger.info(
                `[wechat-ilink] ${config.account_id} 请使用微信扫描登录: ${payload.qrCodeUrl} (qrcode=${payload.qrcode.slice(0, 16)}...)`,
            );
            this.emit("verification:request", {
                platform: "wechat-ilink",
                account_id: config.account_id,
                type: "qrcode",
                hint: "请使用微信扫描下方二维码完成 iLink 扩展登录",
                options: { blocks: buildWechatIlinkQrBlocks(payload.qrCodeUrl, payload.qrcode) },
                data: { qrcode: payload.qrcode },
            } as unknown as Adapter.VerificationRequest);
        });

        bot.on("login", (session) => {
            account.nickname = session.accountId;
            account.avatar = this.icon;
            console.log('session', session);
            this.logger.info(`[wechat-ilink] ${config.account_id} 扫码登录成功，ilink_bot_id=${session.accountId}`);
        });

        bot.on("ready", () => {
            account.status = AccountStatus.Online;
            this.logger.info(`[wechat-ilink] ${config.account_id} 长轮询已启动`);
        });

        bot.on("polling_error", (err: unknown) => {
            this.logger.error(`[wechat-ilink] ${config.account_id} 轮询错误:`, err);
        });

        bot.on("message", (m: IlinkBotMessage) => {
            const rawText = m.text ?? m.caption ?? "";
            const preview = rawText.length > 80 ? `${rawText.slice(0, 80)}...` : rawText;
            this.logger.info(`[wechat-ilink] 收到私聊 | from=${m.from.id} | ${preview}`);

            const segments = this.buildSegments(m);
            const mid = m.id != null ? String(m.id) : m.seq != null ? String(m.seq) : String(Date.now());

            const commonEvent: CommonEvent.Message = {
                id: this.createId(mid),
                timestamp: ilinkTimeToMs(m.date),
                platform: "wechat-ilink",
                bot_id: this.createId(config.account_id),
                type: "message",
                message_type: "private",
                sender: {
                    id: this.createId(m.from.id),
                    name: m.from.id,
                },
                message_id: this.createId(mid),
                raw_message: JSON.stringify(m.raw),
                message: segments,
            };

            account.dispatch(commonEvent);
        });

        void bot.start().catch((e: unknown) => {
            this.logger.error(`[wechat-ilink] ${config.account_id} 启动失败:`, e);
            account.status = AccountStatus.OffLine;
        });

        return account;
    }
}

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            "wechat-ilink": WechatIlinkConfig;
        }
    }
}

AdapterRegistry.register("wechat-ilink", WechatIlinkAdapter, {
    name: "wechat-ilink",
    displayName: "微信 iLink",
    description: "基于 iLink Bot HTTP 的微信扩展机器人（扫码登录 + 长轮询，需合规使用）",
    icon: "https://res.wx.qq.com/a/wx_fed/assets/res/OTE0YTAw.png",
    homepage: "https://ilinkai.weixin.qq.com",
    author: "凉菜",
});
