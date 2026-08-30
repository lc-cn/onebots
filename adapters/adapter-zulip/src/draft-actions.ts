import type { PlatformActionHandler } from "onebots";
import { exactParams, requireInteger, requireIntegerArray, requireText } from "./action-params.js";
import type { ZulipClient } from "./client.js";
import { ZulipError } from "./errors.js";

/** Zulip 当前用户草稿同步动作。 */
export const ZULIP_DRAFT_ACTION_HANDLERS = {
    get_drafts: client => client.call("drafts"),
    create_drafts: (client, params) => {
        const input = exactParams(params, ["drafts"], ["drafts"]);
        validateDrafts(input.drafts);
        return client.call("drafts", "POST", input);
    },
    edit_draft: (client, params) => {
        const input = exactParams(params, ["draft_id", "draft"], ["draft_id", "draft"]);
        const id = requireInteger(input.draft_id, "draft_id");
        validateDraft(input.draft, "draft");
        return client.call(`drafts/${id}`, "PATCH", { draft: input.draft });
    },
    delete_draft: (client, params) => {
        const input = exactParams(params, ["draft_id"], ["draft_id"]);
        return client.call(`drafts/${requireInteger(input.draft_id, "draft_id")}`, "DELETE");
    },
} satisfies Readonly<Record<string, PlatformActionHandler<ZulipClient>>>;

function validateDrafts(value: unknown): void {
    if (!Array.isArray(value) || !value.length) invalid("Zulip 参数 drafts 必须是非空数组");
    value.forEach((draft, index) => validateDraft(draft, `drafts[${index}]`));
}

function validateDraft(value: unknown, name: string): void {
    if (!isRecord(value)) invalid(`Zulip 参数 ${name} 必须是对象`);
    const input = exactParams(
        value,
        ["type", "to", "topic", "content", "timestamp"],
        ["type", "to", "topic", "content"],
    );
    const type = requireText(input.type, `${name}.type`);
    if (type !== "stream" && type !== "private") {
        if (type !== "") invalid(`Zulip 参数 ${name}.type 不是有效草稿场景`);
    }
    const to = requireIntegerArray(input.to, `${name}.to`);
    const topic = requireText(input.topic, `${name}.topic`);
    const content = requireText(input.content, `${name}.content`);
    if (topic.includes("\0") || content.includes("\0"))
        invalid(`Zulip 参数 ${name} 不能包含空字符`);
    if (type === "stream" && to.length !== 1) invalid(`Zulip 参数 ${name}.to 必须只含一个频道 ID`);
    if (type === "private" && !to.length) invalid(`Zulip 参数 ${name}.to 必须包含用户 ID`);
    if (type === "" && (to.length || topic)) invalid(`Zulip 未寻址草稿必须使用空 to 和空 topic`);
    if (type === "private" && topic) invalid(`Zulip 私聊草稿必须使用空 topic`);
    if (input.timestamp !== undefined) requireInteger(input.timestamp, `${name}.timestamp`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string): never {
    throw new ZulipError(message, { code: "ZULIP_INVALID_ACTION_PARAM" });
}
