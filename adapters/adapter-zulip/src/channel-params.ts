import {
    assertHasAny,
    exactParams,
    requireBoolean,
    requireInteger,
    requireIntegerArray,
    requireString,
    requireStringArray,
    requireText,
} from "./action-params.js";
import { ZulipError } from "./errors.js";
import type { ZulipParams } from "./types.js";

const PERMISSION_FIELDS = [
    "can_add_subscribers_group",
    "can_remove_subscribers_group",
    "can_administer_channel_group",
    "can_delete_any_message_group",
    "can_delete_own_message_group",
    "can_move_messages_out_of_channel_group",
    "can_move_messages_within_channel_group",
    "can_send_message_group",
    "can_subscribe_group",
    "can_resolve_topics_group",
    "can_create_topic_group",
] as const;
const SUBSCRIBE_BOOLEAN_FIELDS = [
    "authorization_errors_fatal",
    "announce",
    "invite_only",
    "is_web_public",
    "is_default_stream",
    "history_public_to_subscribers",
    "default_push_notifications",
    "send_new_subscription_messages",
] as const;
const CREATE_BOOLEAN_FIELDS = [
    "announce",
    "invite_only",
    "is_web_public",
    "is_default_stream",
    "history_public_to_subscribers",
    "default_push_notifications",
] as const;
const UPDATE_BOOLEAN_FIELDS = [
    "is_private",
    "is_web_public",
    "history_public_to_subscribers",
    "is_default_stream",
    "default_push_notifications",
] as const;
const TOPICS_POLICIES = new Set([
    "inherit",
    "allow_empty_topic",
    "disable_empty_topic",
    "empty_topic_only",
]);

/** 校验 Zulip 11+ 独立频道创建端点，不接受订阅端点或历史版本的扩展字段。 */
export function channelCreateParams(params: Readonly<Record<string, unknown>>): ZulipParams {
    const allowed = [
        "name",
        "description",
        "subscribers",
        ...CREATE_BOOLEAN_FIELDS,
        "message_retention_days",
        "topics_policy",
        "folder_id",
        ...PERMISSION_FIELDS,
    ];
    const input = exactParams(params, allowed, ["name", "subscribers"]);
    requireString(input.name, "name");
    if (input.description !== undefined) requireText(input.description, "description");
    requireIntegerArray(input.subscribers, "subscribers");
    validateBooleans(input, CREATE_BOOLEAN_FIELDS);
    validateCommonChannelSettings(input, false);
    return input;
}

/** 校验 Zulip 10+ 频道订阅请求；刻意不接受已移除的频道发布策略字段。 */
export function channelSubscribeParams(params: Readonly<Record<string, unknown>>): ZulipParams {
    const allowed = [
        "subscriptions",
        "principals",
        ...SUBSCRIBE_BOOLEAN_FIELDS,
        "message_retention_days",
        "topics_policy",
        "folder_id",
        ...PERMISSION_FIELDS,
    ];
    const input = exactParams(params, allowed, ["subscriptions"]);
    validateChannelDescriptors(input.subscriptions, "subscriptions", false);
    validatePrincipals(input.principals);
    validateBooleans(input, SUBSCRIBE_BOOLEAN_FIELDS);
    validateCommonChannelSettings(input, false);
    return input;
}

export function channelUnsubscribeParams(params: Readonly<Record<string, unknown>>): ZulipParams {
    const input = exactParams(params, ["subscriptions", "principals"], ["subscriptions"]);
    requireStringArray(input.subscriptions, "subscriptions");
    validatePrincipals(input.principals);
    return input;
}

export function channelSubscriptionsUpdateParams(
    params: Readonly<Record<string, unknown>>,
): ZulipParams {
    const input = exactParams(params, ["delete", "add"]);
    assertHasAny(input, ["delete", "add"]);
    if (input.delete !== undefined) requireStringArray(input.delete, "delete");
    if (input.add !== undefined) validateChannelDescriptors(input.add, "add", true);
    return input;
}

export function channelUpdateParams(params: Readonly<Record<string, unknown>>): ZulipParams {
    const allowed = [
        "description",
        "new_name",
        ...UPDATE_BOOLEAN_FIELDS,
        "message_retention_days",
        "is_archived",
        "folder_id",
        "topics_policy",
        ...PERMISSION_FIELDS,
    ];
    const input = exactParams(params, allowed);
    assertHasAny(input, allowed);
    if (input.description !== undefined) requireText(input.description, "description");
    if (input.new_name !== undefined) requireString(input.new_name, "new_name");
    validateBooleans(input, UPDATE_BOOLEAN_FIELDS);
    if (input.is_archived !== undefined && input.is_archived !== false) {
        invalid("Zulip 参数 is_archived 只能为 false；归档频道请使用 archive_channel");
    }
    validateCommonChannelSettings(input, true);
    return input;
}

function validateChannelDescriptors(value: unknown, name: string, allowColor: boolean): void {
    if (!Array.isArray(value) || !value.length) invalid(`Zulip 参数 ${name} 必须是非空数组`);
    for (const [index, item] of value.entries()) {
        if (!isRecord(item)) invalid(`Zulip 参数 ${name}[${index}] 必须是对象`);
        const allowed = allowColor ? ["name", "description", "color"] : ["name", "description"];
        if (Object.keys(item).some(key => !allowed.includes(key))) {
            invalid(`Zulip 参数 ${name}[${index}] 包含未知字段`);
        }
        requireString(item.name, `${name}[${index}].name`);
        if (item.description !== undefined)
            requireText(item.description, `${name}[${index}].description`);
        if (item.color !== undefined) validateColor(item.color, `${name}[${index}].color`);
    }
}

function validatePrincipals(value: unknown): void {
    if (value === undefined) return;
    if (!Array.isArray(value) || !value.length) invalid("Zulip 参数 principals 必须是非空数组");
    if (value.every(item => typeof item === "string")) {
        requireStringArray(value, "principals");
        return;
    }
    requireIntegerArray(value, "principals");
}

function validateBooleans(input: ZulipParams, fields: readonly string[]): void {
    for (const field of fields) {
        if (input[field] !== undefined) requireBoolean(input[field], field);
    }
}

function validateCommonChannelSettings(input: ZulipParams, update: boolean): void {
    if (input.message_retention_days !== undefined) {
        const value = input.message_retention_days;
        if (value !== "realm_default" && value !== "unlimited") {
            requireInteger(value, "message_retention_days");
        }
    }
    if (input.topics_policy !== undefined) {
        const policy = requireString(input.topics_policy, "topics_policy");
        if (!TOPICS_POLICIES.has(policy)) invalid("Zulip 参数 topics_policy 不是有效策略");
    }
    if (input.folder_id !== undefined) {
        if (input.folder_id === null) {
            if (!update) invalid("Zulip 参数 folder_id 在创建频道时不能为 null");
        } else {
            requireInteger(input.folder_id, "folder_id");
        }
    }
    for (const field of PERMISSION_FIELDS) {
        if (input[field] !== undefined) validateGroupSetting(input[field], field, update);
    }
}

function validateGroupSetting(value: unknown, name: string, update: boolean): void {
    if (!update) {
        validateGroupSettingValue(value, name);
        return;
    }
    if (!isRecord(value)) invalid(`Zulip 参数 ${name} 必须是权限组更新对象`);
    if (Object.keys(value).some(key => key !== "new" && key !== "old")) {
        invalid(`Zulip 参数 ${name} 包含未知字段`);
    }
    if (value.new === undefined) invalid(`Zulip 参数 ${name}.new 为必填项`);
    validateGroupSettingValue(value.new, `${name}.new`);
    if (value.old !== undefined) validateGroupSettingValue(value.old, `${name}.old`);
}

function validateGroupSettingValue(value: unknown, name: string): void {
    if (typeof value === "number") {
        requireInteger(value, name);
        return;
    }
    if (!isRecord(value)) invalid(`Zulip 参数 ${name} 必须是权限组 ID 或成员集合`);
    if (Object.keys(value).some(key => key !== "direct_members" && key !== "direct_subgroups")) {
        invalid(`Zulip 参数 ${name} 包含未知字段`);
    }
    if (value.direct_members !== undefined)
        requireIntegerArray(value.direct_members, `${name}.direct_members`);
    if (value.direct_subgroups !== undefined) {
        requireIntegerArray(value.direct_subgroups, `${name}.direct_subgroups`);
    }
}

function validateColor(value: unknown, name: string): void {
    const color = requireString(value, name);
    if (!/^#[0-9a-f]{6}$/i.test(color)) invalid(`Zulip 参数 ${name} 必须是 6 位十六进制颜色`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string): never {
    throw new ZulipError(message, { code: "ZULIP_INVALID_ACTION_PARAM" });
}
