/**
 * Discord 适配器
 * 轻量版实现，直接封装 Discord API
 */
import { Account, AdapterRegistry } from "onebots";
import { BaseApp } from "onebots";
import { DiscordBot } from "./bot.js";
import type { DiscordConfig } from "./types.js";
import { discordCapabilities } from "./capabilities.js";
import { createDiscordAccount } from "./account.js";
import { DiscordActionAdapter } from "./channel-actions.js";

export class DiscordAdapter extends DiscordActionAdapter {
    constructor(app: BaseApp) {
        super(app, "discord", discordCapabilities);
        this.icon =
            "https://assets-global.website-files.com/6257adef93867e50d84d30e2/636e0a6a49cf127bf92de1e2_icon_clyde_blurple_RGB.png";
    }

    createAccount(config: Account.Config<"discord">): Account<"discord", DiscordBot> {
        return createDiscordAccount(this, config);
    }
}

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            discord: DiscordConfig;
        }
    }
}

AdapterRegistry.register("discord", DiscordAdapter, {
    name: "discord",
    displayName: "Discord官方机器人",
    description: "Discord官方机器人适配器（轻量版），支持频道、群聊和私聊",
    icon: "https://assets-global.website-files.com/6257adef93867e50d84d30e2/636e0a6a49cf127bf92de1e2_icon_clyde_blurple_RGB.png",
    homepage: "https://discord.com/",
    author: "凉菜",
    capabilities: discordCapabilities,
});
