import type { PlatformActionHandler } from "onebots";
import { exactParams, requireInteger, requireStringArray } from "./action-params.js";
import type { ZulipClient } from "./client.js";
import { ZulipError } from "./errors.js";
import type { ZulipParams } from "./types.js";

/** 仅 Bot 所有者或组织管理员可读取或轮换的凭证动作。 */
export const ZULIP_BOT_CREDENTIAL_ACTIONS: ReadonlySet<string> = new Set([
    "get_bot_api_key",
    "regenerate_bot_api_key",
]);

/** Zulip 12 Bot 凭证与持久存储动作。 */
export const ZULIP_BOT_ACTION_HANDLERS = {
    get_bot_api_key: (client, params) => botApiKeyAction(client, params, false),
    regenerate_bot_api_key: (client, params) => botApiKeyAction(client, params, true),
    get_bot_storage: (client, params) => client.call("bot_storage", "GET", storageKeys(params)),
    update_bot_storage: (client, params) =>
        client.call("bot_storage", "PUT", storageUpdate(params)),
    remove_bot_storage: (client, params) =>
        client.call("bot_storage", "DELETE", storageKeys(params)),
} satisfies Readonly<Record<string, PlatformActionHandler<ZulipClient>>>;

function botApiKeyAction(
    client: ZulipClient,
    params: Readonly<Record<string, unknown>>,
    regenerate: boolean,
): Promise<unknown> {
    const botId = requireInteger(params.bot_id, "bot_id");
    const body = { ...params };
    delete body.bot_id;
    exactParams(body, []);
    const suffix = regenerate ? "/regenerate" : "";
    return client.call(`bots/${botId}/api_key${suffix}`, regenerate ? "POST" : "GET");
}

function storageKeys(params: Readonly<Record<string, unknown>>): ZulipParams {
    const result = exactParams(params, ["keys"]);
    if (result.keys !== undefined) requireStringArray(result.keys, "keys");
    return result;
}

function storageUpdate(params: Readonly<Record<string, unknown>>): ZulipParams {
    const result = exactParams(params, ["storage"], ["storage"]);
    if (!isRecord(result.storage)) invalid("Zulip 参数 storage 必须是字符串字典");
    for (const [key, value] of Object.entries(result.storage)) {
        if (!key || typeof value !== "string") {
            invalid("Zulip 参数 storage 必须是字符串字典");
        }
    }
    return result;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string): never {
    throw new ZulipError(message, { code: "ZULIP_INVALID_ACTION_PARAM" });
}
