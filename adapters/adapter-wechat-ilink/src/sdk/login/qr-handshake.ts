import { ILINK_CDN_ROOT_DEFAULT, ILINK_QR_BOT_CLASS_DEFAULT } from "../internal/config.js";
import { delay } from "../internal/async-tools.js";
import { GatewayFault } from "../internal/errors.js";
import { nextScopedOpId } from "../internal/random-tags.js";
import type { IlinkJsonTransport } from "../transport/ilink-json-transport.js";
import type { CredentialBlob, LoginOutcome, LoginTicket, WaitForLoginOptions } from "../protocol/chat-event.js";

const QR_REFRESH_LIMIT = 3;

type MutableTicket = LoginTicket & { qrcode: string; qrCodeUrl: string };

const ledger = new Map<string, MutableTicket>();

export async function allocateLoginTicket(
    transport: IlinkJsonTransport,
    options?: { botType?: string; signal?: AbortSignal },
): Promise<LoginTicket> {
    const category = options?.botType ?? ILINK_QR_BOT_CLASS_DEFAULT;
    const bitmap = await transport.openLoginBitmap({ botType: category, signal: options?.signal });
    const ticket: MutableTicket = {
        sessionKey: nextScopedOpId("wxil-login"),
        qrcode: bitmap.qrcode,
        qrCodeUrl: bitmap.qrcode_img_content,
        baseUrl: transport.baseUrl,
        botType: category,
    };
    ledger.set(ticket.sessionKey, ticket);
    return ticket;
}

export async function awaitLoginTicketResolution(
    transport: IlinkJsonTransport,
    sessionKey: string,
    options: WaitForLoginOptions = {},
): Promise<LoginOutcome> {
    const ticket = ledger.get(sessionKey);
    if (!ticket) {
        throw new GatewayFault("LOGIN_SESSION_NOT_FOUND", `未知登录句柄: ${sessionKey}`);
    }

    const limitMs = Math.max(options.timeoutMs ?? 480_000, 1_000);
    const until = Date.now() + limitMs;
    let refreshUsed = 0;

    while (Date.now() < until) {
        if (options.signal?.aborted) {
            throw options.signal.reason instanceof Error ? options.signal.reason : new Error("aborted");
        }

        const phase = await transport.probeLoginPhase({
            qrcode: ticket.qrcode,
            budgetMs: 35_000,
            signal: options.signal,
        });

        if (phase.status === "confirmed") {
            if (!phase.bot_token || !phase.ilink_bot_id) {
                return { connected: false, message: "登录已确认但上游未返回 token 或 bot id。" };
            }
            const session: CredentialBlob = {
                token: phase.bot_token,
                accountId: phase.ilink_bot_id,
                userId: phase.ilink_user_id,
                baseUrl: phase.baseurl?.trim() || ticket.baseUrl || transport.baseUrl,
                cdnBaseUrl: transport.cdnBaseUrl || ILINK_CDN_ROOT_DEFAULT,
                routeTag: transport.routeTag,
                syncBuffer: "",
                contextTokens: {},
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            ledger.delete(sessionKey);
            return { connected: true, message: "登录成功", session };
        }

        if (phase.status === "expired") {
            if (options.refreshExpiredQr === false) {
                ledger.delete(sessionKey);
                return { connected: false, message: "二维码已过期" };
            }
            refreshUsed += 1;
            if (refreshUsed > QR_REFRESH_LIMIT) {
                ledger.delete(sessionKey);
                return { connected: false, message: "二维码过期次数过多" };
            }
            const next = await transport.openLoginBitmap({ botType: ticket.botType, signal: options.signal });
            ticket.qrcode = next.qrcode;
            ticket.qrCodeUrl = next.qrcode_img_content;
        }

        await delay(1_000, options.signal);
    }

    ledger.delete(sessionKey);
    return { connected: false, message: "登录超时" };
}
