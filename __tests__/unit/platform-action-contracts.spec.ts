import { describe, expect, it } from "vitest";
import { Adapter } from "../../packages/core/src/adapter.js";
import { listSupportedActions } from "../../packages/core/src/adapter-capability.js";
import { DingTalkAdapter } from "../../adapters/adapter-dingtalk/src/adapter.js";
import { dingTalkCapabilities } from "../../adapters/adapter-dingtalk/src/capabilities.js";
import { DINGTALK_PLATFORM_ACTIONS } from "../../adapters/adapter-dingtalk/src/platform-actions.js";
import { DiscordAdapter } from "../../adapters/adapter-discord/src/adapter.js";
import { discordCapabilities } from "../../adapters/adapter-discord/src/capabilities.js";
import { DISCORD_PLATFORM_ACTIONS } from "../../adapters/adapter-discord/src/platform-actions.js";
import { EmailAdapter } from "../../adapters/adapter-email/src/adapter.js";
import { emailCapabilities } from "../../adapters/adapter-email/src/capabilities.js";
import { EMAIL_PLATFORM_ACTIONS } from "../../adapters/adapter-email/src/platform-actions.js";
import { FeishuAdapter } from "../../adapters/adapter-feishu/src/adapter.js";
import { feishuCapabilities } from "../../adapters/adapter-feishu/src/capabilities.js";
import { FEISHU_PLATFORM_ACTIONS } from "../../adapters/adapter-feishu/src/platform-actions.js";
import { HeychatAdapter } from "../../adapters/adapter-heychat/src/adapter.js";
import { heychatCapabilities } from "../../adapters/adapter-heychat/src/capabilities.js";
import { HEYCHAT_PLATFORM_ACTIONS } from "../../adapters/adapter-heychat/src/platform-actions.js";
import { ICQQAdapter } from "../../adapters/adapter-icqq/src/adapter.js";
import { icqqCapabilities } from "../../adapters/adapter-icqq/src/capabilities.js";
import { ICQQ_PLATFORM_ACTIONS } from "../../adapters/adapter-icqq/src/platform-actions.js";
import { KookAdapter } from "../../adapters/adapter-kook/src/adapter.js";
import { kookCapabilities } from "../../adapters/adapter-kook/src/capabilities.js";
import { KOOK_PLATFORM_ACTIONS } from "../../adapters/adapter-kook/src/platform-actions.js";
import { LineAdapter } from "../../adapters/adapter-line/src/adapter.js";
import { lineCapabilities } from "../../adapters/adapter-line/src/capabilities.js";
import { LINE_PLATFORM_ACTIONS } from "../../adapters/adapter-line/src/platform-actions.js";
import { MockAdapter } from "../../adapters/adapter-mock/src/adapter.js";
import { mockCapabilities } from "../../adapters/adapter-mock/src/capabilities.js";
import { QQAdapter } from "../../adapters/adapter-qq/src/adapter.js";
import { qqCapabilities } from "../../adapters/adapter-qq/src/capabilities.js";
import { QQ_PLATFORM_ACTIONS } from "../../adapters/adapter-qq/src/platform-actions.js";
import { SlackAdapter } from "../../adapters/adapter-slack/src/adapter.js";
import { slackCapabilities } from "../../adapters/adapter-slack/src/capabilities.js";
import { SLACK_PLATFORM_ACTIONS } from "../../adapters/adapter-slack/src/platform-actions.js";
import { TeamsAdapter } from "../../adapters/adapter-teams/src/adapter.js";
import { teamsCapabilities } from "../../adapters/adapter-teams/src/capabilities.js";
import { TEAMS_PLATFORM_ACTIONS } from "../../adapters/adapter-teams/src/platform-actions.js";
import { TelegramAdapter } from "../../adapters/adapter-telegram/src/adapter.js";
import { telegramCapabilities } from "../../adapters/adapter-telegram/src/capabilities.js";
import { TELEGRAM_PLATFORM_ACTIONS } from "../../adapters/adapter-telegram/src/platform-actions.js";
import { WechatClawbotAdapter } from "../../adapters/adapter-wechat-clawbot/src/adapter.js";
import { wechatClawbotCapabilities } from "../../adapters/adapter-wechat-clawbot/src/capabilities.js";
import { WECHAT_CLAWBOT_PLATFORM_ACTIONS } from "../../adapters/adapter-wechat-clawbot/src/platform-actions.js";
import { WechatAdapter } from "../../adapters/adapter-wechat/src/adapter.js";
import { wechatCapabilities } from "../../adapters/adapter-wechat/src/capabilities.js";
import { WECHAT_PLATFORM_ACTIONS } from "../../adapters/adapter-wechat/src/platform-actions.js";
import { WeComKfAdapter } from "../../adapters/adapter-wecom-kf/src/adapter.js";
import { weComKfCapabilities } from "../../adapters/adapter-wecom-kf/src/capabilities.js";
import { WECOM_KF_PLATFORM_ACTIONS } from "../../adapters/adapter-wecom-kf/src/platform-actions.js";
import { WeComAdapter } from "../../adapters/adapter-wecom/src/adapter.js";
import { weComCapabilities } from "../../adapters/adapter-wecom/src/capabilities.js";
import { WECOM_PLATFORM_ACTIONS } from "../../adapters/adapter-wecom/src/platform-actions.js";
import { WhatsAppAdapter } from "../../adapters/adapter-whatsapp/src/adapter.js";
import { whatsAppCapabilities } from "../../adapters/adapter-whatsapp/src/capabilities.js";
import { WHATSAPP_PLATFORM_ACTIONS } from "../../adapters/adapter-whatsapp/src/platform-actions.js";
import { ZulipAdapter } from "../../adapters/adapter-zulip/src/adapter.js";
import { zulipCapabilities } from "../../adapters/adapter-zulip/src/capabilities.js";
import { ZULIP_PLATFORM_ACTIONS } from "../../adapters/adapter-zulip/src/platform-actions.js";

const contracts = [
    ["dingtalk", DingTalkAdapter.prototype, dingTalkCapabilities],
    ["discord", DiscordAdapter.prototype, discordCapabilities],
    ["email", EmailAdapter.prototype, emailCapabilities],
    ["feishu", FeishuAdapter.prototype, feishuCapabilities],
    ["heychat", HeychatAdapter.prototype, heychatCapabilities],
    ["icqq", ICQQAdapter.prototype, icqqCapabilities],
    ["kook", KookAdapter.prototype, kookCapabilities],
    ["line", LineAdapter.prototype, lineCapabilities],
    ["mock", MockAdapter.prototype, mockCapabilities],
    ["qq", QQAdapter.prototype, qqCapabilities],
    ["slack", SlackAdapter.prototype, slackCapabilities],
    ["teams", TeamsAdapter.prototype, teamsCapabilities],
    ["telegram", TelegramAdapter.prototype, telegramCapabilities],
    ["wechat-clawbot", WechatClawbotAdapter.prototype, wechatClawbotCapabilities],
    ["wechat", WechatAdapter.prototype, wechatCapabilities],
    ["wecom-kf", WeComKfAdapter.prototype, weComKfCapabilities],
    ["wecom", WeComAdapter.prototype, weComCapabilities],
    ["whatsapp", WhatsAppAdapter.prototype, whatsAppCapabilities],
    ["zulip", ZulipAdapter.prototype, zulipCapabilities],
] as const;

const platformActionContracts = [
    ["dingtalk", DINGTALK_PLATFORM_ACTIONS, dingTalkCapabilities],
    ["discord", DISCORD_PLATFORM_ACTIONS, discordCapabilities],
    ["email", EMAIL_PLATFORM_ACTIONS, emailCapabilities],
    ["feishu", FEISHU_PLATFORM_ACTIONS, feishuCapabilities],
    ["heychat", HEYCHAT_PLATFORM_ACTIONS, heychatCapabilities],
    ["icqq", ICQQ_PLATFORM_ACTIONS, icqqCapabilities],
    ["kook", KOOK_PLATFORM_ACTIONS, kookCapabilities],
    ["line", LINE_PLATFORM_ACTIONS, lineCapabilities],
    ["qq", QQ_PLATFORM_ACTIONS, qqCapabilities],
    ["slack", SLACK_PLATFORM_ACTIONS, slackCapabilities],
    ["teams", TEAMS_PLATFORM_ACTIONS, teamsCapabilities],
    ["telegram", TELEGRAM_PLATFORM_ACTIONS, telegramCapabilities],
    ["wechat-clawbot", WECHAT_CLAWBOT_PLATFORM_ACTIONS, wechatClawbotCapabilities],
    ["wechat", WECHAT_PLATFORM_ACTIONS, wechatCapabilities],
    ["wecom-kf", WECOM_KF_PLATFORM_ACTIONS, weComKfCapabilities],
    ["wecom", WECOM_PLATFORM_ACTIONS, weComCapabilities],
    ["whatsapp", WHATSAPP_PLATFORM_ACTIONS, whatsAppCapabilities],
    ["zulip", ZULIP_PLATFORM_ACTIONS, zulipCapabilities],
] as const;

describe("adapter action contracts", () => {
    it.each(contracts)("%s 声明支持的动作均有真实入口", (_, prototype, manifest) => {
        const missing = listSupportedActions(manifest).filter(
            action => !Adapter.prototype.isActionImplemented.call(prototype, action),
        );
        expect(missing).toEqual([]);
    });

    it.each(platformActionContracts)("%s 的平台动作均由能力清单公开", (_, actions, manifest) => {
        const missing = [...actions].filter(
            action => manifest.actions[action]?.support !== "native",
        );
        expect(missing).toEqual([]);
    });
});
