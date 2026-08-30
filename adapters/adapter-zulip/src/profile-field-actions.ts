import type { PlatformActionHandler } from "onebots";
import {
    assertHasAny,
    exactParams,
    requireBoolean,
    requireInteger,
    requireIntegerArray,
    requireString,
    requireText,
} from "./action-params.js";
import type { ZulipClient } from "./client.js";
import { ZulipError } from "./errors.js";
import type { ZulipParams } from "./types.js";

const PROFILE_FIELD_TYPES = new Set([1, 2, 3, 4, 5, 6, 7, 8]);
const MUTABLE_FIELDS = [
    "name",
    "hint",
    "field_data",
    "display_in_profile_summary",
    "required",
    "editable_by_user",
    "use_for_user_matching",
] as const;
const CREATE_FIELDS = ["field_type", ...MUTABLE_FIELDS] as const;

export const ZULIP_PROFILE_FIELD_MUTATION_ACTIONS: ReadonlySet<string> = new Set([
    "create_profile_field",
    "update_profile_field",
    "delete_profile_field",
    "reorder_profile_fields",
]);

/** Zulip 组织 Custom Profile Field 资源动作。 */
export const ZULIP_PROFILE_FIELD_ACTION_HANDLERS = {
    list_profile_fields: (client, params) => {
        exactParams(params, []);
        return client.call("realm/profile_fields");
    },
    create_profile_field: (client, params) =>
        client.call("realm/profile_fields", "POST", createParams(params)),
    update_profile_field: (client, params) => {
        const fieldId = requireInteger(params.field_id, "field_id");
        const body = { ...params };
        delete body.field_id;
        return client.call(`realm/profile_fields/${fieldId}`, "PATCH", updateParams(body));
    },
    delete_profile_field: (client, params) => {
        const fieldId = requireInteger(params.field_id, "field_id");
        const body = { ...params };
        delete body.field_id;
        exactParams(body, []);
        return client.call(`realm/profile_fields/${fieldId}`, "DELETE");
    },
    reorder_profile_fields: (client, params) => {
        const body = exactParams(params, ["order"], ["order"]);
        requireIntegerArray(body.order, "order");
        return client.call("realm/profile_fields", "PATCH", body);
    },
} satisfies Readonly<Record<string, PlatformActionHandler<ZulipClient>>>;

function createParams(params: Readonly<Record<string, unknown>>): ZulipParams {
    const result = exactParams(params, CREATE_FIELDS, ["field_type"]);
    const fieldType = requireProfileFieldType(result.field_type);
    validateMutableFields(result);
    if (result.field_data !== undefined && fieldType !== 3 && fieldType !== 7) {
        invalid("Zulip field_data 仅适用于 Dropdown 或 External Account 字段");
    }
    if (result.display_in_profile_summary === true && fieldType === 6) {
        invalid("Zulip Users 字段不能显示在资料摘要中");
    }
    if (result.use_for_user_matching === true && fieldType !== 1 && fieldType !== 7) {
        invalid("Zulip 仅允许 Short Text 或 External Account 字段参与用户匹配");
    }
    return result;
}

function updateParams(params: Readonly<Record<string, unknown>>): ZulipParams {
    const result = exactParams(params, MUTABLE_FIELDS);
    assertHasAny(result, MUTABLE_FIELDS);
    validateMutableFields(result);
    return result;
}

function validateMutableFields(params: ZulipParams): void {
    if (params.name !== undefined) requireString(params.name, "name");
    if (params.hint !== undefined) requireText(params.hint, "hint");
    if (params.field_data !== undefined && !isRecord(params.field_data)) {
        invalid("Zulip 参数 field_data 必须是对象");
    }
    for (const field of [
        "display_in_profile_summary",
        "required",
        "editable_by_user",
        "use_for_user_matching",
    ] as const) {
        if (params[field] !== undefined) requireBoolean(params[field], field);
    }
}

function requireProfileFieldType(value: unknown): number {
    const fieldType = requireInteger(value, "field_type");
    if (!PROFILE_FIELD_TYPES.has(fieldType)) invalid("Zulip field_type 必须是 1 到 8");
    return fieldType;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string): never {
    throw new ZulipError(message, { code: "ZULIP_INVALID_ACTION_PARAM" });
}
