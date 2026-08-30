import type { Bot } from "grammy";
import type { PlatformActionHandler } from "onebots";
import type { TelegramBot } from "./bot.js";
import {
    requireInteger,
    requireObject,
    requireString,
    requireStringOrNumber,
    telegramAction,
} from "./platform-action-params.js";

type Handler = PlatformActionHandler<TelegramBot>;
type Api = Bot["api"];
type Params = Readonly<Record<string, unknown>>;

/** Telegram 群聊、邀请链接与论坛话题动作。 */
export const TELEGRAM_CHAT_ACTIONS = {
    create_chat_invite_link: telegramAction("createChatInviteLink", (api, params) =>
        api.createChatInviteLink(requireChatId(params), params.options as never),
    ),
    revoke_chat_invite_link: telegramAction("revokeChatInviteLink", (api, params) =>
        api.revokeChatInviteLink(requireChatId(params), requireString(params, "invite_link")),
    ),
    set_chat_description: telegramAction("setChatDescription", (api, params) =>
        api.setChatDescription(requireChatId(params), requireString(params, "description", true)),
    ),
    set_chat_permissions: telegramAction("setChatPermissions", (api, params) =>
        api.setChatPermissions(
            requireChatId(params),
            requireObject(params, "permissions") as never,
            params.options as never,
        ),
    ),
    get_chat_administrators: telegramAction("getChatAdministrators", (api, params) =>
        api.getChatAdministrators(requireChatId(params)),
    ),
    get_chat_member_count: telegramAction("getChatMemberCount", (api, params) =>
        api.getChatMemberCount(requireChatId(params)),
    ),
    create_forum_topic: telegramAction("createForumTopic", (api, params) =>
        api.createForumTopic(
            requireChatId(params),
            requireString(params, "name"),
            params.options as never,
        ),
    ),
    edit_forum_topic: telegramAction("editForumTopic", (api, params) =>
        api.editForumTopic(requireChatId(params), requireThreadId(params), params.options as never),
    ),
    close_forum_topic: topicAction("closeForumTopic", (api, chatId, threadId) =>
        api.closeForumTopic(chatId, threadId),
    ),
    reopen_forum_topic: topicAction("reopenForumTopic", (api, chatId, threadId) =>
        api.reopenForumTopic(chatId, threadId),
    ),
    delete_forum_topic: topicAction("deleteForumTopic", (api, chatId, threadId) =>
        api.deleteForumTopic(chatId, threadId),
    ),
    unpin_forum_topic_messages: topicAction("unpinAllForumTopicMessages", (api, chatId, threadId) =>
        api.unpinAllForumTopicMessages(chatId, threadId),
    ),
    get_forum_topic_icon_stickers: telegramAction("getForumTopicIconStickers", api =>
        api.getForumTopicIconStickers(),
    ),
} satisfies Readonly<Record<string, Handler>>;

function topicAction(
    method: string,
    task: (api: Api, chatId: string | number, threadId: number) => Promise<unknown>,
): Handler {
    return telegramAction(method, (api, params) =>
        task(api, requireChatId(params), requireThreadId(params)),
    );
}

function requireChatId(params: Params): string | number {
    return requireStringOrNumber(params, "chat_id");
}

function requireThreadId(params: Params): number {
    return requireInteger(params, "message_thread_id");
}
