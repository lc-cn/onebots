import { describe, expect, it } from "vitest";
import { assertAdapterCapabilities } from "../../packages/core/src/adapter-capability.js";
import { dingTalkCapabilities } from "../../adapters/adapter-dingtalk/src/capabilities.js";
import { discordCapabilities } from "../../adapters/adapter-discord/src/capabilities.js";
import { emailCapabilities } from "../../adapters/adapter-email/src/capabilities.js";
import { feishuCapabilities } from "../../adapters/adapter-feishu/src/capabilities.js";
import { heychatCapabilities } from "../../adapters/adapter-heychat/src/capabilities.js";
import { icqqCapabilities } from "../../adapters/adapter-icqq/src/capabilities.js";
import { kookCapabilities } from "../../adapters/adapter-kook/src/capabilities.js";
import { lineCapabilities } from "../../adapters/adapter-line/src/capabilities.js";
import { mockCapabilities } from "../../adapters/adapter-mock/src/index.js";
import { qqCapabilities } from "../../adapters/adapter-qq/src/capabilities.js";
import { slackCapabilities } from "../../adapters/adapter-slack/src/capabilities.js";
import { teamsCapabilities } from "../../adapters/adapter-teams/src/capabilities.js";
import { telegramCapabilities } from "../../adapters/adapter-telegram/src/capabilities.js";
import { wechatClawbotCapabilities } from "../../adapters/adapter-wechat-clawbot/src/capabilities.js";
import { wechatCapabilities } from "../../adapters/adapter-wechat/src/capabilities.js";
import { weComKfCapabilities } from "../../adapters/adapter-wecom-kf/src/capabilities.js";
import { weComCapabilities } from "../../adapters/adapter-wecom/src/capabilities.js";
import { whatsAppCapabilities } from "../../adapters/adapter-whatsapp/src/capabilities.js";
import { zulipCapabilities } from "../../adapters/adapter-zulip/src/capabilities.js";

const manifests = {
    dingtalk: dingTalkCapabilities,
    discord: discordCapabilities,
    email: emailCapabilities,
    feishu: feishuCapabilities,
    heychat: heychatCapabilities,
    icqq: icqqCapabilities,
    kook: kookCapabilities,
    line: lineCapabilities,
    mock: mockCapabilities,
    qq: qqCapabilities,
    slack: slackCapabilities,
    teams: teamsCapabilities,
    telegram: telegramCapabilities,
    "wechat-clawbot": wechatClawbotCapabilities,
    wechat: wechatCapabilities,
    "wecom-kf": weComKfCapabilities,
    wecom: weComCapabilities,
    whatsapp: whatsAppCapabilities,
    zulip: zulipCapabilities,
};

describe("adapter capability manifests", () => {
    it.each(Object.entries(manifests))("%s 的清单可在运行时加载并通过校验", (_, manifest) => {
        expect(() => assertAdapterCapabilities(manifest)).not.toThrow();
    });
});
