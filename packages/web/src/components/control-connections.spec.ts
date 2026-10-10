import type { ControlConfigurationSnapshot } from "@onebots/core/control";
import { describe, expect, it } from "vitest";
import { reactive } from "vue";
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
    it("响应式全局默认值与账号覆盖能合并，且不修改源配置", () => {
        const value = structuredClone(snapshot);
        value.document.general = {
            "satori.v1": { use_http: true, use_ws: true },
            "onebot.v11": {
                ws_reverse: ["wss://receiver.example.com/a"],
                nested: { inherited: true },
            },
        };
        value.document["icqq.123456"] = {
            "satori.v1": { use_ws: false },
            "onebot.v11": {
                ws_reverse: ["wss://receiver.example.com/b"],
                nested: { account: true },
            },
        };
        const before = structuredClone(value);
        const guides = buildControlConnectionGuides(reactive(value), "http://192.0.2.10:6727");
        expect(guides.find(guide => guide.protocolKey === "satori.v1")?.endpoints).toEqual([
            expect.objectContaining({
                url: "http://192.0.2.10:6727/icqq/123456/satori/v1",
                transport: "http",
            }),
        ]);
        expect(
            guides.find(guide => guide.protocolKey === "onebot.v11")?.reverseTargets,
        ).toContainEqual({ label: "反向 WebSocket", count: 2 });
        expect(value).toEqual(before);
        expect(buildControlConnectionGuides(reactive(value), "http://192.0.2.10:6727")).toEqual(
            guides,
        );
    });
    it("按真实协议路由生成可复制地址", () => {
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
    });

    it("HTTP 和 SSE 地址继承网关路径前缀，WebSocket 保持独立路径", () => {
        const value = structuredClone(snapshot);
        (value.document.general as Record<string, unknown>).path = "/gateway";

        const guides = buildControlConnectionGuides(value, "https://bot.example.com/console");
        expect(guides.find(item => item.protocolKey === "onebot.v11")?.endpoints).toEqual([
            expect.objectContaining({
                url: "https://bot.example.com/gateway/icqq/123456/onebot/v11",
            }),
            expect.objectContaining({ url: "wss://bot.example.com/icqq/123456/onebot/v11" }),
        ]);
        expect(guides.find(item => item.protocolKey === "mcp.v1")?.endpoints).toEqual([
            expect.objectContaining({
                url: "https://bot.example.com/gateway/icqq/123456/mcp/v1/sse",
            }),
        ]);
    });

    it("反向目标按运行时深合并继承，不被账号空数组覆盖", () => {
        const value = structuredClone(snapshot);
        (value.document.general as Record<string, unknown>)["onebot.v11"] = {
            use_http: true,
            ws_reverse: ["wss://receiver.example.com/a"],
        };
        (value.document["icqq.123456"] as Record<string, unknown>)["onebot.v11"] = {
            use_ws: false,
            ws_reverse: [],
        };

        const guide = buildControlConnectionGuides(value, "https://bot.example.com").find(
            item => item.protocolKey === "onebot.v11",
        );
        expect(guide?.reverseTargets).toContainEqual({ label: "反向 WebSocket", count: 1 });
    });

    it("只有协议顶层 Token 会标记正向入口需要鉴权", () => {
        const value = structuredClone(snapshot);
        value.secretStates = [
            {
                path: ["icqq.123456", "onebot.v11", "webhooks", "0", "access_token"],
                configured: true,
            },
        ];

        const guide = buildControlConnectionGuides(value, "https://bot.example.com").find(
            item => item.protocolKey === "onebot.v11",
        );
        expect(guide?.authConfigured).toBe(false);
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
