import { describe, expect, test } from "vitest";
import { assertSchemaFormContract, type Schema, type ValidationRule } from "@onebots/core";
import { getAppConfigSchema } from "./config-schema.js";

const ruleAt = (schema: Schema, key: string): ValidationRule => schema[key] as ValidationRule;

describe("protocol config schema", () => {
    test("fallback 与基础配置也遵守统一表单契约", () => {
        const schema = getAppConfigSchema();
        expect(() => assertSchemaFormContract(schema.base)).not.toThrow();
        for (const protocol of Object.values(schema.protocols)) {
            expect(() => assertSchemaFormContract(protocol)).not.toThrow();
        }
    });

    test("publishes endpoint editor metadata for every reverse transport", () => {
        const schema = getAppConfigSchema();
        const cases = [
            ["onebot.v11", "http_reverse"],
            ["onebot.v11", "ws_reverse"],
            ["onebot.v12", "http_webhook"],
            ["onebot.v12", "ws_reverse"],
            ["milky.v1", "http_reverse"],
            ["milky.v1", "ws_reverse"],
            ["satori.v1", "webhooks"],
        ] as const;

        for (const [protocol, field] of cases) {
            const protocolSchema = schema.protocols[protocol];
            expect(ruleAt(protocolSchema, field)).toMatchObject({
                type: "array",
                ui: { widget: "endpoint-list", section: "delivery" },
            });
        }
    });

    test("uses the OneBot 12 runtime key for HTTP webhooks", () => {
        const schema = schemaFor("onebot.v12");

        expect(schema.http_webhook).toBeDefined();
        expect(schema.webhooks).toBeUndefined();
    });

    test("publishes a visual event filter contract for every event protocol", () => {
        for (const protocol of ["onebot.v11", "onebot.v12", "milky.v1", "satori.v1"]) {
            expect(ruleAt(schemaFor(protocol), "filters")).toMatchObject({
                type: "object",
                ui: {
                    widget: "event-filter",
                    section: "filter",
                    eventFields: expect.arrayContaining([
                        expect.objectContaining({ path: "type", label: "事件类别" }),
                    ]),
                },
            });
        }
    });

    test("declares form placement in the schema instead of relying on field names", () => {
        for (const protocol of ["onebot.v11", "onebot.v12", "milky.v1", "satori.v1"]) {
            const schema = schemaFor(protocol);
            expect(ruleAt(schema, "use_http").ui?.section).toBe("transport");
            expect(ruleAt(schema, "use_ws").ui?.section).toBe("transport");
        }

        expect(ruleAt(schemaFor("onebot.v11"), "access_token").ui?.section).toBe("credentials");
        expect(ruleAt(schemaFor("satori.v1"), "platform").ui?.section).toBe("credentials");
    });
});

const schemaFor = (protocol: string): Schema => {
    const schema = getAppConfigSchema().protocols[protocol];
    if (!schema) throw new Error(`缺少协议 Schema：${protocol}`);
    return schema;
};
