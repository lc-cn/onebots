import { describe, expect, test } from "vitest";
import { reactive } from "vue";
import {
    buildConfigGroups,
    parseStructuredFieldValue,
    resolveStructuredFieldDisplay,
} from "./utils.js";
import type { SchemaBundle, ValidationRule } from "./types.js";

const endpointRule: ValidationRule = {
    type: "array",
    default: [],
    label: "反向 WebSocket",
    ui: {
        widget: "endpoint-list",
        schemes: ["ws:", "wss:"],
        fields: [{ key: "access_token", label: "Access Token" }],
    },
};

const filterRule: ValidationRule = {
    type: "object",
    default: {},
    label: "事件过滤",
    ui: { widget: "event-filter" },
};

describe("config form generation", () => {
    test("splits protocol defaults and does not repeat account fields", () => {
        const bundle: SchemaBundle = {
            base: { port: { type: "number", label: "端口" } },
            general: {
                "onebot.v11": { use_http: { type: "boolean" } },
                "milky.v1": { ws_reverse: endpointRule },
            },
            protocols: {
                "onebot.v11": { use_http: { type: "boolean" } },
                "milky.v1": { ws_reverse: endpointRule },
            },
            adapters: { mock: { token: { type: "string" } } },
        };

        const groups = buildConfigGroups(bundle);

        expect(groups.map(group => group.key)).toEqual([
            "base",
            "general:onebot.v11",
            "general:milky.v1",
        ]);
        expect(groups.some(group => group.key.startsWith("account:"))).toBe(false);
    });

    test("keeps endpoint arrays structured for the dynamic editor", () => {
        const value = [{ url: "wss://events.example", access_token: "secret" }];

        expect(resolveStructuredFieldDisplay(value, endpointRule)).toEqual(value);
        expect(parseStructuredFieldValue(value, endpointRule, "反向 WebSocket")).toEqual({
            ok: true,
            value,
        });
    });

    test("copies reactive endpoint arrays without cloning Vue proxies", () => {
        const value = reactive([
            { url: "wss://events.example", access_token: "secret" },
        ]);

        expect(resolveStructuredFieldDisplay(value, endpointRule)).toEqual([
            { url: "wss://events.example", access_token: "secret" },
        ]);
    });

    test("keeps event filters structured and accepts advanced JSON", () => {
        const value = reactive({ $and: [{ type: "message" }] });

        expect(resolveStructuredFieldDisplay(value, filterRule)).toEqual(value);
        expect(parseStructuredFieldValue(value, filterRule, "事件过滤")).toEqual({
            ok: true,
            value: { $and: [{ type: "message" }] },
        });
        expect(
            parseStructuredFieldValue('{"type":"request"}', filterRule, "事件过滤"),
        ).toEqual({ ok: true, value: { type: "request" } });
    });

    test("removes blank rows and rejects the wrong URL scheme", () => {
        expect(
            parseStructuredFieldValue(["", "wss://events.example"], endpointRule, "连接"),
        ).toEqual({ ok: true, value: ["wss://events.example"] });
        expect(parseStructuredFieldValue(["https://events.example"], endpointRule, "连接")).toEqual(
            {
                ok: false,
                message: "字段 连接 仅支持 ws / wss",
            },
        );
    });
});
