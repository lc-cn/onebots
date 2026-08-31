import type { SlackUser } from "./types.js";

/** Slack 的显示名位于 profile；保留顶层字段以接收部分事件的精简用户模型。 */
export function slackUserDisplayName(user: SlackUser | null | undefined): string {
    return (
        user?.profile?.display_name ||
        user?.profile?.real_name ||
        user?.display_name ||
        user?.real_name ||
        user?.name ||
        ""
    );
}
