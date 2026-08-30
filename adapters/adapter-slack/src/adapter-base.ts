import { Account, Adapter, BaseApp } from "onebots";
import { SlackBot } from "./bot.js";
import { slackCapabilities } from "./capabilities.js";
import { SlackError } from "./errors.js";
import { executeSlackPlatformAction, SLACK_PLATFORM_ACTIONS } from "./platform-actions.js";

/** Slack 各动作领域共享的平台调用与账号边界。 */
export abstract class SlackAdapterBase extends Adapter<SlackBot, "slack"> {
    constructor(app: BaseApp) {
        super(app, "slack", slackCapabilities);
        this.icon = "https://slack.com/favicon.ico";
    }

    executePlatformAction(
        uin: string,
        action: string,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        if (!SLACK_PLATFORM_ACTIONS.has(action)) {
            return super.executePlatformAction(uin, action, params);
        }
        return executeSlackPlatformAction(this.requireAccount(uin).client, action, params);
    }

    isPlatformActionImplemented(action: string): boolean {
        return SLACK_PLATFORM_ACTIONS.has(action);
    }

    protected requireAccount(uin: string): Account<"slack", SlackBot> {
        const account = this.getAccount(uin);
        if (!account) {
            throw SlackError.resource(`Slack 账号 ${uin} 不存在`, "SLACK_ACCOUNT_NOT_FOUND", {
                account_id: uin,
            });
        }
        return account;
    }
}
