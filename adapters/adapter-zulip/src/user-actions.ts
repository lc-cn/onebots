import type { PlatformActionHandler } from "onebots";
import {
    assertHasAny,
    exactParams,
    requireBoolean,
    requireInteger,
    requireString,
    requireText,
    requireZulipUserRole,
} from "./action-params.js";
import type { ZulipClient } from "./client.js";
import { ZulipError } from "./errors.js";
import { validateProfileData } from "./profile-data.js";
import type { ZulipParams } from "./types.js";

const UPDATE_FIELDS = ["full_name", "role", "profile_data", "new_email"] as const;
const DEACTIVATION_ACTION_FIELDS = [
    "delete_profile",
    "delete_public_channel_messages",
    "delete_private_channel_messages",
    "delete_direct_messages",
] as const;

/** 需要组织管理员或特殊账号权限的用户管理动作。 */
export const ZULIP_USER_MUTATION_ACTIONS: ReadonlySet<string> = new Set([
    "create_user",
    "update_user",
    "deactivate_user",
    "reactivate_user",
]);

/** Zulip 12 组织成员生命周期动作。 */
export const ZULIP_USER_ACTION_HANDLERS = {
    create_user: (client, params) => client.call("users", "POST", createUserParams(params)),
    update_user: (client, params) =>
        client.call(
            `users/${requireInteger(params.user_id, "user_id")}`,
            "PATCH",
            updateUserParams(params),
        ),
    deactivate_user: (client, params) => deactivateUser(client, params),
    reactivate_user: (client, params) => reactivateUser(client, params),
} satisfies Readonly<Record<string, PlatformActionHandler<ZulipClient>>>;

function createUserParams(params: Readonly<Record<string, unknown>>): ZulipParams {
    const result = exactParams(
        params,
        ["email", "password", "full_name"],
        ["email", "password", "full_name"],
    );
    requireString(result.email, "email");
    requireString(result.password, "password");
    requireString(result.full_name, "full_name");
    return result;
}

function updateUserParams(params: Readonly<Record<string, unknown>>): ZulipParams {
    const body = { ...params };
    delete body.user_id;
    const result = exactParams(body, UPDATE_FIELDS);
    assertHasAny(result, UPDATE_FIELDS);
    if (result.full_name !== undefined) requireString(result.full_name, "full_name");
    if (result.role !== undefined) requireZulipUserRole(result.role);
    if (result.profile_data !== undefined) validateProfileData(result.profile_data);
    if (result.new_email !== undefined) requireString(result.new_email, "new_email");
    return result;
}

function deactivateUser(
    client: ZulipClient,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    const userId = requireInteger(params.user_id, "user_id");
    const body = { ...params };
    delete body.user_id;
    const result = exactParams(body, ["actions", "deactivation_notification_comment"]);
    if (result.actions !== undefined) validateDeactivationActions(result.actions);
    const comment = result.deactivation_notification_comment;
    if (comment !== undefined && comment !== null) {
        requireText(comment, "deactivation_notification_comment");
    }
    return client.call(`users/${userId}`, "DELETE", result);
}

function reactivateUser(
    client: ZulipClient,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    const userId = requireInteger(params.user_id, "user_id");
    const body = { ...params };
    delete body.user_id;
    exactParams(body, []);
    return client.call(`users/${userId}/reactivate`, "POST");
}

function validateDeactivationActions(value: unknown): void {
    if (!isRecord(value)) invalid("Zulip 参数 actions 必须是对象");
    const result = exactParams(value, DEACTIVATION_ACTION_FIELDS);
    assertHasAny(result, DEACTIVATION_ACTION_FIELDS);
    for (const field of DEACTIVATION_ACTION_FIELDS) {
        if (result[field] !== undefined) requireBoolean(result[field], `actions.${field}`);
    }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string): never {
    throw new ZulipError(message, { code: "ZULIP_INVALID_ACTION_PARAM" });
}
