import type { PlatformActionHandler } from "onebots";
import type { TelegramBot } from "./bot.js";
import {
    requireBoolean,
    requireObjectArray,
    requireString,
    telegramAction,
} from "./platform-action-params.js";

type Handler = PlatformActionHandler<TelegramBot>;

/** Callback、Inline、配送与支付确认应答。 */
export const TELEGRAM_INTERACTION_ACTIONS = {
    answer_callback_query: telegramAction("answerCallbackQuery", (api, params) =>
        api.answerCallbackQuery(
            requireString(params, "callback_query_id"),
            params.options as never,
        ),
    ),
    answer_inline_query: telegramAction("answerInlineQuery", (api, params) =>
        api.answerInlineQuery(
            requireString(params, "inline_query_id"),
            requireObjectArray(params, "results", 0, 50) as never,
            params.options as never,
        ),
    ),
    answer_shipping_query: telegramAction("answerShippingQuery", (api, params) =>
        api.answerShippingQuery(
            requireString(params, "shipping_query_id"),
            requireBoolean(params, "ok"),
            params.options as never,
        ),
    ),
    answer_pre_checkout_query: telegramAction("answerPreCheckoutQuery", (api, params) =>
        api.answerPreCheckoutQuery(
            requireString(params, "pre_checkout_query_id"),
            requireBoolean(params, "ok"),
            params.options as never,
        ),
    ),
} satisfies Readonly<Record<string, Handler>>;
