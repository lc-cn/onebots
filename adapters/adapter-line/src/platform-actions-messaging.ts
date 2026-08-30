import { collectCursorPages } from "./cursor-pages.js";
import {
    aggregationLimit,
    customAggregationUnits,
    followersLimit,
    loadingSeconds,
    multicastRecipients,
    narrowcastRequest,
    optionalRetryKey,
    pnpMessagesRequest,
    requireLineDate,
} from "./messaging-action-params.js";
import {
    optionalBoolean,
    optionalString,
    requireHttpsUrl,
    requireMessages,
    requireString,
    streamResult,
} from "./platform-action-params.js";
import {
    lineAction,
    type LineActionContext,
    type LineActionHandler,
} from "./platform-action-context.js";

/** 消息投递、内容读取、会话成员与 Webhook 管理动作。 */
export const LINE_MESSAGING_ACTIONS = {
    push_message: lineAction(
        ["to", "messages", "retry_key", "notification_disabled", "custom_aggregation_units"],
        async ({ bot }, params) =>
            bot.pushMessage(requireString(params, "to"), requireMessages(params), {
                retryKey: optionalRetryKey(params),
                notificationDisabled: optionalBoolean(params, "notification_disabled"),
                customAggregationUnits: customAggregationUnits(params),
            }),
    ),
    reply_message: lineAction(
        ["reply_token", "messages", "notification_disabled"],
        async ({ bot }, params) =>
            bot.replyMessage(
                requireString(params, "reply_token"),
                requireMessages(params),
                optionalBoolean(params, "notification_disabled"),
            ),
    ),
    multicast: lineAction(
        ["to", "messages", "notification_disabled", "custom_aggregation_units", "retry_key"],
        async ({ client }, params) =>
            client.multicast(
                {
                    to: multicastRecipients(params),
                    messages: requireMessages(params),
                    notificationDisabled: optionalBoolean(params, "notification_disabled"),
                    customAggregationUnits: customAggregationUnits(params),
                },
                optionalRetryKey(params),
            ),
    ),
    broadcast: lineAction(
        ["messages", "notification_disabled", "retry_key"],
        async ({ client }, params) =>
            client.broadcast(
                {
                    messages: requireMessages(params),
                    notificationDisabled: optionalBoolean(params, "notification_disabled"),
                },
                optionalRetryKey(params),
            ),
    ),
    narrowcast: lineAction(["request", "retry_key"], async ({ client }, params) =>
        client.narrowcast(narrowcastRequest(params), optionalRetryKey(params)),
    ),
    get_narrowcast_progress: lineAction(["request_id"], async ({ client }, params) =>
        client.getNarrowcastProgress(requireString(params, "request_id")),
    ),
    validate_push: lineAction(["messages"], async ({ client }, params) =>
        client.validatePush({ messages: requireMessages(params) }),
    ),
    validate_reply: lineAction(["messages"], async ({ client }, params) =>
        client.validateReply({ messages: requireMessages(params) }),
    ),
    validate_multicast: lineAction(["messages"], async ({ client }, params) =>
        client.validateMulticast({ messages: requireMessages(params) }),
    ),
    validate_broadcast: lineAction(["messages"], async ({ client }, params) =>
        client.validateBroadcast({ messages: requireMessages(params) }),
    ),
    validate_narrowcast: lineAction(["messages"], async ({ client }, params) =>
        client.validateNarrowcast({ messages: requireMessages(params) }),
    ),
    push_messages_by_phone: lineAction(["request", "delivery_tag"], async ({ client }, params) =>
        client.pushMessagesByPhone(
            pnpMessagesRequest(params),
            optionalString(params, "delivery_tag"),
        ),
    ),
    show_loading_animation: lineAction(["chat_id", "loading_seconds"], async ({ client }, params) =>
        client.showLoadingAnimation({
            chatId: requireString(params, "chat_id"),
            loadingSeconds: loadingSeconds(params),
        }),
    ),
    mark_messages_as_read: lineAction(["user_id"], async ({ client }, params) =>
        client.markMessagesAsRead({ chat: { userId: requireString(params, "user_id") } }),
    ),
    mark_messages_as_read_by_token: lineAction(["mark_as_read_token"], async ({ client }, params) =>
        client.markMessagesAsReadByToken({
            markAsReadToken: requireString(params, "mark_as_read_token"),
        }),
    ),
    get_message_content: lineAction(["message_id"], async ({ client }, params) =>
        streamResult(await client.getMessageContent(requireString(params, "message_id"))),
    ),
    get_message_content_preview: lineAction(["message_id"], async ({ client }, params) =>
        streamResult(await client.getMessageContentPreview(requireString(params, "message_id"))),
    ),
    get_message_content_transcoding: lineAction(["message_id"], async ({ client }, params) =>
        client.getMessageContentTranscodingByMessageId(requireString(params, "message_id")),
    ),
    issue_link_token: lineAction(["user_id"], async ({ client }, params) =>
        client.issueLinkToken(requireString(params, "user_id")),
    ),
    get_followers: lineAction(["start", "limit"], async ({ client }, params) =>
        client.getFollowers(optionalString(params, "start"), followersLimit(params)),
    ),
    get_room_member_count: lineAction(["room_id"], async ({ client }, params) =>
        client.getRoomMemberCount(requireString(params, "room_id")),
    ),
    get_room_member_profile: lineAction(["room_id", "user_id"], async ({ client }, params) =>
        client.getRoomMemberProfile(
            requireString(params, "room_id"),
            requireString(params, "user_id"),
        ),
    ),
    get_room_member_list: lineAction(["room_id", "start"], listRoomMembers),
    get_message_quota: lineAction([], async ({ client }) => client.getMessageQuota()),
    get_message_quota_consumption: lineAction([], async ({ client }) =>
        client.getMessageQuotaConsumption(),
    ),
    get_number_of_sent_reply_messages: lineAction(["date"], async ({ client }, params) =>
        client.getNumberOfSentReplyMessages(requireLineDate(params)),
    ),
    get_number_of_sent_push_messages: lineAction(["date"], async ({ client }, params) =>
        client.getNumberOfSentPushMessages(requireLineDate(params)),
    ),
    get_number_of_sent_multicast_messages: lineAction(["date"], async ({ client }, params) =>
        client.getNumberOfSentMulticastMessages(requireLineDate(params)),
    ),
    get_number_of_sent_broadcast_messages: lineAction(["date"], async ({ client }, params) =>
        client.getNumberOfSentBroadcastMessages(requireLineDate(params)),
    ),
    get_phone_message_statistics: lineAction(["date"], async ({ client }, params) =>
        client.getPNPMessageStatistics(requireLineDate(params)),
    ),
    get_aggregation_unit_name_list: lineAction(["limit", "start"], async ({ client }, params) =>
        client.getAggregationUnitNameList(
            aggregationLimit(params),
            optionalString(params, "start"),
        ),
    ),
    get_aggregation_unit_usage: lineAction([], async ({ client }) =>
        client.getAggregationUnitUsage(),
    ),
    get_webhook_endpoint: lineAction([], async ({ client }) => client.getWebhookEndpoint()),
    set_webhook_endpoint: lineAction(["endpoint"], async ({ client }, params) =>
        client.setWebhookEndpoint({ endpoint: requireHttpsUrl(params, "endpoint") }),
    ),
    test_webhook_endpoint: lineAction(["endpoint"], async ({ client }, params) =>
        client.testWebhookEndpoint(
            params.endpoint === undefined
                ? undefined
                : { endpoint: requireHttpsUrl(params, "endpoint") },
        ),
    ),
} satisfies Readonly<Record<string, LineActionHandler>>;

async function listRoomMembers(
    { client }: LineActionContext,
    params: Readonly<Record<string, unknown>>,
): Promise<string[]> {
    const roomId = requireString(params, "room_id");
    return collectCursorPages(optionalString(params, "start"), async start => {
        const page = await client.getRoomMembersIds(roomId, start);
        return { items: page.memberIds, next: page.next };
    });
}
