import type { messagingApi } from "@line/bot-sdk";
import { LineApiError } from "./errors.js";
import type { LineBot } from "./bot.js";
import {
    base64Blob,
    couponStatuses,
    optionalBoolean,
    optionalNumber,
    optionalString,
    optionalStringArray,
    requireHttpsUrl,
    requireInteger,
    requireMessages,
    requireRecord,
    requireString,
    requireStringArray,
    streamResult,
} from "./platform-action-params.js";

export const LINE_PLATFORM_ACTIONS = new Set([
    "push_message",
    "reply_message",
    "multicast",
    "broadcast",
    "narrowcast",
    "get_narrowcast_progress",
    "validate_push",
    "validate_reply",
    "validate_multicast",
    "validate_broadcast",
    "validate_narrowcast",
    "push_messages_by_phone",
    "show_loading_animation",
    "mark_messages_as_read",
    "mark_messages_as_read_by_token",
    "get_message_content",
    "get_message_content_preview",
    "get_message_content_transcoding",
    "issue_link_token",
    "get_followers",
    "get_room_member_count",
    "get_room_member_profile",
    "get_room_member_list",
    "get_message_quota",
    "get_message_quota_consumption",
    "get_number_of_sent_reply_messages",
    "get_number_of_sent_push_messages",
    "get_number_of_sent_multicast_messages",
    "get_number_of_sent_broadcast_messages",
    "get_phone_message_statistics",
    "get_aggregation_unit_name_list",
    "get_aggregation_unit_usage",
    "get_webhook_endpoint",
    "set_webhook_endpoint",
    "test_webhook_endpoint",
    "create_rich_menu",
    "get_rich_menu",
    "list_rich_menus",
    "delete_rich_menu",
    "set_rich_menu_image",
    "get_rich_menu_image",
    "validate_rich_menu",
    "get_default_rich_menu",
    "set_default_rich_menu",
    "cancel_default_rich_menu",
    "link_rich_menu_to_user",
    "unlink_rich_menu_from_user",
    "get_user_rich_menu",
    "link_rich_menu_to_users",
    "unlink_rich_menu_from_users",
    "create_rich_menu_alias",
    "get_rich_menu_alias",
    "list_rich_menu_aliases",
    "update_rich_menu_alias",
    "delete_rich_menu_alias",
    "rich_menu_batch",
    "validate_rich_menu_batch",
    "get_rich_menu_batch_progress",
    "create_coupon",
    "get_coupon",
    "list_coupons",
    "close_coupon",
    "get_membership_list",
    "get_membership_subscription",
    "get_joined_membership_users",
    "get_number_of_followers",
    "get_friends_demographics",
    "get_number_of_message_deliveries",
    "get_message_event",
    "get_statistics_per_unit",
    "get_rich_menu_insight_summary",
    "get_rich_menu_insight_daily",
]);

/** 执行经过显式白名单审计的 LINE 原生能力。 */
export async function executeLinePlatformAction(
    bot: LineBot,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    const client = bot.getClient();
    try {
        switch (action) {
            case "push_message":
                return bot.pushMessage(requireString(params, "to"), requireMessages(params), {
                    retryKey: optionalString(params, "retry_key"),
                    notificationDisabled: optionalBoolean(params, "notification_disabled"),
                    customAggregationUnits: optionalStringArray(params, "custom_aggregation_units"),
                });
            case "reply_message":
                return bot.replyMessage(
                    requireString(params, "reply_token"),
                    requireMessages(params),
                    optionalBoolean(params, "notification_disabled"),
                );
            case "multicast":
                return client.multicast(
                    {
                        to: requireStringArray(params, "to"),
                        messages: requireMessages(params),
                        notificationDisabled: optionalBoolean(params, "notification_disabled"),
                        customAggregationUnits: optionalStringArray(
                            params,
                            "custom_aggregation_units",
                        ),
                    },
                    optionalString(params, "retry_key"),
                );
            case "broadcast":
                return client.broadcast(
                    {
                        messages: requireMessages(params),
                        notificationDisabled: optionalBoolean(params, "notification_disabled"),
                    },
                    optionalString(params, "retry_key"),
                );
            case "narrowcast":
                return client.narrowcast(
                    requireRecord(params, "request") as messagingApi.NarrowcastRequest,
                    optionalString(params, "retry_key"),
                );
            case "get_narrowcast_progress":
                return client.getNarrowcastProgress(requireString(params, "request_id"));
            case "validate_push":
                return client.validatePush({ messages: requireMessages(params) });
            case "validate_reply":
                return client.validateReply({ messages: requireMessages(params) });
            case "validate_multicast":
                return client.validateMulticast({ messages: requireMessages(params) });
            case "validate_broadcast":
                return client.validateBroadcast({ messages: requireMessages(params) });
            case "validate_narrowcast":
                return client.validateNarrowcast({ messages: requireMessages(params) });
            case "push_messages_by_phone":
                return client.pushMessagesByPhone(
                    requireRecord(params, "request") as messagingApi.PnpMessagesRequest,
                    optionalString(params, "delivery_tag"),
                );
            case "show_loading_animation":
                return client.showLoadingAnimation({
                    chatId: requireString(params, "chat_id"),
                    loadingSeconds: optionalNumber(params, "loading_seconds"),
                });
            case "mark_messages_as_read":
                return client.markMessagesAsRead({
                    chat: { userId: requireString(params, "user_id") },
                });
            case "mark_messages_as_read_by_token":
                return client.markMessagesAsReadByToken({
                    markAsReadToken: requireString(params, "mark_as_read_token"),
                });
            case "get_message_content":
                return streamResult(
                    await client.getMessageContent(requireString(params, "message_id")),
                );
            case "get_message_content_preview":
                return streamResult(
                    await client.getMessageContentPreview(requireString(params, "message_id")),
                );
            case "get_message_content_transcoding":
                return client.getMessageContentTranscodingByMessageId(
                    requireString(params, "message_id"),
                );
            case "issue_link_token":
                return client.issueLinkToken(requireString(params, "user_id"));
            case "get_followers":
                return client.getFollowers(
                    optionalString(params, "start"),
                    optionalNumber(params, "limit"),
                );
            case "get_room_member_count":
                return client.getRoomMemberCount(requireString(params, "room_id"));
            case "get_room_member_profile":
                return client.getRoomMemberProfile(
                    requireString(params, "room_id"),
                    requireString(params, "user_id"),
                );
            case "get_room_member_list":
                return listRoomMembers(client, params);
            case "get_message_quota":
                return client.getMessageQuota();
            case "get_message_quota_consumption":
                return client.getMessageQuotaConsumption();
            case "get_number_of_sent_reply_messages":
                return client.getNumberOfSentReplyMessages(requireString(params, "date"));
            case "get_number_of_sent_push_messages":
                return client.getNumberOfSentPushMessages(requireString(params, "date"));
            case "get_number_of_sent_multicast_messages":
                return client.getNumberOfSentMulticastMessages(requireString(params, "date"));
            case "get_number_of_sent_broadcast_messages":
                return client.getNumberOfSentBroadcastMessages(requireString(params, "date"));
            case "get_phone_message_statistics":
                return client.getPNPMessageStatistics(requireString(params, "date"));
            case "get_aggregation_unit_name_list":
                return client.getAggregationUnitNameList(
                    optionalString(params, "limit"),
                    optionalString(params, "start"),
                );
            case "get_aggregation_unit_usage":
                return client.getAggregationUnitUsage();
            case "get_webhook_endpoint":
                return client.getWebhookEndpoint();
            case "set_webhook_endpoint":
                return client.setWebhookEndpoint({ endpoint: requireHttpsUrl(params, "endpoint") });
            case "test_webhook_endpoint":
                return client.testWebhookEndpoint(
                    params.endpoint ? { endpoint: requireHttpsUrl(params, "endpoint") } : undefined,
                );
            case "create_rich_menu":
                return client.createRichMenu(
                    requireRecord(params, "rich_menu") as messagingApi.RichMenuRequest,
                );
            case "get_rich_menu":
                return client.getRichMenu(requireString(params, "rich_menu_id"));
            case "list_rich_menus":
                return client.getRichMenuList();
            case "delete_rich_menu":
                return client.deleteRichMenu(requireString(params, "rich_menu_id"));
            case "set_rich_menu_image":
                return client.setRichMenuImage(
                    requireString(params, "rich_menu_id"),
                    base64Blob(params),
                );
            case "get_rich_menu_image":
                return streamResult(
                    await client.getRichMenuImage(requireString(params, "rich_menu_id")),
                );
            case "validate_rich_menu":
                return client.validateRichMenuObject(
                    requireRecord(params, "rich_menu") as messagingApi.RichMenuRequest,
                );
            case "get_default_rich_menu":
                return client.getDefaultRichMenuId();
            case "set_default_rich_menu":
                return client.setDefaultRichMenu(requireString(params, "rich_menu_id"));
            case "cancel_default_rich_menu":
                return client.cancelDefaultRichMenu();
            case "link_rich_menu_to_user":
                return client.linkRichMenuIdToUser(
                    requireString(params, "user_id"),
                    requireString(params, "rich_menu_id"),
                );
            case "unlink_rich_menu_from_user":
                return client.unlinkRichMenuIdFromUser(requireString(params, "user_id"));
            case "get_user_rich_menu":
                return client.getRichMenuIdOfUser(requireString(params, "user_id"));
            case "link_rich_menu_to_users":
                return client.linkRichMenuIdToUsers(
                    requireRecord(params, "request") as messagingApi.RichMenuBulkLinkRequest,
                );
            case "unlink_rich_menu_from_users":
                return client.unlinkRichMenuIdFromUsers(
                    requireRecord(params, "request") as messagingApi.RichMenuBulkUnlinkRequest,
                );
            case "create_rich_menu_alias":
                return client.createRichMenuAlias({
                    richMenuAliasId: requireString(params, "alias_id"),
                    richMenuId: requireString(params, "rich_menu_id"),
                });
            case "get_rich_menu_alias":
                return client.getRichMenuAlias(requireString(params, "alias_id"));
            case "list_rich_menu_aliases":
                return client.getRichMenuAliasList();
            case "update_rich_menu_alias":
                return client.updateRichMenuAlias(requireString(params, "alias_id"), {
                    richMenuId: requireString(params, "rich_menu_id"),
                });
            case "delete_rich_menu_alias":
                return client.deleteRichMenuAlias(requireString(params, "alias_id"));
            case "rich_menu_batch":
                return client.richMenuBatch(
                    requireRecord(params, "request") as messagingApi.RichMenuBatchRequest,
                );
            case "validate_rich_menu_batch":
                return client.validateRichMenuBatchRequest(
                    requireRecord(params, "request") as messagingApi.RichMenuBatchRequest,
                );
            case "get_rich_menu_batch_progress":
                return client.getRichMenuBatchProgress(requireString(params, "request_id"));
            case "create_coupon":
                return client.createCoupon(
                    params.coupon
                        ? (requireRecord(params, "coupon") as messagingApi.CouponCreateRequest)
                        : undefined,
                );
            case "get_coupon":
                return client.getCouponDetail(requireString(params, "coupon_id"));
            case "list_coupons":
                return client.listCoupon(
                    couponStatuses(params),
                    optionalString(params, "start"),
                    optionalNumber(params, "limit"),
                );
            case "close_coupon":
                return client.closeCoupon(requireString(params, "coupon_id"));
            case "get_membership_list":
                return client.getMembershipList();
            case "get_membership_subscription":
                return client.getMembershipSubscription(requireString(params, "user_id"));
            case "get_joined_membership_users":
                return client.getJoinedMembershipUsers(
                    requireInteger(params, "membership_id"),
                    optionalString(params, "start"),
                    optionalNumber(params, "limit"),
                );
            case "get_number_of_followers":
                return client.getNumberOfFollowers(optionalString(params, "date"));
            case "get_friends_demographics":
                return client.getFriendsDemographics();
            case "get_number_of_message_deliveries":
                return client.getNumberOfMessageDeliveries(requireString(params, "date"));
            case "get_message_event":
                return client.getMessageEvent(requireString(params, "request_id"));
            case "get_statistics_per_unit":
                return client.getStatisticsPerUnit(
                    requireString(params, "unit"),
                    requireString(params, "from"),
                    requireString(params, "to"),
                );
            case "get_rich_menu_insight_summary":
                return client.getRichMenuInsightSummary(
                    requireString(params, "rich_menu_id"),
                    requireString(params, "from"),
                    requireString(params, "to"),
                );
            case "get_rich_menu_insight_daily":
                return client.getRichMenuInsightDaily(
                    requireString(params, "rich_menu_id"),
                    requireString(params, "from"),
                    requireString(params, "to"),
                );
            default:
                throw new LineApiError(`未实现 LINE 平台动作: ${action}`, {
                    code: "LINE_ACTION_NOT_IMPLEMENTED",
                });
        }
    } catch (error) {
        throw LineApiError.wrap(error, `LINE_${action.toUpperCase()}_ERROR`);
    }
}

async function listRoomMembers(
    client: ReturnType<LineBot["getClient"]>,
    params: Readonly<Record<string, unknown>>,
): Promise<string[]> {
    const roomId = requireString(params, "room_id");
    const members: string[] = [];
    let start = optionalString(params, "start");
    do {
        const page = await client.getRoomMembersIds(roomId, start);
        members.push(...page.memberIds);
        start = page.next;
    } while (start);
    return members;
}
