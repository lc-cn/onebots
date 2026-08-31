import { definePlatformActions } from "onebots";
import type { QQClient } from "./client.js";
import { QQApiError } from "./errors.js";
import type { QQActionParams } from "./platform-action-context.js";
import { QQ_BOT_ACTIONS } from "./platform-actions-bot.js";
import { QQ_CHANNEL_ACTIONS } from "./platform-actions-channel.js";
import { QQ_GROUP_ACTIONS } from "./platform-actions-group.js";
import { QQ_GUILD_ACTIONS } from "./platform-actions-guild.js";

const ACTION_HANDLERS = {
    ...QQ_GROUP_ACTIONS,
    ...QQ_GUILD_ACTIONS,
    ...QQ_CHANNEL_ACTIONS,
    ...QQ_BOT_ACTIONS,
};

export type QQPlatformAction = Extract<keyof typeof ACTION_HANDLERS, string>;

const PLATFORM_ACTIONS = definePlatformActions(ACTION_HANDLERS, action =>
    QQApiError.invalid(`未知 QQ 平台动作: ${action}`, "QQ_UNKNOWN_ACTION", { action }),
);

export const QQ_PLATFORM_ACTIONS = PLATFORM_ACTIONS.actions;

export async function executeQQPlatformAction(
    client: QQClient,
    action: QQPlatformAction,
    params: QQActionParams,
): Promise<unknown> {
    return PLATFORM_ACTIONS.execute(client, action, params);
}
