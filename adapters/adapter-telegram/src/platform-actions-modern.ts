import type { PlatformActionHandler } from "onebots";
import type { TelegramBot } from "./bot.js";
import {
    optionalObject,
    requireHttpsUrl,
    requireInteger,
    requireObject,
    requireString,
    requireStringEnum,
    requireStringOrNumber,
    telegramAction,
} from "./platform-action-params.js";

type Handler = PlatformActionHandler<TelegramBot>;

/** Bot API 10.1-10.3 的 Rich、Ephemeral 与 Join Request Query 动作。 */
export const TELEGRAM_MODERN_ACTIONS = {
    send_rich_message: telegramAction("sendRichMessage", (api, params) =>
        api.sendRichMessage(
            requireStringOrNumber(params, "chat_id"),
            requireObject(params, "rich_message") as never,
            optionalObject(params.options, "options") as never,
        ),
    ),
    send_rich_message_draft: telegramAction("sendRichMessageDraft", (api, params) =>
        api.sendRichMessageDraft(
            requireInteger(params, "chat_id"),
            requireInteger(params, "draft_id"),
            requireObject(params, "rich_message") as never,
            optionalObject(params.options, "options") as never,
        ),
    ),
    answer_chat_join_request_query: telegramAction("answerChatJoinRequestQuery", (api, params) =>
        api.answerChatJoinRequestQuery(
            requireString(params, "chat_join_request_query_id"),
            requireStringEnum(params, "result", ["approve", "decline", "queue"]),
        ),
    ),
    send_chat_join_request_web_app: telegramAction("sendChatJoinRequestWebApp", (api, params) =>
        api.sendChatJoinRequestWebApp(
            requireString(params, "chat_join_request_query_id"),
            requireHttpsUrl(params, "web_app_url"),
        ),
    ),
    edit_ephemeral_message_text: telegramAction("editEphemeralMessageText", (api, params) =>
        api.editEphemeralMessageText(
            requireStringOrNumber(params, "chat_id"),
            requireInteger(params, "receiver_user_id"),
            requireInteger(params, "ephemeral_message_id"),
            requireTextOrRichMessage(params) as never,
            optionalObject(params.options, "options") as never,
        ),
    ),
    edit_ephemeral_message_media: telegramAction("editEphemeralMessageMedia", (api, params) =>
        api.editEphemeralMessageMedia(
            requireStringOrNumber(params, "chat_id"),
            requireInteger(params, "receiver_user_id"),
            requireInteger(params, "ephemeral_message_id"),
            requireObject(params, "media") as never,
            optionalObject(params.options, "options") as never,
        ),
    ),
    edit_ephemeral_message_caption: telegramAction("editEphemeralMessageCaption", (api, params) =>
        api.editEphemeralMessageCaption(
            requireStringOrNumber(params, "chat_id"),
            requireInteger(params, "receiver_user_id"),
            requireInteger(params, "ephemeral_message_id"),
            requireString(params, "caption", true),
            optionalObject(params.options, "options") as never,
        ),
    ),
    edit_ephemeral_message_reply_markup: telegramAction(
        "editEphemeralMessageReplyMarkup",
        (api, params) =>
            api.editEphemeralMessageReplyMarkup(
                requireStringOrNumber(params, "chat_id"),
                requireInteger(params, "receiver_user_id"),
                requireInteger(params, "ephemeral_message_id"),
                optionalObject(params.options, "options") as never,
            ),
    ),
    delete_ephemeral_message: telegramAction("deleteEphemeralMessage", (api, params) =>
        api.deleteEphemeralMessage(
            requireStringOrNumber(params, "chat_id"),
            requireInteger(params, "receiver_user_id"),
            requireInteger(params, "ephemeral_message_id"),
        ),
    ),
} satisfies Readonly<Record<string, Handler>>;

function requireTextOrRichMessage(
    params: Readonly<Record<string, unknown>>,
): string | Readonly<Record<string, unknown>> {
    if (typeof params.text === "string") return params.text;
    return requireObject(params, "rich_message");
}
