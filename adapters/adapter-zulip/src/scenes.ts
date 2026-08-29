import { ZulipError } from "./errors.js";
import type { ZulipMessage, ZulipRecipient } from "./types.js";

export interface ZulipNarrow {
    operator: string;
    operand: string | number | readonly number[];
}

/** 解析 `频道 ID/话题` 场景。 */
export function parseStreamScene(
    source: string,
    defaultTopic = "general",
): { to: number; topic: string } {
    const slash = source.indexOf("/");
    const stream = Number(slash < 0 ? source : source.slice(0, slash));
    if (!Number.isSafeInteger(stream)) {
        throw new ZulipError(`无效的 Zulip 频道场景: ${source}`, {
            code: "ZULIP_INVALID_SCENE",
        });
    }
    return { to: stream, topic: slash < 0 ? defaultTopic : source.slice(slash + 1) };
}

/** 解析以逗号分隔的单人或多人私聊参与者 ID。 */
export function parseDirectRecipients(source: string): number[] {
    const result = source.split(",").map(value => Number(value.trim()));
    if (!result.length || result.some(value => !Number.isSafeInteger(value))) {
        throw new ZulipError(`无效的 Zulip 私聊场景: ${source}`, {
            code: "ZULIP_INVALID_SCENE",
        });
    }
    return [...new Set(result)].sort((left, right) => left - right);
}

/** 构造精确频道或话题 narrow。 */
export function streamNarrow(source: string): ZulipNarrow[] {
    const scene = parseStreamScene(source);
    const narrow: ZulipNarrow[] = [{ operator: "channel", operand: scene.to }];
    if (source.includes("/")) narrow.push({ operator: "topic", operand: scene.topic });
    return narrow;
}

/** 构造精确私聊会话 narrow；多人私聊使用官方 ID 数组操作数。 */
export function directNarrow(source: string): ZulipNarrow[] {
    const recipients = parseDirectRecipients(source);
    return [{ operator: "dm", operand: recipients.length === 1 ? recipients[0] : recipients }];
}

/** 从消息参与者中恢复稳定的私聊场景 ID，不包含当前 Bot。 */
export function directScene(message: ZulipMessage, botEmail?: string): string {
    const recipients = Array.isArray(message.display_recipient)
        ? message.display_recipient.filter(recipient => recipient.email !== botEmail)
        : [];
    const ids = recipients.map(recipient => recipient.id).sort((left, right) => left - right);
    return ids.length ? ids.join(",") : String(message.sender_id);
}

/** 返回私聊参与者，供调用方生成场景名称。 */
export function directRecipients(message: ZulipMessage, botEmail?: string): ZulipRecipient[] {
    return Array.isArray(message.display_recipient)
        ? message.display_recipient.filter(recipient => recipient.email !== botEmail)
        : [];
}
