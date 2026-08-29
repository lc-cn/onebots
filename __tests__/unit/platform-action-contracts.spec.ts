import { describe, expect, it } from "vitest";
import { FeishuAdapter } from "../../adapters/adapter-feishu/src/adapter.js";
import { FEISHU_PLATFORM_ACTIONS } from "../../adapters/adapter-feishu/src/platform-actions.js";
import { KookAdapter } from "../../adapters/adapter-kook/src/adapter.js";
import { KOOK_PLATFORM_ACTIONS } from "../../adapters/adapter-kook/src/platform-actions.js";
import { SlackAdapter } from "../../adapters/adapter-slack/src/adapter.js";
import { SLACK_PLATFORM_ACTIONS } from "../../adapters/adapter-slack/src/platform-actions.js";

const contracts = [
    ["feishu", FeishuAdapter.prototype, FEISHU_PLATFORM_ACTIONS],
    ["kook", KookAdapter.prototype, KOOK_PLATFORM_ACTIONS],
    ["slack", SlackAdapter.prototype, SLACK_PLATFORM_ACTIONS],
] as const;

describe("platform action contracts", () => {
    it.each(contracts)("%s 的扩展动作均接入统一能力检查", (_, adapter, actions) => {
        expect([...actions].every(action => adapter.isPlatformActionImplemented(action))).toBe(
            true,
        );
        expect(adapter.isPlatformActionImplemented("unknown_action")).toBe(false);
    });
});
