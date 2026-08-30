import type { PlatformActionHandler } from "onebots";
import {
    assertHasAny,
    exactParams,
    requireInteger,
    requireString,
    requireStringArray,
    requireText,
} from "./action-params.js";
import type { ZulipClient } from "./client.js";
import { ZulipError } from "./errors.js";
import type { ZulipParams } from "./types.js";

const STATUS_FIELDS = ["status_text", "emoji_name", "emoji_code", "reaction_type"] as const;
const REACTION_TYPES = new Set(["unicode_emoji", "realm_emoji", "zulip_extra_emoji"]);

/** 需要组织管理员权限的个人偏好领域动作。 */
export const ZULIP_PREFERENCE_PERMISSION_ACTIONS: ReadonlySet<string> = new Set([
    "update_status_for_user",
]);

export const ZULIP_PREFERENCE_ACTION_HANDLERS = {
    mute_user: (client, params) => mutedUserAction(client, params, "POST"),
    unmute_user: (client, params) => mutedUserAction(client, params, "DELETE"),
    get_alert_words: (client, params) => {
        exactParams(params, []);
        return client.call("users/me/alert_words");
    },
    add_alert_words: (client, params) => alertWordsAction(client, params, "POST"),
    remove_alert_words: (client, params) => alertWordsAction(client, params, "DELETE"),
    get_user_status: (client, params) => {
        const userId = requirePathId(params, "user_id");
        return client.call(`users/${userId}/status`);
    },
    update_user_status: (client, params) =>
        client.call("users/me/status", "POST", statusParams(params)),
    update_status_for_user: (client, params) => {
        const userId = requireInteger(params.user_id, "user_id");
        const body = { ...params };
        delete body.user_id;
        return client.call(`users/${userId}/status`, "POST", statusParams(body));
    },
} satisfies Readonly<Record<string, PlatformActionHandler<ZulipClient>>>;

function mutedUserAction(
    client: ZulipClient,
    params: Readonly<Record<string, unknown>>,
    method: "POST" | "DELETE",
): Promise<unknown> {
    const userId = requirePathId(params, "user_id");
    return client.call(`users/me/muted_users/${userId}`, method);
}

function alertWordsAction(
    client: ZulipClient,
    params: Readonly<Record<string, unknown>>,
    method: "POST" | "DELETE",
): Promise<unknown> {
    const result = exactParams(params, ["alert_words"], ["alert_words"]);
    const words = requireStringArray(result.alert_words, "alert_words");
    if (!words.length) invalid("Zulip 参数 alert_words 不能为空");
    if (words.some(word => [...word].length > 100)) {
        invalid("Zulip 参数 alert_words 的单项不能超过 100 个字符");
    }
    return client.call("users/me/alert_words", method, result);
}

function statusParams(params: Readonly<Record<string, unknown>>): ZulipParams {
    const result = exactParams(params, STATUS_FIELDS);
    assertHasAny(result, STATUS_FIELDS);
    if (result.status_text !== undefined) {
        const text = requireText(result.status_text, "status_text");
        if ([...text].length > 60) invalid("Zulip 参数 status_text 不能超过 60 个字符");
    }
    if (result.emoji_name !== undefined) requireString(result.emoji_name, "emoji_name");
    if (result.emoji_code !== undefined) requireString(result.emoji_code, "emoji_code");
    if (result.reaction_type !== undefined) {
        const type = requireString(result.reaction_type, "reaction_type");
        if (!REACTION_TYPES.has(type)) invalid("Zulip 参数 reaction_type 不是有效的 Emoji 类型");
    }
    return result;
}

function requirePathId(params: Readonly<Record<string, unknown>>, field: string): number {
    const id = requireInteger(params[field], field);
    const body = { ...params };
    delete body[field];
    exactParams(body, []);
    return id;
}

function invalid(message: string): never {
    throw new ZulipError(message, { code: "ZULIP_INVALID_ACTION_PARAM" });
}
