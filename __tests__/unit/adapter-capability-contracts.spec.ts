import { describe, expect, it } from "vitest";
import {
    Adapter,
    assertAdapterCapabilities,
    isCanonicalAdapterAction,
    listSupportedActions,
} from "../../packages/core/src/index.js";
import { AdapterRegistry } from "../../packages/core/src/registry.js";
import "../../adapters/adapter-dingtalk/src/index.js";
import "../../adapters/adapter-discord/src/index.js";
import "../../adapters/adapter-email/src/index.js";
import "../../adapters/adapter-feishu/src/index.js";
import "../../adapters/adapter-heychat/src/index.js";
import "../../adapters/adapter-icqq/src/index.js";
import "../../adapters/adapter-kook/src/index.js";
import "../../adapters/adapter-line/src/index.js";
import "../../adapters/adapter-mock/src/index.js";
import "../../adapters/adapter-qq/src/index.js";
import "../../adapters/adapter-slack/src/index.js";
import "../../adapters/adapter-teams/src/index.js";
import "../../adapters/adapter-telegram/src/index.js";
import "../../adapters/adapter-wechat-clawbot/src/index.js";
import "../../adapters/adapter-wechat/src/index.js";
import "../../adapters/adapter-wecom-kf/src/index.js";
import "../../adapters/adapter-wecom/src/index.js";
import "../../adapters/adapter-whatsapp/src/index.js";
import "../../adapters/adapter-zulip/src/index.js";

const platforms = [
    "dingtalk",
    "discord",
    "email",
    "feishu",
    "heychat",
    "icqq",
    "kook",
    "line",
    "mock",
    "qq",
    "slack",
    "teams",
    "telegram",
    "wechat-clawbot",
    "wechat",
    "wecom-kf",
    "wecom",
    "whatsapp",
    "zulip",
].sort();

describe("adapter capability manifests", () => {
    const metadata = AdapterRegistry.getAllMetadata().sort((left, right) =>
        left.name.localeCompare(right.name),
    );
    const standardActions = [
        ...new Set(metadata.flatMap(item => Object.keys(item.capabilities?.actions ?? {}))),
    ].filter(isCanonicalAdapterAction);

    it("所有已注册适配器都公开同一份能力清单", () => {
        expect(metadata.map(item => item.name)).toEqual(platforms);
        for (const item of metadata) {
            expect(item.capabilities, item.name).toBeDefined();
            assertAdapterCapabilities(item.capabilities!);
        }
    });

    it.each(metadata)("$name 声明的动作都有真实入口", item => {
        const factory = AdapterRegistry.get(item.name);
        expect(factory, item.name).toBeDefined();
        expect(Adapter.isClassAdapter(factory), `${item.name} 必须使用可审计的适配器类`).toBe(true);
        if (!factory || !Adapter.isClassAdapter(factory) || !item.capabilities) return;

        const prototype = factory.prototype;
        for (const action of listSupportedActions(item.capabilities)) {
            expect(prototype.isActionImplemented(action), `${item.name}.${action}`).toBe(true);
        }
    });

    it.each(metadata)("$name 不保留能力清单之外的标准动作覆写", item => {
        const factory = AdapterRegistry.get(item.name);
        if (!factory || !Adapter.isClassAdapter(factory) || !item.capabilities) return;

        const prototype = factory.prototype;
        for (const action of standardActions) {
            const supported =
                item.capabilities.actions[action]?.support !== undefined &&
                item.capabilities.actions[action]?.support !== "unsupported";
            expect(prototype.isActionImplemented(action), `${item.name}.${action}`).toBe(supported);
        }
    });
});
