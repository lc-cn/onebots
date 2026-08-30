import type { PlatformActionHandler } from "onebots";
import type { DingTalkBot } from "./bot.js";
import { DingTalkError } from "./errors.js";
import type { DingTalkApiRequestOptions } from "./types.js";

type Handler = PlatformActionHandler<DingTalkBot>;

/** 钉钉互动卡片实例与 AI 流式更新的稳定开放平台入口。 */
export const DINGTALK_CARD_ACTIONS = {
    create_card_instance: cardAction("/v1.0/card/instances", "POST", [
        "cardTemplateId",
        "outTrackId",
    ]),
    deliver_card_instance: cardAction("/v1.0/card/instances/deliver", "POST", ["outTrackId"]),
    create_and_deliver_card: cardAction("/v1.0/card/instances/createAndDeliver", "POST", [
        "cardTemplateId",
        "outTrackId",
    ]),
    update_card_instance: cardAction("/v1.0/card/instances", "PUT", ["outTrackId"]),
    stream_card_instance: (bot, params) => {
        for (const field of ["outTrackId", "guid", "key"]) requireString(params, field);
        requireString(params, "content", true);
        for (const field of ["isFull", "isFinalize", "isError"]) requireBoolean(params, field);
        return bot.callApi("/v1.0/card/streaming", {
            method: "PUT",
            body: { ...params },
        });
    },
} satisfies Readonly<Record<string, Handler>>;

export const DINGTALK_CARD_ACTION_NAMES: ReadonlySet<string> = new Set(
    Object.keys(DINGTALK_CARD_ACTIONS),
);

function cardAction(
    path: string,
    method: DingTalkApiRequestOptions["method"],
    requiredFields: readonly string[],
): Handler {
    return (bot, params) => {
        for (const field of requiredFields) requireString(params, field);
        return bot.callApi(path, { method, body: { ...params } });
    };
}

function requireString(
    params: Readonly<Record<string, unknown>>,
    name: string,
    allowEmpty = false,
): string {
    const value = params[name];
    if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
        throw DingTalkError.invalid(
            `钉钉卡片参数 ${name} 必须为${allowEmpty ? "字符串" : "非空字符串"}`,
            "DINGTALK_CARD_PARAM_INVALID",
            { name },
        );
    }
    return value;
}

function requireBoolean(params: Readonly<Record<string, unknown>>, name: string): boolean {
    const value = params[name];
    if (typeof value !== "boolean") {
        throw DingTalkError.invalid(
            `钉钉卡片参数 ${name} 必须为布尔值`,
            "DINGTALK_CARD_PARAM_INVALID",
            { name },
        );
    }
    return value;
}
