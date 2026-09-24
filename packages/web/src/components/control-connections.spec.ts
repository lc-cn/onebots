import type { ControlConfigurationSnapshot } from "@onebots/core/control";
import { describe, expect, it } from "vitest";
import { buildControlConnectionGuides, normalizeConnectionOrigin } from "./control-connections.js";

const snapshot: ControlConfigurationSnapshot = {
    base: { generationId: "generation", configRevision: "revision" },
    document: {
        general: { "onebot.v11": { use_http: true } },
        "icqq.123456": {
            "onebot.v11": { use_ws: true },
            "satori.v1": {},
            "milky.v1": {},
            "mcp.v1": {},
        },
    },
    schemas: {
        adapters: { icqq: {} },
        protocols: {
            "onebot.v11": {
                use_http: { type: "boolean", default: true },
                use_ws: { type: "boolean", default: false },
            },
            "satori.v1": {
                use_http: { type: "boolean", default: false },
                use_ws: { type: "boolean", default: true },
            },
            "milky.v1": {
                use_http: { type: "boolean", default: true },
                use_ws: { type: "boolean", default: false },
            },
            "mcp.v1": {},
        },
    },
    secretStates: [{ path: ["icqq.123456", "onebot.v11", "access_token"], configured: true }],
    unknownPaths: [],
};

describe("协议出口连接指引", () => {
    it("按真实协议路由生成可复制地址且不暴露 Token", () => {
        const guides = buildControlConnectionGuides(snapshot, "https://bot.example.com/console");
        expect(guides.find(item => item.protocolKey === "onebot.v11")).toMatchObject({
            authConfigured: true,
            endpoints: [
                {
                    url: "https://bot.example.com/icqq/123456/onebot/v11",
                    transport: "http",
                },
                {
                    url: "wss://bot.example.com/icqq/123456/onebot/v11",
                    transport: "websocket",
                },
            ],
        });
        expect(guides.find(item => item.protocolKey === "satori.v1")?.endpoints).toEqual([
            expect.objectContaining({
                url: "wss://bot.example.com/icqq/123456/satori/v1/events",
            }),
        ]);
        expect(guides.find(item => item.protocolKey === "milky.v1")?.endpoints).toEqual([
            expect.objectContaining({
                url: "https://bot.example.com/icqq/123456/milky/v1/api",
            }),
        ]);
        expect(guides.find(item => item.protocolKey === "mcp.v1")).toMatchObject({
            category: "ai",
            endpoints: [
                expect.objectContaining({ url: "https://bot.example.com/icqq/123456/mcp/v1/sse" }),
            ],
        });
        expect(JSON.stringify(guides)).not.toContain("secret-token");
    });

    it("提示仅启用 HTTP 时不会向下游推送事件", () => {
        const value = structuredClone(snapshot);
        (value.document["icqq.123456"] as Record<string, unknown>)["onebot.v11"] = {
            use_ws: false,
        };
        const guide = buildControlConnectionGuides(value, "http://127.0.0.1:6727").find(
            item => item.protocolKey === "onebot.v11",
        );
        expect(guide?.warning).toContain("实时收到事件");
    });

    it("拒绝带凭据或非 HTTP 的连接主机", () => {
        expect(normalizeConnectionOrigin("https://bot.example.com/path")).toBe(
            "https://bot.example.com",
        );
        expect(normalizeConnectionOrigin("https://user:pass@example.com")).toBeUndefined();
        expect(normalizeConnectionOrigin("javascript:alert(1)")).toBeUndefined();
    });
});
