import { randomUUID } from "node:crypto";
import { WeComKfError } from "./errors.js";

/** 校验原生消息并生成符合微信客服 32 字节约束的幂等消息 ID。 */
export function resolveKfMessageId(message: Readonly<Record<string, unknown>>): string {
    if (typeof message.msgtype !== "string" || !message.msgtype) invalid("原生消息缺少 msgtype");
    if (message.msgid === undefined) return randomUUID().replaceAll("-", "");
    if (
        typeof message.msgid !== "string" ||
        !message.msgid ||
        message.msgid.length > 32 ||
        !/^[\w-]+$/u.test(message.msgid)
    )
        invalid("msgid 必须是最多 32 字节的字母、数字、下划线或连字符");
    return message.msgid;
}

function invalid(message: string): never {
    throw new WeComKfError(`微信客服 ${message}`, { code: "WECOM_KF_INVALID_PARAMETER" });
}
