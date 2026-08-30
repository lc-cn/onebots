import type { PlatformActionHandler } from "onebots";
import type { FeishuBot } from "./bot.js";
import {
    enumString,
    jsonObjectString,
    jsonRecordArrayString,
    optionalStringParam,
    receiveIdType,
    requiredSequence,
    requiredString,
    segment,
    type FeishuActionParams,
} from "./platform-action-input.js";

export type FeishuCardSourceType = "card_json" | "template";
export type FeishuCardElementInsertType = "insert_before" | "insert_after" | "append";

/** CardKit v1 卡片实体、组件与流式文本的闭合动作。 */
export const FEISHU_CARDKIT_ACTIONS = {
    create_card_entity: (bot, params) =>
        bot.callApi("/cardkit/v1/cards", {
            method: "POST",
            body: {
                type: cardSourceType(params.type),
                data: jsonObjectString(params.card, "card"),
            },
        }),
    send_card_entity: (bot, params) =>
        bot.callApi("/im/v1/messages", {
            method: "POST",
            params: {
                receive_id_type: receiveIdType(params.receive_id_type),
                ...optionalStringParam(params.uuid, "uuid"),
            },
            body: {
                receive_id: requiredString(params.receive_id, "receive_id"),
                msg_type: "interactive",
                content: JSON.stringify({
                    type: "card",
                    data: { card_id: requiredString(params.card_id, "card_id") },
                }),
            },
        }),
    update_card_entity: (bot, params) =>
        bot.callApi(`/cardkit/v1/cards/${segment(params, "card_id")}`, {
            method: "PUT",
            body: {
                card: { type: "card_json", data: jsonObjectString(params.card, "card") },
                ...mutationIdentity(params),
            },
        }),
    update_card_settings: (bot, params) =>
        bot.callApi(`/cardkit/v1/cards/${segment(params, "card_id")}/settings`, {
            method: "PATCH",
            body: {
                settings: jsonObjectString(params.settings, "settings"),
                ...mutationIdentity(params),
            },
        }),
    batch_update_card: (bot, params) =>
        bot.callApi(`/cardkit/v1/cards/${segment(params, "card_id")}/batch_update`, {
            method: "POST",
            body: {
                actions: jsonRecordArrayString(params.actions, "actions"),
                ...mutationIdentity(params),
            },
        }),
    create_card_elements: (bot, params) =>
        bot.callApi(`/cardkit/v1/cards/${segment(params, "card_id")}/elements`, {
            method: "POST",
            body: createElementsBody(params),
        }),
    update_card_element: (bot, params) =>
        bot.callApi(cardElementPath(params), {
            method: "PUT",
            body: {
                element: jsonObjectString(params.element, "element"),
                ...mutationIdentity(params),
            },
        }),
    patch_card_element: (bot, params) =>
        bot.callApi(cardElementPath(params), {
            method: "PATCH",
            body: {
                partial_element: jsonObjectString(params.partial_element, "partial_element"),
                ...mutationIdentity(params),
            },
        }),
    stream_card_element_content: (bot, params) =>
        bot.callApi(`${cardElementPath(params)}/content`, {
            method: "PUT",
            body: {
                content: requiredString(params.content, "content"),
                ...mutationIdentity(params),
            },
        }),
    delete_card_element: (bot, params) =>
        bot.callApi(cardElementPath(params), {
            method: "DELETE",
            body: mutationIdentity(params),
        }),
} satisfies Readonly<Record<string, PlatformActionHandler<FeishuBot>>>;

export const FEISHU_CARDKIT_ACTION_NAMES = new Set(Object.keys(FEISHU_CARDKIT_ACTIONS));
export const FEISHU_CARDKIT_SEND_ACTION_NAMES = new Set(["send_card_entity"]);

function mutationIdentity(params: FeishuActionParams): Record<string, string | number> {
    return {
        sequence: requiredSequence(params.sequence),
        ...optionalStringParam(params.uuid, "uuid"),
    };
}

function cardSourceType(value: unknown): FeishuCardSourceType {
    return enumString(value, "type", ["card_json", "template"] as const, "card_json");
}

function createElementsBody(params: FeishuActionParams): Record<string, unknown> {
    const type = enumString(
        params.type,
        "type",
        ["insert_before", "insert_after", "append"] as const,
        "append",
    );
    const target =
        type === "append"
            ? optionalStringParam(params.target_element_id, "target_element_id")
            : { target_element_id: requiredString(params.target_element_id, "target_element_id") };
    return {
        type,
        ...target,
        elements: jsonRecordArrayString(params.elements, "elements"),
        ...mutationIdentity(params),
    };
}

function cardElementPath(params: FeishuActionParams): string {
    return `/cardkit/v1/cards/${segment(params, "card_id")}/elements/${segment(params, "element_id")}`;
}
