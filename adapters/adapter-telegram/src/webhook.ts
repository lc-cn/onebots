import { ErrorCategory } from "onebots";
import type { TelegramBot } from "./bot.js";
import { TelegramError } from "./errors.js";

export interface TelegramHttpResult {
    status: number;
    body: { ok: boolean; error?: string; message?: string };
}

/** 已解析 Host 与标准 Request 共用的 Telegram Webhook 入站边界。 */
export async function ingestTelegramHttp(
    bot: TelegramBot,
    rawEvent: unknown,
    secretToken?: string,
): Promise<TelegramHttpResult> {
    if (!bot.verifyWebhookSecret(secretToken)) {
        return { status: 401, body: { ok: false, error: "TELEGRAM_WEBHOOK_UNAUTHORIZED" } };
    }
    try {
        await bot.ingest(rawEvent);
        return { status: 200, body: { ok: true } };
    } catch (error) {
        const wrapped = TelegramError.wrap(error, "TELEGRAM_WEBHOOK_ERROR", "webhook");
        return {
            status: wrapped.category === ErrorCategory.VALIDATION ? 400 : 500,
            body: { ok: false, error: wrapped.code, message: wrapped.message },
        };
    }
}

/** Fetch / WinterCG Host 可直接转交标准 Request。 */
export async function acceptTelegramHttp(bot: TelegramBot, request: Request): Promise<Response> {
    if (request.method !== "POST") {
        return Response.json(
            { ok: false, error: "TELEGRAM_METHOD_NOT_ALLOWED" },
            { status: 405, headers: { Allow: "POST" } },
        );
    }
    let rawEvent: unknown;
    try {
        rawEvent = (await request.json()) as unknown;
    } catch (error) {
        const wrapped = TelegramError.wrap(error, "TELEGRAM_WEBHOOK_INVALID_JSON", "webhook");
        return Response.json(
            { ok: false, error: wrapped.code, message: "Telegram Webhook 请求体不是有效 JSON" },
            { status: 400 },
        );
    }
    const result = await ingestTelegramHttp(
        bot,
        rawEvent,
        request.headers.get("x-telegram-bot-api-secret-token") || undefined,
    );
    return Response.json(result.body, { status: result.status });
}
