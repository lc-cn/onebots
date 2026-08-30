import type { PlatformActionHandler } from "onebots";
import type { TelegramBot } from "./bot.js";
import { TelegramError } from "./errors.js";
import { resolveTelegramInputFile } from "./message-sender.js";
import {
    optionalObject,
    optionalIntegerArray,
    requireBoolean,
    requireHttpsUrl,
    requireInteger,
    requireIntegerRange,
    requireObject,
    requireSignedInteger,
    requireString,
    requireStringEnum,
    requireStringOrNumber,
    telegramAction,
} from "./platform-action-params.js";

type Handler = PlatformActionHandler<TelegramBot>;

/** Bot API 10.0-10.3 的管理、Rich、Ephemeral 与 Join Request Query 动作。 */
export const TELEGRAM_MODERN_ACTIONS = {
    send_live_photo: telegramAction("sendLivePhoto", async (api, params) =>
        api.sendLivePhoto(
            requireStringOrNumber(params, "chat_id"),
            await resolveTelegramInputFile(
                { file: params.live_photo, filename: params.live_photo_filename },
                { allowRemoteUrl: false },
            ),
            await resolveTelegramInputFile(
                { file: params.photo, filename: params.photo_filename },
                { allowRemoteUrl: false },
            ),
            optionalObject(params.options, "options") as never,
        ),
    ),
    delete_message_reaction: telegramAction("deleteMessageReaction", (api, params) => {
        const actor = requireReactionActor(params);
        return actor.type === "user"
            ? api.deleteMessageReactionUser(
                  requireStringOrNumber(params, "chat_id"),
                  requireInteger(params, "message_id"),
                  actor.id,
              )
            : api.deleteMessageReactionChat(
                  requireStringOrNumber(params, "chat_id"),
                  requireInteger(params, "message_id"),
                  actor.id,
              );
    }),
    delete_all_message_reactions: telegramAction("deleteAllMessageReactions", (api, params) => {
        const actor = requireReactionActor(params);
        return actor.type === "user"
            ? api.deleteAllMessageReactionsUser(requireStringOrNumber(params, "chat_id"), actor.id)
            : api.deleteAllMessageReactionsChat(requireStringOrNumber(params, "chat_id"), actor.id);
    }),
    get_managed_bot_access_settings: telegramAction("getManagedBotAccessSettings", (api, params) =>
        api.getManagedBotAccessSettings(requireInteger(params, "user_id")),
    ),
    set_managed_bot_access_settings: telegramAction(
        "setManagedBotAccessSettings",
        (api, params) => {
            const addedUserIds = optionalIntegerArray(params, "added_user_ids", 10);
            return api.setManagedBotAccessSettings(
                requireInteger(params, "user_id"),
                requireBoolean(params, "is_access_restricted"),
                addedUserIds ? { added_user_ids: addedUserIds } : undefined,
            );
        },
    ),
    get_user_personal_chat_messages: telegramAction("getUserPersonalChatMessages", (api, params) =>
        api.getUserPersonalChatMessages(
            requireInteger(params, "user_id"),
            requireIntegerRange(params, "limit", 1, 20),
        ),
    ),
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

function requireReactionActor(params: Readonly<Record<string, unknown>>): {
    type: "user" | "chat";
    id: number;
} {
    const hasUser = params.user_id != null;
    const hasChat = params.actor_chat_id != null;
    if (hasUser === hasChat) {
        throw TelegramError.invalid(
            "Telegram Reaction 管理必须且只能提供 user_id 或 actor_chat_id",
            "TELEGRAM_PARAM_INVALID",
            { names: ["user_id", "actor_chat_id"] },
        );
    }
    return hasUser
        ? { type: "user", id: requireInteger(params, "user_id") }
        : { type: "chat", id: requireSignedInteger(params, "actor_chat_id") };
}

function requireTextOrRichMessage(
    params: Readonly<Record<string, unknown>>,
): string | Readonly<Record<string, unknown>> {
    if (typeof params.text === "string") return params.text;
    return requireObject(params, "rich_message");
}
