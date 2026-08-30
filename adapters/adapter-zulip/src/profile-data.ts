import { exactParams, requireInteger, requireIntegerArray } from "./action-params.js";
import { ZulipError } from "./errors.js";
import type { ZulipParam } from "./types.js";

/** 校验 Zulip 自定义资料值数组，供本人资料与管理员资料更新复用。 */
export function validateProfileData(value: unknown, name = "profile_data"): void {
    if (!Array.isArray(value)) invalid(`Zulip 参数 ${name} 必须是数组`);
    for (const [index, item] of value.entries()) {
        if (!isRecord(item)) invalid(`Zulip 参数 ${name}[${index}] 必须是对象`);
        const field = exactParams(item, ["id", "value"], ["id", "value"]);
        requireInteger(field.id, `${name}[${index}].id`);
        validateProfileValue(field.value, `${name}[${index}].value`);
    }
}

/** 校验待清除的自定义资料字段 ID。 */
export function validateProfileFieldIds(value: unknown, name = "data"): void {
    requireIntegerArray(value, name);
}

function validateProfileValue(value: ZulipParam | undefined, name: string): void {
    if (value === null || typeof value === "string") return;
    requireIntegerArray(value, name);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string): never {
    throw new ZulipError(message, { code: "ZULIP_INVALID_ACTION_PARAM" });
}
