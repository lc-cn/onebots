import path from "node:path";
import { IlinkBot } from "./sdk/ilink-bot.js";
import type { WechatIlinkRuntimeConfig } from "./types.js";
import type { StaleCredentialFault } from "./sdk/internal/errors.js";
import type { ClawbotContextTokenStore } from "./context-token-store.js";

/** 会话 JSON 所在子目录（与平台标识一致） */
const SESSION_DATA_SUBDIR = "wechat-clawbot";

/** 约定会话文件路径（JsonFileCredentialStore）：`{cwd}/data/wechat-clawbot/{account_id}.json` */
function conventionSessionPath(accountId: string): string {
    const safeId = String(accountId).replace(/[^a-zA-Z0-9._-]/g, "_");
    return path.join(process.cwd(), "data", SESSION_DATA_SUBDIR, `${safeId}.json`);
}

/** OneBots 封装的 iLink 客户端：启动长轮询、可选扫码登录 */
export class WechatIlinkBot extends IlinkBot {
    private readonly cfg: WechatIlinkRuntimeConfig;
    /** 防止凭证失效重登与首次登录并发 */
    private reloginBusy = false;

    constructor(
        config: WechatIlinkRuntimeConfig,
        deps?: { contextTokenStore?: ClawbotContextTokenStore },
    ) {
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

        const store = deps?.contextTokenStore;
        super({
            session: initial,
            sessionStore: conventionSessionPath(config.account_id),
            token: config.token,
            accountId: config.ilink_bot_id,
            baseUrl: config.base_url,
            cdnBaseUrl: config.cdn_base_url,
            routeTag: config.route_tag,
            polling: false,
            contextTokenStore: store,
            contextTokenAccountKey: store ? config.account_id : undefined,
        });
        this.cfg = config;
        this.on("credential_stale", (_err: StaleCredentialFault) => {
            void this.handleCredentialStaleRelogin();
        });
    }

    getConfig(): WechatIlinkRuntimeConfig {
        return this.cfg;
    }

    /** 发起扫码并等待登录（首次启动与凭证失效重登共用） */
    private async runInteractiveQrLogin(): Promise<void> {
        const loginSession = await this.createLoginSession({ botType: this.cfg.bot_type });
        this.emit("qr", { qrCodeUrl: loginSession.qrCodeUrl, qrcode: loginSession.qrcode });
        const result = await this.waitForLogin(loginSession.sessionKey, {
            timeoutMs: this.cfg.qr_login_timeout_ms ?? 480_000,
            refreshExpiredQr: true,
            // 过期换码后再次推送到适配器 / Web，避免前端仍展示旧二维码
            onQrRefresh: ({ qrcode, qrCodeUrl }) => {
                this.emit("qr", { qrCodeUrl, qrcode, refreshed: true });
            },
        });
        if (!result.connected || !result.session) {
            throw new Error(result.message || "扫码登录失败");
        }
    }

    /**
     * 长轮询收到凭证失效后：已清会话，此处自动再走扫码登录并重启轮询（无需重启进程）。
     */
    private async handleCredentialStaleRelogin(): Promise<void> {
        if (this.reloginBusy) return;
        this.reloginBusy = true;
        try {
            if (this.pollLoop) {
                await this.pollLoop.catch(() => {});
            }
            this.pollLoop = null;

            if (!this.cfg.qr_login) {
                this.emit("relogin_blocked", {
                    message:
                        "会话已在服务端失效且本地已清除，但未启用扫码登录（qr_login），无法自动重新登录。请在配置中启用扫码或手动写入 token 后重启。",
                });
                return;
            }

            await this.runInteractiveQrLogin();

            await this.startPolling(this.pollingOptions());
            this.emit("ready");
        } catch (error: unknown) {
            this.emit("relogin_failed", error);
        } finally {
            this.reloginBusy = false;
        }
    }

    /** 加载会话、可选扫码登录、启动 getupdates 长轮询 */
    async start(): Promise<void> {
        await this.ensureSessionLoaded();
        let session = await this.getSession();

        if (!session) {
            if (this.cfg.qr_login) {
                await this.runInteractiveQrLogin();
                session = await this.getSession();
            } else {
                throw new Error(
                    "未找到 iLink 会话：请扫码登录（会话写入工作目录 data/wechat-clawbot/<账号>.json，重启可恢复）。",
                );
            }
        }

        await this.startPolling(this.pollingOptions());
        this.emit("ready");
    }

    /** 立即中止长轮询并通知 iLink 会话下线。 */
    async stop(): Promise<void> {
        await this.stopPolling();
    }

    private pollingOptions(): import("./sdk/protocol/chat-event.js").PollingOptions {
        return {
            timeoutMs: this.cfg.polling_timeout_ms,
            retryInitialDelayMs: this.cfg.polling_retry_initial_delay_ms,
            retryMaxDelayMs: this.cfg.polling_retry_max_delay_ms,
        };
    }
}
