import { describe, expect, it } from "vitest";
import { AdapterRegistry } from "../../packages/core/src/registry.js";
import type { Schema, ValidationRule } from "../../packages/core/src/config-validator.js";
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

interface SchemaField {
    path: string;
    rule: ValidationRule;
}

describe("adapter config schemas", () => {
    const schemas = AdapterRegistry.getAllSchemas();

    it("所有适配器都从包入口注册 Schema", () => {
        expect(Object.keys(schemas).sort()).toEqual(platforms);
    });

    it.each(Object.entries(schemas))("%s 的字段具备完整 Web 表单语义", (_, schema) => {
        const fields = flattenSchema(schema);
        const fieldPaths = new Set(fields.map(field => field.path));

        for (const { path, rule } of fields) {
            expect(rule.label, `${path} 缺少 label`).toBeTruthy();
            expect(rule.ui?.section, `${path} 缺少 ui.section`).toBeTruthy();

            const visibility = rule.ui?.visibleWhen;
            if (visibility) {
                expect(fieldPaths.has(visibility.path), `${path} 引用了不存在的显示依赖`).toBe(
                    true,
                );
            }

            if (rule.ui?.widget === "endpoint-list" || rule.ui?.widget === "choice-list") {
                expect(rule.type, `${path} 的列表组件类型错误`).toBe("array");
            }
            if (rule.ui?.widget === "event-filter") {
                expect(rule.type, `${path} 的事件过滤组件类型错误`).toBe("object");
            }
            if (/(?:password|token|secret|private_key|encrypt_key|aes_key)$/i.test(path)) {
                expect(rule.sensitive, `${path} 应按敏感字段展示`).toBe(true);
            }
        }
    });
});

function flattenSchema(schema: Schema, prefix = ""): SchemaField[] {
    return Object.entries(schema).flatMap(([key, value]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        if (isRule(value)) return [{ path, rule: value }];
        return flattenSchema(value, path);
    });
}

function isRule(value: ValidationRule | Schema): value is ValidationRule {
    return (
        typeof value === "object" &&
        value !== null &&
        ("type" in value ||
            "required" in value ||
            "default" in value ||
            "validator" in value ||
            "transform" in value ||
            "label" in value)
    );
}
