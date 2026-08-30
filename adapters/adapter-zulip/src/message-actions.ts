import type { PlatformActionHandler } from "onebots";
import {
    exactParams,
    requireBoolean,
    requireInteger,
    requireIntegerArray,
    requireString,
    requireText,
} from "./action-params.js";
import type { ZulipClient } from "./client.js";
import { ZulipError } from "./errors.js";
import type { ZulipParam, ZulipParams } from "./types.js";

const EDITABLE_FLAGS = new Set(["read", "starred", "collapsed"]);
const FLAG_OPERATIONS = new Set(["add", "remove"]);
const NARROW_FIELDS = [
    "anchor",
    "include_anchor",
    "num_before",
    "num_after",
    "narrow",
    "op",
    "flag",
] as const;
const MESSAGE_QUERY_FIELDS = [
    "anchor",
    "include_anchor",
    "anchor_date",
    "num_before",
    "num_after",
    "narrow",
    "client_gravatar",
    "apply_markdown",
    "message_ids",
    "allow_empty_topic_name",
] as const;
const MESSAGE_QUERY_BOOLEAN_FIELDS = [
    "include_anchor",
    "client_gravatar",
    "apply_markdown",
    "allow_empty_topic_name",
] as const;
const MESSAGE_RANGE_FIELDS = [
    "anchor",
    "include_anchor",
    "anchor_date",
    "num_before",
    "num_after",
] as const;

/** Zulip 消息查询、反应、个人标记与审核动作。 */
export const ZULIP_MESSAGE_ACTION_HANDLERS = {
    add_reaction: (client, params) => reaction(client, params, "add"),
    remove_reaction: (client, params) => reaction(client, params, "remove"),
    star_message: (client, params) => messageFlag(client, params, "add"),
    unstar_message: (client, params) => messageFlag(client, params, "remove"),
    get_messages: (client, params) => client.call("messages", "GET", messageQueryParams(params)),
    get_message_edit_history: (client, params) => {
        const messageId = onlyMessageId(params);
        return client.call(`messages/${messageId}/history`);
    },
    get_message_read_receipts: (client, params) => {
        const messageId = onlyMessageId(params);
        return client.call(`messages/${messageId}/read_receipts`);
    },
    render_message: (client, params) => {
        const input = exactParams(params, ["content"], ["content"]);
        requireString(input.content, "content");
        return client.call("messages/render", "POST", input);
    },
    update_message_flags: (client, params) => {
        const input = exactParams(params, ["messages", "op", "flag"], ["messages", "op", "flag"]);
        const messages = requireNonEmptyMessageIds(input.messages, "messages");
        const op = requireFlagOperation(input.op);
        const flag = requireEditableFlag(input.flag);
        return client.updateMessageFlag(messages, op, flag);
    },
    update_message_flags_for_narrow: (client, params) => {
        const input = exactParams(params, NARROW_FIELDS, [
            "anchor",
            "num_before",
            "num_after",
            "narrow",
            "op",
            "flag",
        ]);
        validateAnchor(input.anchor);
        requireInteger(input.num_before, "num_before");
        requireInteger(input.num_after, "num_after");
        validateNarrow(input.narrow);
        requireFlagOperation(input.op);
        requireEditableFlag(input.flag);
        if (input.include_anchor !== undefined) {
            requireBoolean(input.include_anchor, "include_anchor");
        }
        return client.call("messages/flags/narrow", "POST", input);
    },
    check_messages_match_narrow: (client, params) => {
        const input = exactParams(params, ["msg_ids", "narrow"], ["msg_ids", "narrow"]);
        requireNonEmptyMessageIds(input.msg_ids, "msg_ids");
        validateNarrow(input.narrow);
        return client.call("messages/matches_narrow", "GET", input);
    },
    report_message: (client, params) => {
        const input = exactParams(
            params,
            ["message_id", "report_type", "description"],
            ["message_id", "report_type"],
        );
        const messageId = requireInteger(input.message_id, "message_id");
        const reportType = requireString(input.report_type, "report_type");
        const description = input.description;
        if (description !== undefined) validateReportDescription(description);
        if (reportType === "other" && description === undefined) {
            invalid("Zulip 举报类型 other 必须提供 description");
        }
        const body = { ...input };
        delete body.message_id;
        return client.call(`messages/${messageId}/report`, "POST", body);
    },
} satisfies Readonly<Record<string, PlatformActionHandler<ZulipClient>>>;

function reaction(
    client: ZulipClient,
    params: Readonly<Record<string, unknown>>,
    operation: "add" | "remove",
): Promise<unknown> {
    const input = exactParams(
        params,
        ["message_id", "emoji_name", "emoji_code", "reaction_type"],
        ["message_id", "emoji_name"],
    );
    return client.setReaction(
        requireInteger(input.message_id, "message_id"),
        operation,
        requireString(input.emoji_name, "emoji_name"),
        optionalActionString(input.emoji_code, "emoji_code"),
        optionalActionString(input.reaction_type, "reaction_type"),
    );
}

function messageFlag(
    client: ZulipClient,
    params: Readonly<Record<string, unknown>>,
    operation: "add" | "remove",
): Promise<unknown> {
    return client.updateMessageFlag([onlyMessageId(params)], operation, "starred");
}

function onlyMessageId(params: Readonly<Record<string, unknown>>): number {
    const input = exactParams(params, ["message_id"], ["message_id"]);
    return requireInteger(input.message_id, "message_id");
}

function optionalActionString(value: unknown, name: string): string | undefined {
    return value === undefined ? undefined : requireString(value, name);
}

function requireNonEmptyMessageIds(value: unknown, name: string): readonly number[] {
    const result = requireIntegerArray(value, name);
    if (!result.length) invalid(`Zulip 参数 ${name} 不能为空`);
    return result;
}

function requireFlagOperation(value: unknown): "add" | "remove" {
    if (typeof value !== "string" || !FLAG_OPERATIONS.has(value)) {
        invalid("Zulip 参数 op 必须是 add 或 remove");
    }
    return value === "add" ? "add" : "remove";
}

function requireEditableFlag(value: unknown): "read" | "starred" | "collapsed" {
    if (typeof value !== "string" || !EDITABLE_FLAGS.has(value)) {
        invalid("Zulip 参数 flag 必须是 read、starred 或 collapsed");
    }
    if (value === "read" || value === "starred") return value;
    return "collapsed";
}

function messageQueryParams(params: Readonly<Record<string, unknown>>): ZulipParams {
    const input = exactParams(params, MESSAGE_QUERY_FIELDS);
    if (input.narrow !== undefined) validateNarrow(input.narrow);
    for (const field of MESSAGE_QUERY_BOOLEAN_FIELDS) {
        if (input[field] !== undefined) requireBoolean(input[field], field);
    }

    if (input.message_ids !== undefined) {
        requireIntegerArray(input.message_ids, "message_ids");
        if (MESSAGE_RANGE_FIELDS.some(field => input[field] !== undefined)) {
            invalid("Zulip 参数 message_ids 不能与范围查询参数同时使用");
        }
        return input;
    }

    if (input.num_before === undefined || input.num_after === undefined) {
        invalid("Zulip 范围消息查询必须提供 num_before 和 num_after");
    }
    requireInteger(input.num_before, "num_before");
    requireInteger(input.num_after, "num_after");
    if (input.anchor !== undefined) validateAnchor(input.anchor);
    validateAnchorDate(input.anchor, input.anchor_date);
    return input;
}

function validateAnchor(value: ZulipParam | undefined): void {
    if (
        value === "newest" ||
        value === "oldest" ||
        value === "first_unread" ||
        value === "date" ||
        (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) ||
        (typeof value === "string" && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)))
    ) {
        return;
    }
    invalid("Zulip 参数 anchor 必须是消息 ID、newest、oldest、first_unread 或 date");
}

function validateNarrow(value: ZulipParam | undefined): void {
    if (!Array.isArray(value)) invalid("Zulip 参数 narrow 必须是筛选条件数组");
    for (const [index, item] of value.entries()) {
        if (Array.isArray(item)) {
            if (
                item.length !== 2 ||
                typeof item[0] !== "string" ||
                typeof item[1] !== "string" ||
                !item[0] ||
                !item[1]
            ) {
                invalid(`Zulip narrow[${index}] 二元组必须包含 operator 与 operand`);
            }
            continue;
        }
        if (!isRecord(item)) invalid(`Zulip narrow[${index}] 必须是筛选对象`);
        const keys = Object.keys(item);
        if (keys.some(key => key !== "operator" && key !== "operand" && key !== "negated")) {
            invalid(`Zulip narrow[${index}] 包含未知字段`);
        }
        requireString(item.operator, `narrow[${index}].operator`);
        validateNarrowOperand(item.operand, `narrow[${index}].operand`);
        if (item.negated !== undefined) requireBoolean(item.negated, `narrow[${index}].negated`);
    }
}

function validateNarrowOperand(value: unknown, name: string): void {
    if (typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value))) {
        return;
    }
    if (Array.isArray(value)) {
        requireIntegerArray(value, name);
        return;
    }
    invalid(`Zulip 参数 ${name} 必须是字符串、整数或整数数组`);
}

function validateAnchorDate(anchor: ZulipParam | undefined, value: ZulipParam | undefined): void {
    if (anchor !== "date") {
        if (value !== undefined) invalid("Zulip 参数 anchor_date 只能与 anchor: date 一起使用");
        return;
    }
    const date = requireString(value, "anchor_date");
    if (
        !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(date) ||
        !isCalendarDate(date.slice(0, 10)) ||
        Number.isNaN(Date.parse(date))
    ) {
        invalid("Zulip 参数 anchor_date 必须是 ISO 8601 日期或日期时间");
    }
}

function isCalendarDate(value: string): boolean {
    const [year, month, day] = value.split("-").map(Number);
    const normalized = new Date(Date.UTC(year, month - 1, day));
    return (
        normalized.getUTCFullYear() === year &&
        normalized.getUTCMonth() === month - 1 &&
        normalized.getUTCDate() === day
    );
}

function validateReportDescription(value: unknown): void {
    const description = requireText(value, "description");
    if (!description || Array.from(description).length > 1000) {
        invalid("Zulip 参数 description 必须为 1–1000 个 Unicode 字符");
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string): never {
    throw new ZulipError(message, { code: "ZULIP_INVALID_ACTION_PARAM" });
}
