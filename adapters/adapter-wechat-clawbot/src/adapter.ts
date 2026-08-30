/**
 * 微信 ClawBot（iLink Bot HTTP）适配器，平台标识 **`wechat-clawbot`**。
 */
import {
    Account,
    AccountStatus,
    Adapter,
    AdapterRegistry,
    BaseApp,
    readPackageVersion,
} from "onebots";
import { WechatIlinkBot } from "./bot.js";
import type { WechatClawbotConfig, WechatIlinkRuntimeConfig } from "./types.js";
import type { IlinkBotMessage } from "./sdk/ilink-types.js";
import { wechatClawbotCapabilities } from "./capabilities.js";
import { projectWechatClawbotEvent } from "./events.js";
import {
    executeWechatClawbotPlatformAction,
    WECHAT_CLAWBOT_PLATFORM_ACTIONS,
} from "./platform-actions.js";
import {
    ILINK_CDN_ROOT_DEFAULT,
    ILINK_HTTP_ORIGIN_DEFAULT,
    ILINK_QR_BOT_CLASS_DEFAULT,
} from "./sdk/internal/config.js";
import { GatewayFault, StaleCredentialFault } from "./sdk/internal/errors.js";
import {
    ensureWechatClawbotContextTokenTable,
    SqliteClawbotContextTokenStore,
} from "./context-token-store.js";
import { compileWechatClawbotMessage } from "./messages.js";

/** DNS / 超时等可恢复网络错误，轮询循环会自动重试 */
function isTransientNetworkError(error: unknown): boolean {
    const codes = new Set([
        "ENOTFOUND",
        "EAI_AGAIN",
        "ECONNRESET",
        "ECONNREFUSED",
        "ETIMEDOUT",
        "EPIPE",
        "ENETUNREACH",
        "UND_ERR_CONNECT_TIMEOUT",
        "UND_ERR_HEADERS_TIMEOUT",
        "UND_ERR_BODY_TIMEOUT",
        "ABORT_ERR",
    ]);
    const walk = (value: unknown, depth = 0): boolean => {
        if (!value || depth > 4) return false;
        if (typeof value === "string") {
            const lower = value.toLowerCase();
            return (
                lower.includes("timeout") ||
                lower.includes("enotfound") ||
                lower.includes("fetch failed") ||
                lower.includes("network")
            );
        }
        if (value instanceof Error) {
            const code = (value as Error & { code?: string }).code;
            if (code && codes.has(code)) return true;
            if (value.name === "TimeoutError" || value.name === "AbortError") return true;
            if (walk(value.message, depth + 1)) return true;
            return walk((value as Error & { cause?: unknown }).cause, depth + 1);
        }
        if (typeof value === "object") {
            const obj = value as {
                code?: string;
                message?: string;
                cause?: unknown;
                name?: string;
            };
            if (obj.code && codes.has(obj.code)) return true;
            if (obj.name === "TimeoutError" || obj.name === "AbortError") return true;
            if (obj.message && walk(obj.message, depth + 1)) return true;
            return walk(obj.cause, depth + 1);
        }
        return false;
    };
    return walk(error);
}

function summarizeNetworkError(error: unknown): string {
    if (error instanceof Error) {
        const cause = (error as Error & { cause?: unknown }).cause;
        if (cause instanceof Error) {
            const code = (cause as Error & { code?: string }).code;
            return code
                ? `${error.message} (${code}: ${cause.message})`
                : `${error.message} (${cause.message})`;
        }
        return error.message;
    }
    return String(error);
}

function buildWechatClawbotQrBlocks(qrCodeUrl: string): Adapter.VerificationBlock[] {
    const blocks: Adapter.VerificationBlock[] = [];
    const img = qrCodeUrl.trim();
    if (img.startsWith("http://") || img.startsWith("https://")) {
        // iLink 的 qrcode_img_content 是二维码页面 URL 而非图片，<img> 无法直接展示；
        // 发 qrcode 内容块由前端本地渲染二维码，并附链接兜底（不支持 qrcode 块的客户端可点链接打开）
        blocks.push({ type: "qrcode", content: img, alt: "ClawBot / iLink 登录二维码" });
        blocks.push({ type: "link", url: img, label: "无法显示二维码？点击打开二维码页面" });
    } else if (img.startsWith("data:image")) {
        const comma = img.indexOf(",");
        const base64 = comma >= 0 ? img.slice(comma + 1) : img;
        blocks.push({ type: "image", base64, alt: "ClawBot / iLink 登录二维码" });
    } else {
        blocks.push({ type: "image", base64: img, alt: "ClawBot / iLink 登录二维码" });
    }
    blocks.push({
        type: "text",
        content: "请使用微信扫描上方二维码；扫码成功后进程将自动继续，无需在此点击提交。",
    });
    return blocks;
}

export class WechatClawbotAdapter extends Adapter<WechatIlinkBot, "wechat-clawbot"> {
    constructor(app: BaseApp) {
        super(app, "wechat-clawbot", wechatClawbotCapabilities);
        this.icon = "https://res.wx.qq.com/a/wx_fed/assets/res/OTE0YTAw.png";
    }

    executePlatformAction(
        uin: string,
        action: string,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        if (!WECHAT_CLAWBOT_PLATFORM_ACTIONS.has(action)) {
            return super.executePlatformAction(uin, action, params);
        }
        return executeWechatClawbotPlatformAction(this.requireClient(uin), action, params);
    }

    isPlatformActionImplemented(action: string): boolean {
        return WECHAT_CLAWBOT_PLATFORM_ACTIONS.has(action);
    }

    override submitVerification(
        accountId: string,
        type: string,
        data: Record<string, unknown>,
    ): void {
        if (type !== "pair_code") {
            throw new GatewayFault(
                "VERIFICATION_TYPE_UNSUPPORTED",
                `微信 ClawBot 不支持验证类型 ${type}`,
            );
        }
        const code = typeof data.code === "string" ? data.code : "";
        this.requireClient(accountId).submitVerificationCode(code);
    }

    private requireClient(uin: string): WechatIlinkBot {
        const account = this.getAccount(uin);
        if (!account) throw new GatewayFault("ACCOUNT_NOT_FOUND", `未找到账号 ${uin}`);
        return account.client;
    }

    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        const account = this.getAccount(uin);
        if (!account) throw new GatewayFault("ACCOUNT_NOT_FOUND", `未找到账号 ${uin}`);

        const bot = account.client;
        const { scene_type, message } = params;
        const sceneId = this.coerceId(params.scene_id);

        if (scene_type !== "private") {
            throw new GatewayFault(
                "SCENE_NOT_SUPPORTED",
                `${this.platform} 仅支持私聊 (private)，当前: ${scene_type}`,
            );
        }

        const chatId = sceneId.string;
        if (!message || message.length === 0) {
            throw new GatewayFault("MESSAGE_EMPTY", "消息段为空");
        }
        let lastId = "";
        for (const operation of compileWechatClawbotMessage(message)) {
            if (operation.kind === "text") {
                lastId = (await bot.sendTextToUser(chatId, operation.text)).messageId;
            } else if (operation.kind === "image") {
                lastId = (await bot.sendPhotoToUser(chatId, operation.input, operation.options))
                    .messageId;
            } else if (operation.kind === "video") {
                lastId = (await bot.sendVideoToUser(chatId, operation.input, operation.options))
                    .messageId;
            } else {
                lastId = (await bot.sendDocumentToUser(chatId, operation.input, operation.options))
                    .messageId;
            }
        }

        return {
            message_id: this.createId(lastId),
        };
    }

    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new GatewayFault("ACCOUNT_NOT_FOUND", `未找到账号 ${uin}`);
        const session = await account.client.getSession();
        if (!session) {
            throw new GatewayFault("SESSION_NOT_AVAILABLE", "iLink 会话尚未建立");
        }
        return {
            user_id: this.createId(session.accountId),
            user_name: account.nickname || session.accountId,
            avatar: account.avatar || this.icon,
        };
    }

    async canSendImage(): Promise<boolean> {
        return true;
    }

    async canSendRecord(): Promise<boolean> {
        return false;
    }

    async getVersion(): Promise<Adapter.VersionInfo> {
        return {
            app_name: "onebots wechat-clawbot adapter",
            app_version: await readPackageVersion(import.meta.url),
            impl: this.platform,
            version: "iLink Bot HTTP",
        };
    }

    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const account = this.getAccount(uin);
        return {
            online: account?.status === AccountStatus.Online,
            good: account?.status === AccountStatus.Online,
        };
    }

    createAccount(
        config: Account.Config<"wechat-clawbot">,
    ): Account<"wechat-clawbot", WechatIlinkBot> {
        /** token / ilink_bot_id / 端点 / bot_type / qr_login 等由约定与会话文件驱动，不从 YAML 读取 */
        const wc: WechatIlinkRuntimeConfig = {
            account_id: config.account_id,
            receive_mode: config.receive_mode,
            base_url: ILINK_HTTP_ORIGIN_DEFAULT,
            cdn_base_url: ILINK_CDN_ROOT_DEFAULT,
            bot_type: ILINK_QR_BOT_CLASS_DEFAULT,
            qr_login: true,
            qr_login_timeout_ms: config.qr_login_timeout_ms ?? 480_000,
            polling_timeout_ms: config.polling_timeout_ms,
            polling_retry_initial_delay_ms: config.polling_retry_initial_delay_ms,
            polling_retry_max_delay_ms: config.polling_retry_max_delay_ms,
        };

        ensureWechatClawbotContextTokenTable(this.db);
        const contextTokenStore = new SqliteClawbotContextTokenStore(this.db);
        const bot = new WechatIlinkBot(wc, { contextTokenStore });
        const account = new Account<"wechat-clawbot", WechatIlinkBot>(this, bot, config);

        bot.on("qr", (payload: { qrCodeUrl: string; qrcode: string; refreshed?: boolean }) => {
            this.logger.info(
                `[${this.platform}] ${config.account_id} 请使用微信扫描登录: ${payload.qrCodeUrl}` +
                    (payload.refreshed ? " [已刷新]" : ""),
            );
            this.emit("verification:request", {
                platform: this.platform,
                account_id: config.account_id,
                type: "qrcode",
                hint: payload.refreshed
                    ? "二维码已过期并自动刷新，请使用微信重新扫描"
                    : "请使用微信扫描下方二维码完成 iLink 扩展登录",
                options: { blocks: buildWechatClawbotQrBlocks(payload.qrCodeUrl) },
                data: { refreshed: !!payload.refreshed },
            } satisfies Adapter.VerificationRequest);
        });

        bot.on("verification_code_required", () => {
            this.emit("verification:request", {
                platform: this.platform,
                account_id: config.account_id,
                type: "pair_code",
                hint: "请输入手机微信显示的数字配对码",
                options: {
                    blocks: [
                        {
                            type: "input",
                            key: "code",
                            placeholder: "4 至 8 位数字",
                            maxLength: 8,
                            secret: true,
                        },
                    ],
                },
            } satisfies Adapter.VerificationRequest);
        });

        bot.on("login", session => {
            account.nickname = session.accountId;
            account.avatar = this.icon;
            this.logger.info(`[${this.platform}] ${config.account_id} 扫码登录成功`);
            this.emit("verification:clear", {
                platform: this.platform,
                account_id: config.account_id,
            } as Adapter.VerificationClear);
        });

        bot.on("credential_stale", (err: StaleCredentialFault) => {
            account.status = AccountStatus.Pending;
            this.logger.warn(
                `[${this.platform}] ${config.account_id} 会话已在服务端失效，本地凭证已清除，将自动弹出二维码重新登录（无需重启）。原因: ${err.message}`,
            );
        });

        bot.on("relogin_blocked", (payload: { message: string }) => {
            account.status = AccountStatus.OffLine;
            this.logger.warn(`[${this.platform}] ${config.account_id} ${payload.message}`);
        });

        bot.on("relogin_failed", (error: unknown) => {
            account.status = AccountStatus.OffLine;
            this.logger.error(
                `[${this.platform}] ${config.account_id} 自动重新扫码登录失败:`,
                error,
            );
        });

        bot.on("ready", async () => {
            const session = await bot.getSession();
            if (!session) {
                throw new GatewayFault("SESSION_NOT_AVAILABLE", "iLink 就绪时缺少会话身份");
            }
            account.nickname = session.accountId;
            account.avatar = this.icon;
            account.status = AccountStatus.Online;
            this.logger.info(`[${this.platform}] ${config.account_id} iLink 会话已就绪`);
        });

        bot.on("polling_error", (error: unknown) => {
            if (error instanceof StaleCredentialFault) return;
            if (isTransientNetworkError(error)) {
                this.logger.warn(
                    `[${this.platform}] ${config.account_id} 轮询网络异常（将自动重试）: ${summarizeNetworkError(error)}`,
                );
                return;
            }
            this.logger.error(`[${this.platform}] ${config.account_id} 轮询错误:`, error);
        });

        bot.on("listener_error", (payload: { event: string; error: unknown }) => {
            this.logger.error(
                `[${this.platform}] ${config.account_id} 事件监听器 ${payload.event} 执行失败:`,
                payload.error,
            );
        });

        bot.on("message", async (m: IlinkBotMessage) => {
            const rawText = m.text ?? m.caption ?? "";
            const preview = rawText.length > 80 ? `${rawText.slice(0, 80)}...` : rawText;
            this.logger.info(`[${this.platform}] 收到私聊 | from=${m.from.id} | ${preview}`);

            const session = await bot.getSession();
            if (!session) {
                throw new GatewayFault("SESSION_NOT_AVAILABLE", "iLink 消息缺少机器人会话身份");
            }
            return account.dispatchAwaited(
                projectWechatClawbotEvent(m, {
                    accountId: this.createId(session.accountId),
                    createId: value => this.createId(value),
                }),
            );
        });

        account.on("start", async () => {
            try {
                await bot.start();
            } catch (error) {
                account.status = AccountStatus.OffLine;
                this.logger.error(`[${this.platform}] ${config.account_id} 启动失败:`, error);
                throw error;
            }
        });
        account.on("stop", async () => {
            try {
                await bot.stop();
            } catch (error) {
                this.logger.error(`[${this.platform}] ${config.account_id} 停止失败:`, error);
                throw error;
            } finally {
                account.status = AccountStatus.OffLine;
            }
        });

        return account;
    }
}

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            "wechat-clawbot": WechatClawbotConfig;
        }
    }
}

AdapterRegistry.register("wechat-clawbot", WechatClawbotAdapter, {
    name: "wechat-clawbot",
    displayName: "微信 ClawBot (iLink)",
    description: "基于 iLink Bot HTTP 的微信扩展（ClawBot）：扫码登录 + 长轮询，需合规使用",
    icon: "https://res.wx.qq.com/a/wx_fed/assets/res/OTE0YTAw.png",
    homepage: "https://ilinkai.weixin.qq.com",
    author: "凉菜",
    capabilities: wechatClawbotCapabilities,
});
