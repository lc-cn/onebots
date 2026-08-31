import { definePlatformActions } from "onebots";
import type { TeamsBot } from "./bot.js";
import { TeamsApiError } from "./errors.js";
import type { TeamsActionParams } from "./platform-action-params.js";
import { TEAMS_CONVERSATION_ACTIONS } from "./platform-actions-conversation.js";
import { TEAMS_GRAPH_ACTIONS } from "./platform-actions-graph.js";
import { TEAMS_OAUTH_ACTIONS } from "./platform-actions-oauth.js";

const PLATFORM_ACTIONS = definePlatformActions(
    {
        ...TEAMS_CONVERSATION_ACTIONS,
        ...TEAMS_OAUTH_ACTIONS,
        ...TEAMS_GRAPH_ACTIONS,
    },
    action =>
        TeamsApiError.invalid(`未实现 Teams 平台动作: ${action}`, "TEAMS_ACTION_UNSUPPORTED", {
            action,
        }),
);

export const TEAMS_PLATFORM_ACTIONS = PLATFORM_ACTIONS.actions;
export type TeamsPlatformAction =
    typeof TEAMS_PLATFORM_ACTIONS extends ReadonlySet<infer T> ? T : never;

/** 执行 Microsoft Teams Connector 与 Graph 的显式平台动作。 */
export async function executeTeamsPlatformAction(
    bot: TeamsBot,
    action: string,
    params: TeamsActionParams,
): Promise<unknown> {
    return PLATFORM_ACTIONS.execute(bot, action, params);
}
