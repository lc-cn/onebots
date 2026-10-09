import path from "node:path";
import {
    createClient,
    type Account as DouyinAccount,
    type AccountOptions,
    type ActionVerification,
    type Client,
    type LoginVerification,
} from "douyin-im";
import { Account, AccountStatus, type Adapter } from "onebots";
import type { DouyinAdapter } from "./adapter.js";
import { projectDouyinGroupRequest, projectDouyinMessage, projectDouyinNotice } from "./events.js";
import type { DouyinConfig } from "./types.js";

export class DouyinAccountFactory {
    private readonly dataDir: string;

    constructor(private readonly adapter: DouyinAdapter) {
        this.dataDir = path.join(adapter.app.dataDir, "douyin");
    }

    create(config: Account.Config<"douyin">): Account<"douyin", DouyinAccount> {
        // douyin-im Client 会按账号别名复用已注册的 Account。配置重载会重建 OneBots
        // wrapper，因此每个 wrapper 必须拥有独立 Client，避免沿用旧登录参数或重复绑定监听器。
        const client = createClient({ dataDir: this.dataDir, autoLoad: false });
        const sdkAccount = client.createAccount(toAccountOptions(config));
        const account = new Account<"douyin", DouyinAccount>(this.adapter, sdkAccount, config);
        wireAccount(account, this.adapter, client);
        return account;
    }
}

function wireAccount(
    account: Account<"douyin", DouyinAccount>,
    adapter: DouyinAdapter,
    client: Client,
): void {
    const sdk = account.client;
    const accountId = account.config.account_id;
    const browserChallenges = new Map<string, symbol>();
    let logoutTask: Promise<boolean> | undefined;
    const projection = () => ({
        botId: adapter.createId(sdk.uid ?? accountId),
        createId: (value: string | number) => adapter.createId(value),
    });
    const clearVerification = (type?: string) => {
        if (type) browserChallenges.delete(type);
        else browserChallenges.clear();
        adapter.emit("verification:clear", {
            platform: "douyin",
            account_id: accountId,
            ...(type ? { type } : {}),
        } satisfies Adapter.VerificationClear);
    };
    const removeSdkAccountOnce = () =>
        (logoutTask ??= client.removeAccount(accountId).catch(error => {
            adapter.logger.error(`注销抖音账号 ${accountId} 失败:`, error);
            throw error;
        }));

    sdk.on("system.online", payload => {
        account.status = AccountStatus.Online;
        account.nickname = payload.screenName ?? sdk.nickname ?? payload.platformUid;
        account.avatar = sdk.profile?.avatarThumb ?? "";
        clearVerification();
        adapter.logger.info(`抖音账号 ${account.nickname} (${payload.platformUid}) 已上线`);
    });
    sdk.on("system.reconnecting", payload => {
        account.status = AccountStatus.Pending;
        adapter.emit("connection:disconnected", { platform: "douyin", account_id: accountId });
        adapter.logger.warn(
            `抖音账号 ${accountId} 正在进行第 ${payload.attempt} 次重连: ${payload.reason ?? "连接中断"}`,
        );
    });
    sdk.on("system.offline", () => {
        account.status = AccountStatus.OffLine;
        adapter.logger.warn(`抖音账号 ${accountId} 已离线`);
    });
    sdk.on("system.login.error", error => {
        account.status = AccountStatus.OffLine;
        clearVerification();
        adapter.logger.error(`抖音账号 ${accountId} 登录失败:`, error);
    });
    sdk.on("system.handler.error", payload => {
        adapter.logger.error(`抖音事件 ${String(payload.event)} 处理失败:`, payload.error);
    });

    sdk.on("system.login.qrcode", payload => {
        clearVerification();
        adapter.emit("verification:request", {
            platform: "douyin",
            account_id: accountId,
            type: "qrcode",
            hint: "请使用抖音 App 扫描二维码并在手机端确认",
            options: {
                blocks: [
                    {
                        type: "image",
                        base64: payload.qrcodeBase64.replace(/^data:image\/[^;]+;base64,/u, ""),
                        alt: "抖音登录二维码",
                    },
                ],
            },
            data: { expire_time: payload.expireTime },
        } satisfies Adapter.VerificationRequest);
        void sdk.continueLogin().catch(error => {
            adapter.logger.error(`抖音账号 ${accountId} 二维码登录失败:`, error);
        });
    });
    sdk.on("system.login.sms", payload => {
        clearVerification();
        emitCodeRequest(adapter, accountId, "sms", payload);
    });
    sdk.on("system.login.voice", payload => {
        clearVerification();
        emitCodeRequest(adapter, accountId, "voice", payload);
    });
    sdk.on("system.login.sms-required", payload => {
        clearVerification();
        adapter.emit("verification:request", {
            platform: "douyin",
            account_id: accountId,
            type: "sms",
            hint: payload.reason || "需要短信验证码才能继续登录",
            requestSmsAvailable: true,
            options: {
                blocks: [
                    { type: "text", content: `验证手机号：${maskMobile(payload.mobile)}` },
                    { type: "input", key: "code", placeholder: "请输入短信验证码" },
                ],
            },
        } satisfies Adapter.VerificationRequest);
    });
    sdk.on("system.login.accounts", payload => {
        clearVerification();
        adapter.emit("verification:request", {
            platform: "douyin",
            account_id: accountId,
            type: "account-select",
            hint: "该手机号关联多个抖音账号，请选择要登录的账号",
            actions: [
                ...payload.accounts.map(option => ({
                    id: `select:${option.secUid}`,
                    label: option.nickname || option.douyinId || option.uid || "未命名账号",
                    variant: option.isActive ? ("primary" as const) : ("secondary" as const),
                })),
                ...(payload.canRegisterNewUser
                    ? [{ id: "register-new", label: "注册新账号", variant: "secondary" as const }]
                    : []),
            ],
        } satisfies Adapter.VerificationRequest);
    });
    sdk.on("system.login.verification", ({ verification }) => {
        openBrowserVerification(
            adapter,
            accountId,
            "browser-verification",
            verification,
            browserChallenges,
            clearVerification,
        );
    });
    sdk.on("system.action.verification", ({ verification }) => {
        openBrowserVerification(
            adapter,
            accountId,
            "action-verification",
            verification,
            browserChallenges,
            clearVerification,
        );
    });

    sdk.on("message", event => account.dispatchAwaited(projectDouyinMessage(event, projection())));
    sdk.on("request.group.join", event => {
        adapter.rememberGroupRequest(event);
        return account.dispatchAwaited(projectDouyinGroupRequest(event, projection()));
    });
    sdk.on("notice", event => {
        const projected = projectDouyinNotice(event, projection());
        return projected ? account.dispatchAwaited(projected) : undefined;
    });

    account.on("start", async (signal: AbortSignal) => {
        account.status = AccountStatus.Pending;
        logoutTask = undefined;
        const abort = () => void removeSdkAccountOnce().catch(() => undefined);
        signal.addEventListener("abort", abort, { once: true });
        try {
            await sdk.login();
        } catch (error) {
            account.status = AccountStatus.OffLine;
            adapter.logger.error(`启动抖音账号 ${accountId} 失败:`, error);
            throw error;
        } finally {
            signal.removeEventListener("abort", abort);
        }
    });
    account.on("stop", async () => {
        try {
            await removeSdkAccountOnce();
        } finally {
            account.status = AccountStatus.OffLine;
            clearVerification();
            sdk.removeAllListeners();
        }
    });
}

function toAccountOptions(config: DouyinConfig): AccountOptions {
    const method = config.login_method ?? "qr";
    let login: AccountOptions["login"];
    if (method === "qr") {
        login = { method: "qr" };
    } else {
        const mobile = config.mobile?.trim();
        if (!mobile) throw new Error(`抖音 ${method} 登录必须配置手机号`);
        if (method === "sms") login = { method: "sms", mobile };
        else {
            if (!config.password) throw new Error("抖音 password 登录必须配置密码");
            login = { method: "password", mobile, password: config.password };
        }
    }
    return {
        accountId: config.account_id,
        login,
    };
}

function emitCodeRequest(
    adapter: DouyinAdapter,
    accountId: string,
    type: "sms" | "voice",
    payload: { mobile: string; maskedMobile?: string },
): void {
    adapter.emit("verification:request", {
        platform: "douyin",
        account_id: accountId,
        type,
        hint: `请输入发送到 ${payload.maskedMobile ?? maskMobile(payload.mobile)} 的验证码`,
        options: {
            blocks: [{ type: "input", key: "code", placeholder: "请输入验证码" }],
        },
        requestSmsAvailable: type === "sms",
        actions: [{ id: "request-voice", label: "改用语音验证码" }],
    } satisfies Adapter.VerificationRequest);
}

function openBrowserVerification(
    adapter: DouyinAdapter,
    accountId: string,
    type: string,
    verification: LoginVerification | ActionVerification,
    browserChallenges: Map<string, symbol>,
    clearVerification: (type?: string) => void,
): void {
    clearVerification();
    const owner = Symbol(type);
    browserChallenges.set(type, owner);
    adapter.emit("verification:request", {
        platform: "douyin",
        account_id: accountId,
        type,
        hint: "抖音要求进行安全验证，验证页面已在 OneBots 所在主机打开",
        options: {
            blocks: [
                { type: "text", content: "请在运行 OneBots 的电脑上完成抖音官方验证页面。" },
                {
                    type: "json",
                    label: "验证信息",
                    content:
                        "methods" in verification
                            ? {
                                  operation: verification.operation,
                                  methods: [...verification.methods],
                                  description: verification.description,
                              }
                            : { operation: verification.target.operation },
                },
            ],
        },
    } satisfies Adapter.VerificationRequest);
    void verification.open().then(
        () => {
            if (browserChallenges.get(type) !== owner) return;
            clearVerification(type);
        },
        error => adapter.logger.error(`抖音账号 ${accountId} 安全验证失败:`, error),
    );
}

function maskMobile(mobile: string): string {
    return mobile.replace(/^(\d{3})\d+(\d{4})$/u, "$1****$2");
}
