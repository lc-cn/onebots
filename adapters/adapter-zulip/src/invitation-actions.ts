import type { PlatformActionHandler } from "onebots";
import {
    exactParams,
    requireBoolean,
    requireInteger,
    requireIntegerArray,
    requireString,
    requireText,
    requireZulipUserRole,
} from "./action-params.js";
import type { ZulipClient } from "./client.js";
import { ZulipError } from "./errors.js";
import type { ZulipParams } from "./types.js";

const COMMON_FIELDS = [
    "invite_expires_in_minutes",
    "invite_as",
    "stream_ids",
    "group_ids",
    "include_realm_default_subscriptions",
    "welcome_message_custom_text",
] as const;

/** 取决于组织邀请权限的完整邀请领域动作。 */
export const ZULIP_INVITATION_ACTIONS: ReadonlySet<string> = new Set([
    "list_invitations",
    "send_invitations",
    "create_invitation_link",
    "resend_email_invitation",
    "revoke_email_invitation",
    "revoke_invitation_link",
]);

export const ZULIP_INVITATION_ACTION_HANDLERS = {
    list_invitations: (client, params) => {
        exactParams(params, []);
        return client.call("invites");
    },
    send_invitations: (client, params) =>
        client.call("invites", "POST", invitationParams(params, true)),
    create_invitation_link: (client, params) =>
        client.call("invites/multiuse", "POST", invitationParams(params, false)),
    resend_email_invitation: (client, params) => invitationResourceAction(client, params, "resend"),
    revoke_email_invitation: (client, params) => invitationResourceAction(client, params),
    revoke_invitation_link: (client, params) =>
        invitationResourceAction(client, params, "multiuse"),
} satisfies Readonly<Record<string, PlatformActionHandler<ZulipClient>>>;

function invitationParams(
    params: Readonly<Record<string, unknown>>,
    emailInvitation: boolean,
): ZulipParams {
    const allowed = emailInvitation
        ? ["invitee_emails", ...COMMON_FIELDS, "notify_referrer_on_join"]
        : COMMON_FIELDS;
    const required = emailInvitation ? ["invitee_emails", "stream_ids"] : [];
    const result = exactParams(params, allowed, required);
    if (emailInvitation) {
        requireString(result.invitee_emails, "invitee_emails");
        requireIntegerArray(result.stream_ids, "stream_ids");
        if (result.notify_referrer_on_join !== undefined) {
            requireBoolean(result.notify_referrer_on_join, "notify_referrer_on_join");
        }
    } else if (result.stream_ids !== undefined) {
        requireIntegerArray(result.stream_ids, "stream_ids");
    }
    if (result.group_ids !== undefined) requireIntegerArray(result.group_ids, "group_ids");
    if (result.invite_as !== undefined) requireZulipUserRole(result.invite_as, "invite_as");
    validateExpiry(result.invite_expires_in_minutes);
    if (result.include_realm_default_subscriptions !== undefined) {
        requireBoolean(
            result.include_realm_default_subscriptions,
            "include_realm_default_subscriptions",
        );
    }
    validateWelcomeText(result.welcome_message_custom_text);
    return result;
}

function invitationResourceAction(
    client: ZulipClient,
    params: Readonly<Record<string, unknown>>,
    operation?: "resend" | "multiuse",
): Promise<unknown> {
    const inviteId = requireInteger(params.invite_id, "invite_id");
    const body = { ...params };
    delete body.invite_id;
    exactParams(body, []);
    if (operation === "resend") return client.call(`invites/${inviteId}/resend`, "POST");
    const prefix = operation === "multiuse" ? "invites/multiuse" : "invites";
    return client.call(`${prefix}/${inviteId}`, "DELETE");
}

function validateExpiry(value: unknown): void {
    if (value === undefined || value === null) return;
    requireInteger(value, "invite_expires_in_minutes");
}

function validateWelcomeText(value: unknown): void {
    if (value === undefined || value === null) return;
    const text = requireText(value, "welcome_message_custom_text");
    if ([...text].length > 8000) {
        throw new ZulipError("Zulip 参数 welcome_message_custom_text 不能超过 8000 个字符", {
            code: "ZULIP_INVALID_ACTION_PARAM",
        });
    }
}
