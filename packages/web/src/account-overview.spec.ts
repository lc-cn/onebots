import { describe, expect, it } from "vitest";
import type {
    ControlConfigurationSnapshot,
    ControlInstallationCatalog,
    ControlStatus,
} from "@onebots/core/control";
import { accountImageUrl, buildAccountCards } from "./account-overview.js";

const configuration: ControlConfigurationSnapshot = {
    base: { generationId: "generation", configRevision: "revision" },
    document: {
        general: { "onebot.v11": { use_http: true } },
        "icqq.123456": { "onebot.v11": { use_ws: true }, "milky.v1": {} },
        "icqq.654321": {},
    },
    schemas: {
        adapters: { icqq: {} },
        protocols: {
            "onebot.v11": {
                use_http: { type: "boolean", default: true },
                use_ws: { type: "boolean", default: false },
            },
            "milky.v1": { use_http: { type: "boolean", default: true } },
        },
    },
    secretStates: [],
    unknownPaths: [],
};
const status: ControlStatus = {
    schemaVersion: 1,
    manager: { id: "manager", version: "1.0.0" },
    gateway: { desired: "running", actual: "running", recoveryRequired: false, operations: [] },
    accounts: {
        available: true,
        items: [
            {
                platform: "icqq",
                accountId: "123456",
                status: "online",
                avatarUrl: "https://example.com/bot.png",
                platformIconUrl: "https://example.com/qq.png",
                protocols: [{ name: "onebot", version: "v11", status: "ready" }],
            },
        ],
    },
};
const catalog: ControlInstallationCatalog = {
    activeGenerationId: "generation",
    selection: { adapters: ["icqq"], protocols: [], applications: [] },
    adapters: [
        {
            name: "icqq",
            displayName: "ICQQ",
            version: "1.0.0",
            iconUrl: "https://example.com/qq.png",
        },
    ],
    protocols: [],
    applications: [],
};

describe("账号与协议卡片", () => {
    it("头像失效后回退平台 Logo，拒绝带凭据或不安全地址", () => {
        const card = {
            avatarUrl: "https://example.com/avatar.png",
            platformIconUrl: "https://example.com/logo.png",
        };
        expect(accountImageUrl(card)).toBe(card.avatarUrl);
        expect(accountImageUrl(card, new Set([card.avatarUrl]))).toBe(card.platformIconUrl);
        expect(accountImageUrl({ ...card, avatarUrl: "http://example.com/avatar.png" })).toBe(
            card.platformIconUrl,
        );
        expect(accountImageUrl({ avatarUrl: "https://user:pass@example.com/avatar.png" })).toBe(
            undefined,
        );
    });
    it("同时展示已配置未启动账号、运行状态与同一账号的协议地址", () => {
        const cards = buildAccountCards(configuration, status, catalog, "https://bot.example.com");
        expect(cards.map(card => card.accountId)).toEqual(["123456", "654321"]);
        expect(cards[0]).toMatchObject({
            status: "online",
            avatarUrl: "https://example.com/bot.png",
            platformIconUrl: "https://example.com/qq.png",
        });
        expect(cards[0]?.protocols).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    status: "ready",
                    guide: expect.objectContaining({
                        protocolKey: "onebot.v11",
                        endpoints: expect.arrayContaining([
                            expect.objectContaining({
                                url: "https://bot.example.com/icqq/123456/onebot/v11",
                            }),
                        ]),
                    }),
                }),
            ]),
        );
        expect(cards[1]?.protocols).toEqual([]);
    });

    it("网关未上报时仍显示配置账号，不伪造在线状态", () => {
        const cards = buildAccountCards(configuration, undefined, catalog, "http://127.0.0.1:6727");
        expect(cards).toHaveLength(2);
        expect(cards[0]?.status).toBeUndefined();
        expect(cards[0]?.platformIconUrl).toBe("https://example.com/qq.png");
    });
});
