import { describe, expect, test } from "vitest";
import type { Schema, ValidationRule } from "@onebots/core";
import { getAppConfigSchema } from "./config-schema.js";

const ruleAt = (schema: Schema, key: string): ValidationRule => schema[key] as ValidationRule;

describe("protocol config schema", () => {
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
                ui: { widget: "endpoint-list" },
            });
        }
    });

    test("uses the OneBot 12 runtime key for HTTP webhooks", () => {
        const schema = schemaFor("onebot.v12");

        expect(schema.http_webhook).toBeDefined();
        expect(schema.webhooks).toBeUndefined();
    });
});

const schemaFor = (protocol: string): Schema => {
    const schema = getAppConfigSchema().protocols[protocol];
    if (!schema) throw new Error(`缺少协议 Schema：${protocol}`);
    return schema;
};
