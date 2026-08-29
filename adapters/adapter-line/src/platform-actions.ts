import { definePlatformActions } from "onebots";
import type { LineBot } from "./bot.js";
import { LineApiError } from "./errors.js";
import type { LineActionContext, LineActionParams } from "./platform-action-context.js";
import { LINE_INSIGHT_ACTIONS } from "./platform-actions-insights.js";
import { LINE_MESSAGING_ACTIONS } from "./platform-actions-messaging.js";
import { LINE_RICH_MENU_ACTIONS } from "./platform-actions-rich-menu.js";

const PLATFORM_ACTIONS = definePlatformActions(
    {
        ...LINE_MESSAGING_ACTIONS,
        ...LINE_RICH_MENU_ACTIONS,
        ...LINE_INSIGHT_ACTIONS,
    },
    action =>
        new LineApiError(`未实现 LINE 平台动作: ${action}`, {
            code: "LINE_ACTION_NOT_IMPLEMENTED",
            details: { action },
        }),
);

export const LINE_PLATFORM_ACTIONS = PLATFORM_ACTIONS.actions;
export type LinePlatformAction =
    typeof LINE_PLATFORM_ACTIONS extends ReadonlySet<infer T> ? T : never;

/** 执行经过显式白名单审计的 LINE 原生能力。 */
export async function executeLinePlatformAction(
    bot: LineBot,
    action: string,
    params: LineActionParams,
): Promise<unknown> {
    const context: LineActionContext = { bot, client: bot.getClient() };
    try {
        return await PLATFORM_ACTIONS.execute(context, action, params);
    } catch (error) {
        throw LineApiError.wrap(error, `LINE_${action.toUpperCase()}_ERROR`);
    }
}
