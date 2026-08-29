import { Buffer } from "node:buffer";
import { AccountStatus, type Account, type Adapter } from "onebots";
import type { ICQQBot } from "./bot.js";
import {
    projectICQQAdmin,
    projectICQQMembership,
    projectICQQMessage,
    projectICQQMute,
    projectICQQPoke,
    projectICQQRecall,
    projectICQQRequest,
    type ICQQProjectionContext,
} from "./events.js";
import type {
    ICQQAuthEvent,
    ICQQDeviceEvent,
    ICQQFriendRecallEvent,
    ICQQFriendRequestEvent,
    ICQQGroupAdminEvent,
    ICQQGroupDecreaseEvent,
    ICQQGroupIncreaseEvent,
    ICQQGroupMessageEvent,
    ICQQGroupMuteEvent,
    ICQQGroupRecallEvent,
    ICQQGroupRequestEvent,
    ICQQLoginErrorEvent,
    ICQQOfflineEvent,
    ICQQPokeEvent,
    ICQQPrivateMessageEvent,
    ICQQQRCodeEvent,
    ICQQSliderEvent,
    ICQQUser,
} from "./types.js";

interface LoggerLike {
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
}

export interface ICQQAccountEventContext {
    logger: LoggerLike;
    emit(event: string, payload: unknown): void;
    projectionContext(accountId: string): ICQQProjectionContext;
}

/** 连接账号生命周期、登录验证和平台事件；账号构造本身保持无副作用。 */
export function wireICQQAccountEvents(
    account: Account<"icqq", ICQQBot>,
    context: ICQQAccountEventContext,
): void {
    const bot = account.client;
    const accountId = account.config.account_id;
    const projection = () => context.projectionContext(accountId);
    const emit = (event: string, payload: unknown) => context.emit(event, payload);
    const clearVerification = (type?: string) => {
        emit("verification:clear", {
            platform: "icqq",
            account_id: accountId,
            ...(type ? { type } : {}),
        } satisfies Adapter.VerificationClear);
    };

    bot.on("ready", (user: ICQQUser) => {
        context.logger.info(`ICQQ Bot ${user.nickname} (${user.user_id}) 已就绪`);
        account.status = AccountStatus.Online;
        account.nickname = user.nickname;
        account.avatar = user.avatar ?? "";
        clearVerification();
    });
    bot.on("offline", (event: ICQQOfflineEvent) => {
        const message = event.message || "账号已离线";
        context.logger.warn(`ICQQ Bot 离线: ${message}`);
        account.status = AccountStatus.OffLine;
        emit("verification:request", reloginRequest(accountId, "offline", message));
    });
    bot.on("offline_network", (event: ICQQOfflineEvent) => {
        const message = event.message || "网络连接中断";
        context.logger.warn(`ICQQ Bot 网络离线（将自动重连）: ${message}`);
        account.status = AccountStatus.Pending;
    });
    bot.on("heartbeat_error", (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        context.logger.warn(`ICQQ SSO 心跳异常（已恢复调度）: ${message}`);
    });
    bot.on("stop_error", (error: unknown) => {
        context.logger.warn("ICQQ 登出失败，已强制清理本地客户端", error);
    });

    const clearStatusCards = () => {
        clearVerification("offline");
        clearVerification("login_error");
    };
    bot.on("qrcode", (event: ICQQQRCodeEvent) => {
        clearStatusCards();
        context.logger.info("ICQQ 请扫描二维码登录");
        emit("qrcode", { account_id: accountId, image: event.image });
        const base64 = Buffer.isBuffer(event.image)
            ? event.image.toString("base64")
            : String(event.image);
        emit("verification:request", {
            platform: "icqq",
            account_id: accountId,
            type: "qrcode",
            hint: "请使用手机 QQ 扫描二维码，在手机确认后继续登录",
            confirmable: true,
            confirmLabel: "已完成，继续登录",
            options: { blocks: [{ type: "image", base64, alt: "登录二维码" }] },
        } as Adapter.VerificationRequest);
    });
    bot.on("auth", (event: ICQQAuthEvent) => {
        clearStatusCards();
        context.logger.warn("ICQQ 需要身份验证", event);
        const blocks: Adapter.VerificationBlock[] = [];
        if (event.url) blocks.push({ type: "link", url: event.url, label: event.url });
        blocks.push({ type: "text", content: "请完成身份验证后继续登录" });
        emit("verification:request", {
            platform: "icqq",
            account_id: accountId,
            type: "auth",
            hint: "ICQQ 要求完成身份验证后才能继续登录",
            confirmable: true,
            confirmLabel: "已完成，继续登录",
            options: { blocks },
        } as Adapter.VerificationRequest);
    });
    bot.on("slider", (event: ICQQSliderEvent) => {
        clearStatusCards();
        context.logger.info(`ICQQ 需要滑块验证: ${event.url}`);
        emit("slider", { account_id: accountId, url: event.url });
        emit("verification:request", sliderRequest(accountId, event.url));
    });
    bot.on("device", (event: ICQQDeviceEvent) => {
        clearStatusCards();
        context.logger.info(`ICQQ 需要设备锁验证: ${event.url}`);
        emit("device", { account_id: accountId, url: event.url, phone: event.phone });
        emit("verification:request", deviceRequest(accountId, event));
        if (event.phone) emit("verification:request", smsRequest(accountId));
    });
    bot.on("login_error", (event: ICQQLoginErrorEvent) => {
        clearVerification("offline");
        const message = event.message || "登录失败";
        context.logger.error("ICQQ 登录失败", event);
        account.status = AccountStatus.OffLine;
        emit("verification:request", reloginRequest(accountId, "login_error", message, event.code));
    });

    wireProjectedEvents(account, context, projection);
    account.on("start", async () => {
        try {
            await bot.start();
        } catch (error) {
            context.logger.error("启动 ICQQ Bot 失败", error);
            account.status = AccountStatus.OffLine;
        }
    });
    account.on("stop", async () => {
        await bot.stop();
        account.status = AccountStatus.OffLine;
    });
}

function wireProjectedEvents(
    account: Account<"icqq", ICQQBot>,
    context: ICQQAccountEventContext,
    projection: () => ICQQProjectionContext,
): void {
    const bot = account.client;
    const onMessage = (event: ICQQPrivateMessageEvent | ICQQGroupMessageEvent) => {
        logInboundMessage(context.logger, event);
        account.dispatch(projectICQQMessage(event, projection()));
    };
    bot.on("private_message", onMessage);
    bot.on("group_message", onMessage);
    bot.on("friend_request", (event: ICQQFriendRequestEvent) => {
        account.dispatch(projectICQQRequest(event, projection()));
    });
    bot.on("group_request", (event: ICQQGroupRequestEvent) => {
        account.dispatch(projectICQQRequest(event, projection()));
    });
    const onMembership = (event: ICQQGroupIncreaseEvent | ICQQGroupDecreaseEvent) => {
        account.dispatch(projectICQQMembership(event, projection()));
    };
    bot.on("group_increase", onMembership);
    bot.on("group_decrease", onMembership);
    bot.on("group_mute", (event: ICQQGroupMuteEvent) => {
        account.dispatch(projectICQQMute(event, projection()));
    });
    bot.on("group_admin", (event: ICQQGroupAdminEvent) => {
        account.dispatch(projectICQQAdmin(event, projection()));
    });
    const onRecall = (event: ICQQFriendRecallEvent | ICQQGroupRecallEvent) => {
        account.dispatch(projectICQQRecall(event, projection()));
    };
    bot.on("friend_recall", onRecall);
    bot.on("group_recall", onRecall);
    bot.on("poke", (event: ICQQPokeEvent) => {
        account.dispatch(projectICQQPoke(event, projection()));
    });
}

function reloginRequest(
    accountId: string,
    type: "offline" | "login_error",
    message: string,
    code?: number,
): Adapter.VerificationRequest {
    return {
        platform: "icqq",
        account_id: accountId,
        type,
        hint: message,
        options: {
            blocks: [
                { type: "text", content: message },
                ...(code == null ? [] : [{ type: "text" as const, content: `错误码：${code}` }]),
            ],
        },
        actions: [{ id: "relogin", label: "重新登录", variant: "primary" }],
        ...(code == null ? {} : { data: { code, message } }),
    } as Adapter.VerificationRequest;
}

function sliderRequest(accountId: string, url: string): Adapter.VerificationRequest {
    return {
        platform: "icqq",
        account_id: accountId,
        type: "slider",
        hint: "完成滑块验证后，将 ticket 与 randstr 用英文逗号拼接后提交",
        options: {
            blocks: [
                { type: "link", url, label: "打开滑块验证页面" },
                { type: "text", content: "格式：ticket值,randstr值" },
                { type: "input", key: "ticket", placeholder: "ticket,randstr" },
            ],
        },
    } as Adapter.VerificationRequest;
}

function deviceRequest(accountId: string, event: ICQQDeviceEvent): Adapter.VerificationRequest {
    const blocks: Adapter.VerificationBlock[] = [
        { type: "link", url: event.url, label: event.url },
    ];
    if (event.phone) blocks.push({ type: "text", content: `手机号：${event.phone}` });
    return {
        platform: "icqq",
        account_id: accountId,
        type: "device",
        hint: "请完成设备锁验证后继续登录",
        confirmable: true,
        confirmLabel: "已完成，继续登录",
        options: { blocks },
    } as Adapter.VerificationRequest;
}

function smsRequest(accountId: string): Adapter.VerificationRequest {
    return {
        platform: "icqq",
        account_id: accountId,
        type: "sms",
        hint: "先发送短信验证码，收到后提交 6 位验证码",
        requestSmsAvailable: true,
        options: {
            blocks: [{ type: "input", key: "code", placeholder: "6 位短信验证码", maxLength: 6 }],
        },
    } as Adapter.VerificationRequest;
}

function logInboundMessage(
    logger: LoggerLike,
    event: ICQQPrivateMessageEvent | ICQQGroupMessageEvent,
): void {
    const preview =
        event.raw_message.length > 100
            ? `${event.raw_message.slice(0, 100)}...`
            : event.raw_message;
    const group = "group_id" in event ? `群=${event.group.group_name} (${event.group_id}) | ` : "";
    logger.info(
        `[ICQQ] 收到消息 | id=${event.message_id} | ${group}发送者=${event.sender.nickname} (${event.user_id}) | ${preview}`,
    );
}
