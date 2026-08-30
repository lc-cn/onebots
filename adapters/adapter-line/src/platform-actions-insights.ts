import {
    aggregationUnit,
    followerDate,
    membershipId,
    membershipLimit,
    requireLineDateRange,
} from "./insight-action-params.js";
import { requireLineDate } from "./messaging-action-params.js";
import { optionalString, requireString } from "./platform-action-params.js";
import { lineAction, type LineActionHandler } from "./platform-action-context.js";

/** Membership、好友画像与消息 / Rich Menu 统计动作。 */
export const LINE_INSIGHT_ACTIONS = {
    get_membership_list: lineAction([], async ({ client }) => client.getMembershipList()),
    get_membership_subscription: lineAction(["user_id"], async ({ client }, params) =>
        client.getMembershipSubscription(requireString(params, "user_id")),
    ),
    get_joined_membership_users: lineAction(
        ["membership_id", "start", "limit"],
        async ({ client }, params) =>
            client.getJoinedMembershipUsers(
                membershipId(params),
                optionalString(params, "start"),
                membershipLimit(params),
            ),
    ),
    get_number_of_followers: lineAction(["date"], async ({ client }, params) =>
        client.getNumberOfFollowers(followerDate(params)),
    ),
    get_friends_demographics: lineAction([], async ({ client }) =>
        client.getFriendsDemographics(),
    ),
    get_number_of_message_deliveries: lineAction(["date"], async ({ client }, params) =>
        client.getNumberOfMessageDeliveries(requireLineDate(params)),
    ),
    get_message_event: lineAction(["request_id"], async ({ client }, params) =>
        client.getMessageEvent(requireString(params, "request_id")),
    ),
    get_statistics_per_unit: lineAction(["unit", "from", "to"], async ({ client }, params) => {
        const [from, to] = requireLineDateRange(params, 30);
        return client.getStatisticsPerUnit(aggregationUnit(params), from, to);
    }),
    get_rich_menu_insight_summary: lineAction(
        ["rich_menu_id", "from", "to"],
        async ({ client }, params) => {
            const [from, to] = requireLineDateRange(params, 396);
            return client.getRichMenuInsightSummary(
                requireString(params, "rich_menu_id"),
                from,
                to,
            );
        },
    ),
    get_rich_menu_insight_daily: lineAction(
        ["rich_menu_id", "from", "to"],
        async ({ client }, params) => {
            const [from, to] = requireLineDateRange(params, 99);
            return client.getRichMenuInsightDaily(
                requireString(params, "rich_menu_id"),
                from,
                to,
            );
        },
    ),
} satisfies Readonly<Record<string, LineActionHandler>>;
