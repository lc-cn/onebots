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

const PERMISSION_FIELDS = [
    "can_add_members_group",
    "can_join_group",
    "can_leave_group",
    "can_manage_group",
    "can_mention_group",
    "can_remove_members_group",
] as const;
const UPDATE_FIELDS = ["name", "description", ...PERMISSION_FIELDS, "deactivated"] as const;
const MEMBERSHIP_FIELDS = ["add", "delete", "add_subgroups", "delete_subgroups"] as const;

export const ZULIP_USER_GROUP_MUTATION_ACTIONS: ReadonlySet<string> = new Set([
    "create_user_group",
    "update_user_group",
    "deactivate_user_group",
    "update_user_group_members",
    "update_user_group_subgroups",
]);

/** Zulip 12 可由 Bot 调用的完整用户组领域动作。 */
export const ZULIP_USER_GROUP_ACTION_HANDLERS = {
    list_user_groups: (client, params) =>
        client.call(
            "user_groups",
            "GET",
            optionalBooleanQuery(params, "include_deactivated_groups"),
        ),
    create_user_group: (client, params) =>
        client.call("user_groups/create", "POST", createParams(params)),
    update_user_group: (client, params) =>
        client.call(
            `user_groups/${requireInteger(params.user_group_id, "user_group_id")}`,
            "PATCH",
            updateParams(params),
        ),
    deactivate_user_group: (client, params) => deactivateUserGroup(client, params),
    update_user_group_members: (client, params) =>
        client.call(
            `user_groups/${requireInteger(params.user_group_id, "user_group_id")}/members`,
            "POST",
            membershipParams(params, MEMBERSHIP_FIELDS),
        ),
    update_user_group_subgroups: (client, params) =>
        client.call(
            `user_groups/${requireInteger(params.user_group_id, "user_group_id")}/subgroups`,
            "POST",
            membershipParams(params, ["add", "delete"]),
        ),
    get_user_group_members: (client, params) =>
        client.call(
            `user_groups/${requireInteger(params.user_group_id, "user_group_id")}/members`,
            "GET",
            optionalBooleanQuery(params, "direct_member_only", ["user_group_id"]),
        ),
    get_user_group_subgroups: (client, params) =>
        client.call(
            `user_groups/${requireInteger(params.user_group_id, "user_group_id")}/subgroups`,
            "GET",
            optionalBooleanQuery(params, "direct_subgroup_only", ["user_group_id"]),
        ),
    get_user_group_membership: (client, params) =>
        client.call(
            `user_groups/${requireInteger(params.user_group_id, "user_group_id")}/members/${requireInteger(params.user_id, "user_id")}`,
            "GET",
            optionalBooleanQuery(params, "direct_member_only", ["user_group_id", "user_id"]),
        ),
} satisfies Readonly<Record<string, PlatformActionHandler<ZulipClient>>>;

function createParams(params: Readonly<Record<string, unknown>>): ZulipParams {
    const allowed = ["name", "description", "members", "subgroups", ...PERMISSION_FIELDS];
    const result = exactParams(params, allowed, ["name", "description", "members"]);
    requireString(result.name, "name");
    requireText(result.description, "description");
    requireIntegerArray(result.members, "members");
    if (result.subgroups !== undefined) requireIntegerArray(result.subgroups, "subgroups");
    for (const field of PERMISSION_FIELDS) {
        if (result[field] !== undefined) requireGroupSetting(result[field], field);
    }
    return result;
}

function updateParams(params: Readonly<Record<string, unknown>>): ZulipParams {
    const body = { ...params };
    delete body.user_group_id;
    const result = exactParams(body, UPDATE_FIELDS);
    assertHasAny(result, UPDATE_FIELDS);
    if (result.name !== undefined) requireString(result.name, "name");
    if (result.description !== undefined) requireText(result.description, "description");
    if (result.deactivated !== undefined) requireBoolean(result.deactivated, "deactivated");
    for (const field of PERMISSION_FIELDS) {
        if (result[field] !== undefined) requireGroupSettingUpdate(result[field], field);
    }
    return result;
}

function membershipParams(
    params: Readonly<Record<string, unknown>>,
    fields: readonly string[],
): ZulipParams {
    const body = { ...params };
    delete body.user_group_id;
    const result = exactParams(body, fields);
    assertHasAny(result, fields);
    for (const field of fields) {
        if (result[field] !== undefined) requireIntegerArray(result[field], field);
    }
    return result;
}

function optionalBooleanQuery(
    params: Readonly<Record<string, unknown>>,
    field: string,
    pathFields: readonly string[] = [],
): ZulipParams {
    const body = { ...params };
    for (const pathField of pathFields) delete body[pathField];
    const result = exactParams(body, [field]);
    if (result[field] !== undefined) requireBoolean(result[field], field);
    return result;
}

function deactivateUserGroup(
    client: ZulipClient,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    const userGroupId = requireInteger(params.user_group_id, "user_group_id");
    const body = { ...params };
    delete body.user_group_id;
    exactParams(body, []);
    return client.call(`user_groups/${userGroupId}/deactivate`, "POST");
}

function requireGroupSetting(value: unknown, field: string): void {
    if (typeof value === "number") {
        requireInteger(value, field);
        return;
    }
    if (!isRecord(value)) invalidGroupSetting(field);
    const setting = exactParams(
        value,
        ["direct_members", "direct_subgroups"],
        ["direct_members", "direct_subgroups"],
    );
    requireIntegerArray(setting.direct_members, `${field}.direct_members`);
    requireIntegerArray(setting.direct_subgroups, `${field}.direct_subgroups`);
}

function requireGroupSettingUpdate(value: unknown, field: string): void {
    if (!isRecord(value)) invalidGroupSetting(field);
    const update = exactParams(value, ["new", "old"], ["new"]);
    requireGroupSetting(update.new, `${field}.new`);
    if (update.old !== undefined) requireGroupSetting(update.old, `${field}.old`);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidGroupSetting(field: string): never {
    throw new ZulipError(`Zulip 参数 ${field} 必须是用户组权限值`, {
        code: "ZULIP_INVALID_ACTION_PARAM",
    });
}
