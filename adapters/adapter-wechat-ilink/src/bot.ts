import path from "node:path";
import { IlinkBot } from "./sdk/ilink-bot.js";
import type { WechatIlinkConfig } from "./types.js";

/** 约定会话文件路径（JsonFileCredentialStore）：`{cwd}/data/wechat-ilink/{account_id}.json` */
function conventionSessionPath(accountId: string): string {
    const safeId = String(accountId).replace(/[^a-zA-Z0-9._-]/g, "_");
    return path.join(process.cwd(), "data", "wechat-ilink", `${safeId}.json`);
}

/** OneBots 封装的 iLink 客户端：启动长轮询、可选扫码登录 */
export class WechatIlinkBot extends IlinkBot {
    private readonly cfg: WechatIlinkConfig;

    constructor(config: WechatIlinkConfig) {
        const initial =
            config.token && config.ilink_bot_id
                ? {
                      token: config.token,
                      accountId: config.ilink_bot_id,
                      baseUrl: config.base_url,
                      cdnBaseUrl: config.cdn_base_url,
                      routeTag: config.route_tag,
                      contextTokens: {},
                  }
                : null;

        super({
            session: initial,
            sessionStore: conventionSessionPath(config.account_id),
            token: config.token,
            accountId: config.ilink_bot_id,
            baseUrl: config.base_url,
            cdnBaseUrl: config.cdn_base_url,
            routeTag: config.route_tag,
            polling: false,
        });
        this.cfg = config;
    }

    getConfig(): WechatIlinkConfig {
        return this.cfg;
    }

    /** 加载会话、可选扫码登录、启动 getupdates 长轮询 */
    async start(): Promise<void> {
        await this.ensureSessionLoaded();
        let session = await this.getSession();

        if (!session) {
            if (this.cfg.qr_login) {
                const loginSession = await this.createLoginSession({ botType: this.cfg.bot_type });
                this.emit("qr", { qrCodeUrl: loginSession.qrCodeUrl, qrcode: loginSession.qrcode });
                const result = await this.waitForLogin(loginSession.sessionKey, {
                    timeoutMs: this.cfg.qr_login_timeout_ms ?? 480_000,
                    refreshExpiredQr: true,
                });
                if (!result.connected || !result.session) {
                    throw new Error(result.message || "扫码登录失败");
                }
                session = result.session;
            } else {
                throw new Error(
                    "未找到 iLink 会话：请扫码登录（会话写入工作目录 data/wechat-ilink/<账号>.json，重启可恢复）。",
                );
            }
        }

        // startPolling 内部为无限长轮询，返回的 Promise 仅在停止轮询时才会结束；
        // 若 await，则永远到不了 ready，账号会一直处于 pending。
        void this.startPolling({
            timeoutMs: this.cfg.polling_timeout_ms,
            retryDelayMs: this.cfg.polling_retry_delay_ms,
        }).catch((err: unknown) => {
            this.emit("polling_error", err);
        });
        this.emit("ready");
    }
}
