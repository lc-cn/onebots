import { Account, AccountStatus, Adapter, AdapterRegistry, readPackageVersion } from "onebots";
import { createSlackAccount } from "./account.js";
import { SlackBot } from "./bot.js";
import { slackCapabilities } from "./capabilities.js";
import { SlackDirectoryActions } from "./directory-actions.js";
import { deleteSlackFile, getSlackFile } from "./files.js";
import type { SlackConfig } from "./types.js";

/** Slack 文件、系统与账号装配入口；动作领域由父类分层实现。 */
export class SlackAdapter extends SlackDirectoryActions {
    async getFile(uin: string, params: Adapter.GetFileParams): Promise<Adapter.FileInfo> {
        return getSlackFile(this.requireAccount(uin).client, params.file_id.string, value =>
            this.createId(value),
        );
    }

    async deleteFile(uin: string, params: Adapter.DeleteFileParams): Promise<void> {
        await deleteSlackFile(this.requireAccount(uin).client, params.file_id.string);
    }

    async getVersion(_uin: string): Promise<Adapter.VersionInfo> {
        const [appVersion, sdkVersion] = await Promise.all([
            readPackageVersion(import.meta.url),
            readPackageVersion(import.meta.resolve("@slack/web-api")),
        ]);
        return {
            app_name: "onebots Slack Adapter",
            app_version: appVersion,
            impl: "@slack/web-api",
            version: sdkVersion,
        };
    }

    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const account = this.getAccount(uin);
        const online = account?.status === AccountStatus.Online;
        return {
            online,
            good: online,
            bots: account
                ? [{ self: this.createId(account.client.getCachedMe()?.id || uin), online }]
                : [],
        };
    }

    createAccount(config: Account.Config<"slack">): Account<"slack", SlackBot> {
        return createSlackAccount(this, config);
    }
}

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            slack: SlackConfig;
        }
    }
}

AdapterRegistry.register("slack", SlackAdapter, {
    name: "slack",
    displayName: "Slack官方机器人",
    description: "Slack官方机器人适配器，支持频道消息、私聊、应用命令",
    icon: "https://slack.com/favicon.ico",
    homepage: "https://slack.com/",
    author: "凉菜",
    capabilities: slackCapabilities,
});
