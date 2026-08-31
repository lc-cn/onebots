import type { messagingApi } from "@line/bot-sdk";
import {
    optionalBoolean,
    optionalNumber,
    optionalString,
    optionalStringArray,
    requireHttpsUrl,
    requireMessages,
    requireRecord,
    requireString,
    requireStringArray,
    streamResult,
} from "./platform-action-params.js";
import type {
    LineActionContext,
    LineActionHandler,
    LineActionParams,
} from "./platform-action-context.js";

/** 消息投递、内容读取、会话成员与 Webhook 管理动作。 */
export const LINE_MESSAGING_ACTIONS = {
    push_message: async ({ bot }: LineActionContext, params: LineActionParams) =>
        bot.pushMessage(requireString(params, "to"), requireMessages(params), {
            retryKey: optionalString(params, "retry_key"),
            notificationDisabled: optionalBoolean(params, "notification_disabled"),
            customAggregationUnits: optionalStringArray(params, "custom_aggregation_units"),
        }),
    reply_message: async ({ bot }: LineActionContext, params: LineActionParams) =>
        bot.replyMessage(
            requireString(params, "reply_token"),
            requireMessages(params),
            optionalBoolean(params, "notification_disabled"),
        ),
    multicast: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.multicast(
            {
                to: requireStringArray(params, "to"),
                messages: requireMessages(params),
                notificationDisabled: optionalBoolean(params, "notification_disabled"),
                customAggregationUnits: optionalStringArray(params, "custom_aggregation_units"),
            },
            optionalString(params, "retry_key"),
        ),
    broadcast: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.broadcast(
            {
                messages: requireMessages(params),
                notificationDisabled: optionalBoolean(params, "notification_disabled"),
            },
            optionalString(params, "retry_key"),
        ),
    narrowcast: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.narrowcast(
            requireRecord(params, "request") as messagingApi.NarrowcastRequest,
            optionalString(params, "retry_key"),
        ),
    get_narrowcast_progress: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.getNarrowcastProgress(requireString(params, "request_id")),
    validate_push: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.validatePush({ messages: requireMessages(params) }),
    validate_reply: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.validateReply({ messages: requireMessages(params) }),
    validate_multicast: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.validateMulticast({ messages: requireMessages(params) }),
    validate_broadcast: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.validateBroadcast({ messages: requireMessages(params) }),
    validate_narrowcast: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.validateNarrowcast({ messages: requireMessages(params) }),
    push_messages_by_phone: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.pushMessagesByPhone(
            requireRecord(params, "request") as messagingApi.PnpMessagesRequest,
            optionalString(params, "delivery_tag"),
        ),
    show_loading_animation: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.showLoadingAnimation({
            chatId: requireString(params, "chat_id"),
            loadingSeconds: optionalNumber(params, "loading_seconds"),
        }),
    mark_messages_as_read: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.markMessagesAsRead({ chat: { userId: requireString(params, "user_id") } }),
    mark_messages_as_read_by_token: async (
        { client }: LineActionContext,
        params: LineActionParams,
    ) =>
        client.markMessagesAsReadByToken({
            markAsReadToken: requireString(params, "mark_as_read_token"),
        }),
    get_message_content: async ({ client }: LineActionContext, params: LineActionParams) =>
        streamResult(await client.getMessageContent(requireString(params, "message_id"))),
    get_message_content_preview: async ({ client }: LineActionContext, params: LineActionParams) =>
        streamResult(await client.getMessageContentPreview(requireString(params, "message_id"))),
    get_message_content_transcoding: async (
        { client }: LineActionContext,
        params: LineActionParams,
    ) => client.getMessageContentTranscodingByMessageId(requireString(params, "message_id")),
    issue_link_token: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.issueLinkToken(requireString(params, "user_id")),
    get_followers: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.getFollowers(optionalString(params, "start"), optionalNumber(params, "limit")),
    get_room_member_count: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.getRoomMemberCount(requireString(params, "room_id")),
    get_room_member_profile: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.getRoomMemberProfile(
            requireString(params, "room_id"),
            requireString(params, "user_id"),
        ),
    get_room_member_list: listRoomMembers,
    get_message_quota: async ({ client }: LineActionContext) => client.getMessageQuota(),
    get_message_quota_consumption: async ({ client }: LineActionContext) =>
        client.getMessageQuotaConsumption(),
    get_number_of_sent_reply_messages: async (
        { client }: LineActionContext,
        params: LineActionParams,
    ) => client.getNumberOfSentReplyMessages(requireString(params, "date")),
    get_number_of_sent_push_messages: async (
        { client }: LineActionContext,
        params: LineActionParams,
    ) => client.getNumberOfSentPushMessages(requireString(params, "date")),
    get_number_of_sent_multicast_messages: async (
        { client }: LineActionContext,
        params: LineActionParams,
    ) => client.getNumberOfSentMulticastMessages(requireString(params, "date")),
    get_number_of_sent_broadcast_messages: async (
        { client }: LineActionContext,
        params: LineActionParams,
    ) => client.getNumberOfSentBroadcastMessages(requireString(params, "date")),
    get_phone_message_statistics: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.getPNPMessageStatistics(requireString(params, "date")),
    get_aggregation_unit_name_list: async (
        { client }: LineActionContext,
        params: LineActionParams,
    ) =>
        client.getAggregationUnitNameList(
            optionalString(params, "limit"),
            optionalString(params, "start"),
        ),
    get_aggregation_unit_usage: async ({ client }: LineActionContext) =>
        client.getAggregationUnitUsage(),
    get_webhook_endpoint: async ({ client }: LineActionContext) => client.getWebhookEndpoint(),
    set_webhook_endpoint: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.setWebhookEndpoint({ endpoint: requireHttpsUrl(params, "endpoint") }),
    test_webhook_endpoint: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.testWebhookEndpoint(
            params.endpoint ? { endpoint: requireHttpsUrl(params, "endpoint") } : undefined,
        ),
} satisfies Readonly<Record<string, LineActionHandler>>;

async function listRoomMembers(
    { client }: LineActionContext,
    params: LineActionParams,
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
