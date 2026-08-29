import {
    type Adapter,
    requireBooleanParam,
    requireNonEmptyStringParam,
    requirePositiveIntegerParam,
} from "onebots";

export const MILKY_GROUP_REQUEST_ACTIONS = new Set([
    "accept_group_request",
    "reject_group_request",
    "accept_group_invitation",
    "reject_group_invitation",
]);

/** 获取可处理的群通知，并保留 canonical 联合类型和翻页游标。 */
export async function getMilkyGroupNotifications(
    adapter: Adapter,
    accountId: string,
    params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    const result = await adapter.getGroupNotifications(accountId, {
        start_notification_id:
            params.start_notification_seq === undefined
                ? undefined
                : adapter.resolveId(requirePositiveIntegerParam(params, "start_notification_seq")),
        is_filtered: optionalBoolean(params, "is_filtered", false),
        limit: params.limit === undefined ? 20 : requirePositiveIntegerParam(params, "limit"),
    });
    return {
        notifications: result.notifications.map(projectGroupNotification),
        ...(result.next_notification_id === undefined
            ? {}
            : { next_notification_seq: result.next_notification_id.number }),
    };
}

function projectGroupNotification(notification: Adapter.GroupNotification) {
    const common = {
        type: notification.type,
        group_id: notification.group_id.number,
        notification_seq: notification.notification_id.number,
        is_filtered: notification.is_filtered,
        initiator_id: notification.initiator_id.number,
        state: notification.state,
        ...(notification.operator_id === undefined
            ? {}
            : { operator_id: notification.operator_id.number }),
    };
    return notification.type === "join_request"
        ? { ...common, comment: notification.comment }
        : { ...common, target_user_id: notification.target_user_id.number };
}

/** 严格翻译 Milky 群请求与机器人受邀动作。 */
export async function executeMilkyGroupRequestAction(
    adapter: Adapter,
    accountId: string,
    action: string,
    params: Record<string, unknown>,
): Promise<Record<string, never>> {
    const invitation = action.endsWith("invitation");
    const approve = action.startsWith("accept");
    const groupId = adapter.resolveId(requirePositiveIntegerParam(params, "group_id"));
    const requestId = adapter.resolveId(
        requirePositiveIntegerParam(params, invitation ? "invitation_seq" : "notification_seq"),
    );
    const notificationType = invitation ? "invited_join_request" : requireNotificationType(params);

    await adapter.handleGroupRequest(accountId, {
        request_id: requestId,
        group_id: groupId,
        is_filtered: invitation ? false : optionalBoolean(params, "is_filtered", false),
        type: invitation ? "invitation" : "request",
        sub_type: notificationType === "join_request" ? "add" : "invite",
        approve,
        reason:
            !approve && params.reason !== undefined
                ? requireNonEmptyStringParam(params, "reason")
                : undefined,
    });
    return {};
}

function optionalBoolean(params: Record<string, unknown>, key: string, fallback: boolean): boolean {
    return params[key] === undefined ? fallback : requireBooleanParam(params, key);
}

function requireNotificationType(
    params: Record<string, unknown>,
): "join_request" | "invited_join_request" {
    const value = params.notification_type;
    if (value !== "join_request" && value !== "invited_join_request") {
        throw new TypeError("notification_type 必须是 join_request 或 invited_join_request");
    }
    return value;
}
