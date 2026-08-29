import {
    optionalNumber,
    optionalString,
    requireInteger,
    requireString,
} from "./platform-action-params.js";
import type {
    LineActionContext,
    LineActionHandler,
    LineActionParams,
} from "./platform-action-context.js";

/** Membership、好友画像与消息 / Rich Menu 统计动作。 */
export const LINE_INSIGHT_ACTIONS = {
    get_membership_list: async ({ client }: LineActionContext) => client.getMembershipList(),
    get_membership_subscription: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.getMembershipSubscription(requireString(params, "user_id")),
    get_joined_membership_users: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.getJoinedMembershipUsers(
            requireInteger(params, "membership_id"),
            optionalString(params, "start"),
            optionalNumber(params, "limit"),
        ),
    get_number_of_followers: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.getNumberOfFollowers(optionalString(params, "date")),
    get_friends_demographics: async ({ client }: LineActionContext) =>
        client.getFriendsDemographics(),
    get_number_of_message_deliveries: async (
        { client }: LineActionContext,
        params: LineActionParams,
    ) => client.getNumberOfMessageDeliveries(requireString(params, "date")),
    get_message_event: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.getMessageEvent(requireString(params, "request_id")),
    get_statistics_per_unit: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.getStatisticsPerUnit(
            requireString(params, "unit"),
            requireString(params, "from"),
            requireString(params, "to"),
        ),
    get_rich_menu_insight_summary: async (
        { client }: LineActionContext,
        params: LineActionParams,
    ) =>
        client.getRichMenuInsightSummary(
            requireString(params, "rich_menu_id"),
            requireString(params, "from"),
            requireString(params, "to"),
        ),
    get_rich_menu_insight_daily: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.getRichMenuInsightDaily(
            requireString(params, "rich_menu_id"),
            requireString(params, "from"),
            requireString(params, "to"),
        ),
} satisfies Readonly<Record<string, LineActionHandler>>;
