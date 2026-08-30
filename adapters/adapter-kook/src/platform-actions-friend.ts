import type { PlatformActionHandler } from "onebots";
import type { KookBot } from "./bot.js";
import { KookError } from "./errors.js";

type Handler = PlatformActionHandler<KookBot>;

/** 不属于统一 Adapter 好友动作的 KOOK 原生好友能力。 */
export const KOOK_FRIEND_PLATFORM_ACTIONS = {
    send_friend_request: (bot, params) => {
        const from = Number(params.from ?? 0);
        if (from !== 0 && from !== 2) {
            throw KookError.invalid(
                "KOOK 好友申请 from 只允许 0（搜索）或 2（服务器）",
                "KOOK_FRIEND_REQUEST_SOURCE_INVALID",
            );
        }
        const guildId = optionalString(params.guild_id);
        if (from === 2 && !guildId) {
            throw KookError.invalid(
                "KOOK 从服务器添加好友必须提供 guild_id",
                "KOOK_FRIEND_REQUEST_GUILD_REQUIRED",
            );
        }
        return bot.callApi("/v3/friend/request", {
            method: "POST",
            body: {
                user_code: requiredString(params.user_code, "user_code"),
                from,
                guild_id: guildId,
            },
        });
    },
    list_blocked_users: bot => bot.callApi("/v3/friend", { query: { type: "block" } }),
    block_user: (bot, params) => userAction(bot, "/v3/friend/block", params),
    unblock_user: (bot, params) => userAction(bot, "/v3/friend/unblock", params),
} satisfies Readonly<Record<string, Handler>>;

function userAction(
    bot: KookBot,
    path: "/v3/friend/block" | "/v3/friend/unblock",
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    return bot.callApi(path, {
        method: "POST",
        body: { user_id: requiredString(params.user_id, "user_id") },
    });
}

function requiredString(value: unknown, key: string): string {
    const result = optionalString(value);
    if (result) return result;
    throw KookError.invalid(`KOOK 参数 ${key} 不能为空`, "KOOK_ACTION_PARAM_REQUIRED", { key });
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
