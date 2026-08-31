import { describe, expect, it } from "vitest";
import { AdapterRegistry } from "../../packages/core/src/registry.js";
import { assertSchemaFormContract } from "../../packages/core/src/config-validator.js";
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

describe("adapter config schemas", () => {
    const schemas = AdapterRegistry.getAllSchemas();

    it("所有适配器都从包入口注册 Schema", () => {
        expect(Object.keys(schemas).sort()).toEqual(platforms);
    });

    it.each(Object.entries(schemas))("%s 的字段具备完整 Web 表单语义", (_, schema) => {
        expect(() => assertSchemaFormContract(schema)).not.toThrow();
    });
});
