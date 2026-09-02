import yaml from "js-yaml";
import type { Protocol } from "@onebots/core";
import { describe, expect, it, vi } from "vitest";
import {
    createProfileApplication,
    createFrameworkConnectionPlan,
    defineFrameworkIntegration,
    FrameworkIntegrationRegistry,
    getFrameworkProfile,
    listFrameworkProfiles,
} from "./framework-integration.js";

describe("framework integration profiles", () => {
    it("accepts dynamically registered framework providers without changing the planner", () => {
        const snapshot = FrameworkIntegrationRegistry.capture();
        try {
            FrameworkIntegrationRegistry.register(
                defineFrameworkIntegration({
                    profile: {
                        id: "fixture-framework",
                        displayName: "Fixture",
                        kind: "framework",
                        packageName: "fixture-framework",
                        protocol: "onebot.v11",
                        transport: "websocket",
                        verification: "documented",
                        upstream: "https://example.com/fixture",
                        defaultFrameworkOrigin: null,
                        limitations: [],
                    },
                    resolveEndpoint: ({ onebotsEndpoint }) =>
                        `${onebotsEndpoint.replace(/^http/u, "ws")}/fixture`,
                    renderFrameworkConfig: ({ endpoint }) => `endpoint=${endpoint}`,
                }),
            );

            const plan = createFrameworkConnectionPlan({
                framework: "fixture-framework",
                account: "mock.dynamic",
            });
            expect(plan.endpoint).toBe("ws://127.0.0.1:6727/mock/dynamic/onebot/v11/fixture");
            expect(plan.frameworkConfig).toBe(`endpoint=${plan.endpoint}`);
        } finally {
            FrameworkIntegrationRegistry.restore(snapshot);
        }
    });

    it("publishes one immutable profile for every promised downstream", () => {
        const profiles = listFrameworkProfiles();

        expect(profiles.map(profile => profile.id)).toEqual([
            "koishi",
            "nonebot",
            "karin",
            "zhin",
            "alemonjs",
            "melobot",
            "zerobot",
            "kovi",
            "astrbot",
            "langbot",
            "alicebot",
            "kotori",
            "yunzai",
            "zhenxun",
            "avilla",
            "olivos",
            "zhamao",
            "shiro",
            "simbot-onebot",
            "overflow",
            "walle",
            "adachi-bot",
            "genshinuid",
            "pepperbot",
            "nonebot1",
        ]);
        expect(new Set(profiles.map(profile => profile.id))).toHaveLength(profiles.length);
        expect(getFrameworkProfile("nonebot")).toMatchObject({
            verification: "handshake",
            evidence: {
                frameworkVersion: "2.5.0",
                adapterVersion: "2.4.6",
                command: "pnpm interop:nonebot",
            },
        });
        expect(getFrameworkProfile("koishi")).toMatchObject({
            verification: "handshake",
            evidence: {
                frameworkVersion: "4.18.6",
                adapterVersion: "1.5.1",
                command: "pnpm interop:koishi",
            },
        });
        expect(getFrameworkProfile("zhin")).toMatchObject({
            verification: "handshake",
            evidence: {
                frameworkVersion: "6.0.15",
                adapterVersion: "7.0.8",
                command: "pnpm interop:zhin",
            },
        });
        expect(getFrameworkProfile("alemonjs")).toMatchObject({
            verification: "handshake",
            evidence: {
                frameworkVersion: "2.1.103",
                adapterVersion: "2.1.21",
                command: "pnpm interop:alemonjs",
            },
        });
        expect(
            profiles
                .filter(
                    profile =>
                        ![
                            "koishi",
                            "nonebot",
                            "karin",
                            "zhin",
                            "alemonjs",
                            "melobot",
                            "zerobot",
                            "kovi",
                            "astrbot",
                            "langbot",
                            "alicebot",
                            "kotori",
                        ].includes(profile.id),
                )
                .every(profile => profile.verification === "documented"),
        ).toBe(true);
        expect(Object.isFrozen(getFrameworkProfile("nonebot"))).toBe(true);
        expect(Object.isFrozen(getFrameworkProfile("nonebot")?.limitations)).toBe(true);
    });

    it("publishes immutable and internally consistent distribution action audits", () => {
        const yunzai = getFrameworkProfile("yunzai")?.distributionAudit;
        const zhenxun = getFrameworkProfile("zhenxun")?.distributionAudit;

        expect(yunzai).toMatchObject({
            sourceRevision: "2d1652ac899e8f4338b5310171319e6894b2499c",
            auditedAt: "2026-09-02",
        });
        expect(yunzai?.requiredActions).toHaveLength(59);
        expect(yunzai?.supportedActions).toHaveLength(31);
        expect(yunzai?.unsupportedActions).toHaveLength(28);
        expect(
            new Set(yunzai?.supportedActions).intersection(new Set(yunzai?.unsupportedActions)),
        ).toHaveLength(0);
        expect(
            new Set([...(yunzai?.supportedActions ?? []), ...(yunzai?.unsupportedActions ?? [])]),
        ).toEqual(new Set(yunzai?.requiredActions));
        expect(yunzai?.unsupportedActions).toEqual(
            expect.arrayContaining(["upload_group_file", "get_guild_list", "_send_group_notice"]),
        );
        expect(zhenxun?.requiredActions).toHaveLength(17);
        expect(zhenxun?.supportedActions).toEqual(zhenxun?.requiredActions);
        expect(zhenxun?.unsupportedActions).toEqual([]);
        expect(Object.isFrozen(yunzai)).toBe(true);
        expect(Object.isFrozen(yunzai?.supportedActions)).toBe(true);
    });

    it("generates a NoneBot reverse WebSocket plan with separate gateway and framework origins", () => {
        const plan = createFrameworkConnectionPlan({
            framework: "nonebot",
            account: "wechat.work.bot",
            onebotsOrigin: "https://gateway.example.com/onebots/",
            frameworkOrigin: "http://nonebot.internal:8080/runtime/",
        });

        expect(plan).toMatchObject({
            schemaVersion: 1,
            account: { platform: "wechat", accountId: "work.bot", key: "wechat.work.bot" },
            protocol: "onebot.v11",
            transport: "reverse-websocket",
            endpoint: "ws://nonebot.internal:8080/runtime/onebot/v11/ws",
        });
        expect(yaml.load(plan.onebotsConfig)).toEqual({
            "wechat.work.bot": {
                "onebot.v11": {
                    access_token: "<shared-token>",
                    use_http: false,
                    use_ws: false,
                    ws_reverse: ["ws://nonebot.internal:8080/runtime/onebot/v11/ws"],
                },
            },
        });
        expect(plan.frameworkConfig).toContain("ONEBOT_V11_ACCESS_TOKEN=<shared-token>");
        expect(plan.frameworkConfig).not.toContain("gateway.example.com");
    });

    it("reuses the OneBot forward WebSocket shape for Zhin and AlemonJS", () => {
        const zhin = createFrameworkConnectionPlan({
            framework: "zhin",
            account: "qq.main",
            onebotsOrigin: "https://gateway.example.com/base",
        });
        const alemon = createFrameworkConnectionPlan({
            framework: "alemonjs",
            account: "qq.main",
            onebotsOrigin: "https://gateway.example.com/base",
        });

        expect(zhin.endpoint).toBe("wss://gateway.example.com/base/qq/main/onebot/v11");
        expect(alemon.endpoint).toBe(zhin.endpoint);
        expect(yaml.load(zhin.frameworkConfig)).toMatchObject({
            plugins: { onebot11: { connection: "ws", url: zhin.endpoint } },
        });
        expect(yaml.load(alemon.frameworkConfig)).toEqual({
            onebot: {
                url: alemon.endpoint,
                token: "<shared-token>",
                reverse_enable: false,
            },
        });
    });

    it("renders the pinned melobot and ZeroBot forward WebSocket plans", () => {
        const melobot = createFrameworkConnectionPlan({ framework: "melobot", account: "qq.main" });
        const zerobot = createFrameworkConnectionPlan({ framework: "zerobot", account: "qq.main" });

        expect(melobot.frameworkConfig).toContain("OneBotV11Protocol");
        expect(melobot.frameworkConfig).toContain('access_token="<shared-token>"');
        expect(JSON.parse(zerobot.frameworkConfig)).toMatchObject({
            ws: [{ Url: zerobot.endpoint, AccessToken: "<shared-token>" }],
        });
        expect(melobot.framework.evidence?.command).toBe("pnpm interop:melobot");
        expect(zerobot.framework.evidence?.command).toBe("pnpm interop:zerobot");
    });

    it("renders Kovi's pinned split WebSocket plan", () => {
        const kovi = createFrameworkConnectionPlan({ framework: "kovi", account: "qq.main" });

        expect(kovi.endpoint).toBe("ws://127.0.0.1:6727/qq/main/onebot/v11");
        expect(kovi.frameworkConfig).toContain('path = "/qq/main/onebot/v11"');
        expect(kovi.frameworkConfig).toContain("all_in_one = false");
        expect(kovi.framework.evidence?.command).toBe("pnpm interop:kovi");
    });

    it("renders AstrBot's pinned reverse WebSocket provider plan", () => {
        const astrbot = createFrameworkConnectionPlan({
            framework: "astrbot",
            account: "qq.main",
            frameworkOrigin: "http://astrbot.internal:6199/runtime",
        });

        expect(astrbot.endpoint).toBe("ws://astrbot.internal:6199/runtime/ws");
        expect(yaml.load(astrbot.frameworkConfig)).toMatchObject({
            type: "aiocqhttp",
            ws_reverse_host: "astrbot.internal",
            ws_reverse_port: 6199,
            ws_reverse_token: "<shared-token>",
        });
        expect(astrbot.framework.evidence?.command).toBe("pnpm interop:astrbot");
    });

    it("renders LangBot's pinned reverse WebSocket provider plan", () => {
        const langbot = createFrameworkConnectionPlan({
            framework: "langbot",
            account: "qq.main",
            frameworkOrigin: "http://langbot.internal:2280/runtime",
        });

        expect(langbot.endpoint).toBe("ws://langbot.internal:2280/runtime/ws");
        expect(yaml.load(langbot.frameworkConfig)).toMatchObject({
            adapter: "aiocqhttp",
            host: "langbot.internal",
            port: 2280,
            "access-token": "<shared-token>",
        });
        expect(langbot.framework.evidence?.command).toBe("pnpm interop:langbot");
    });

    it("renders AliceBot's authenticated compatibility provider plan", () => {
        const alicebot = createFrameworkConnectionPlan({
            framework: "alicebot",
            account: "qq.main",
            frameworkOrigin: "http://alicebot.internal:8080/runtime",
        });

        expect(alicebot.endpoint).toBe("ws://alicebot.internal:8080/runtime/cqhttp/ws");
        expect(alicebot.frameworkConfig).toContain("class OneBotsCQHTTPAdapter");
        expect(alicebot.frameworkConfig).toContain("request.headers.get('Authorization'");
        expect(alicebot.frameworkConfig).toContain('access_token = "<shared-token>"');
        expect(alicebot.framework.evidence?.command).toBe("pnpm interop:alicebot");
    });

    it("renders Kotori's authenticated connection wrapper plan", () => {
        const kotori = createFrameworkConnectionPlan({
            framework: "kotori",
            account: "qq.main",
            frameworkOrigin: "http://kotori.internal:7200/runtime",
        });

        expect(kotori.endpoint).toBe("ws://kotori.internal:7200/runtime/adapter/onebots");
        expect(kotori.frameworkConfig).toContain("class OneBotsOnebotAdapter");
        expect(kotori.frameworkConfig).toContain("socket.close(1008, 'Unauthorized')");
        expect(kotori.frameworkConfig).toContain("port = 7200");
        expect(kotori.framework.evidence?.command).toBe("pnpm interop:kotori");
    });

    it("generates Karin Milky HTTP and event transport configuration", () => {
        const plan = createFrameworkConnectionPlan({
            framework: "karin",
            account: "qq.bot",
        });
        const config = JSON.parse(plan.frameworkConfig) as {
            bots: Array<{ protocol: string; url: string; token: string }>;
        };

        expect(plan.endpoint).toBe("http://127.0.0.1:6727/qq/bot/milky/v1");
        expect(config.bots).toEqual([
            {
                protocol: "websocket",
                url: plan.endpoint,
                token: "<shared-token>",
            },
        ]);
        expect(yaml.load(plan.onebotsConfig)).toMatchObject({
            "qq.bot": { "milky.v1": { use_http: true, use_ws: true } },
        });
        expect(plan.framework.verification).toBe("handshake");
        expect(plan.framework.evidence).toMatchObject({
            frameworkVersion: "1.15.3",
            adapterVersion: "1.3.3",
            command: "pnpm interop:karin",
        });
    });

    it("generates the Satori root endpoint expected by the official Koishi adapter", () => {
        const plan = createFrameworkConnectionPlan({ framework: "koishi", account: "slack.team" });

        expect(plan.framework.verification).toBe("handshake");
        expect(plan.endpoint).toBe("http://127.0.0.1:6727/slack/team/satori");
        expect(yaml.load(plan.frameworkConfig)).toEqual({
            plugins: {
                "adapter-satori": {
                    endpoint: plan.endpoint,
                    token: "<shared-token>",
                },
            },
        });
    });

    it.each([
        ["avilla", "experimental", "satori.v1"],
        ["olivos", "experimental", "onebot.v11"],
        ["zhamao", "experimental", "onebot.v11"],
        ["shiro", "experimental", "onebot.v11"],
        ["simbot-onebot", "experimental", "onebot.v11"],
        ["overflow", "experimental", "onebot.v11"],
        ["walle", "experimental", "onebot.v12"],
        ["adachi-bot", "experimental", "onebot.v11"],
        ["genshinuid", "experimental", "onebot.v11"],
        ["pepperbot", "legacy", "onebot.v11"],
        ["nonebot1", "legacy", "onebot.v11"],
    ] as const)("creates an activatable %s connection plan", (framework, stage, protocol) => {
        const plan = createFrameworkConnectionPlan({ framework, account: "qq.main" });

        expect(plan.framework.applicationStage).toBe(stage);
        expect(plan.protocol).toBe(protocol);
        expect(plan.endpoint).toMatch(/^(?:https?|wss?):\/\//u);
        expect(plan.frameworkConfig).toContain("<shared-token>");
        expect(plan.limitations).not.toHaveLength(0);
    });

    it("describes required APIs without adding routes or fake actions", () => {
        const profile = getFrameworkProfile("nonebot")!;
        const definition = createProfileApplication(profile);
        const protocol = {
            name: "onebot",
            version: "v11",
            path: "/qq/main/onebot/v11",
        } as Protocol;
        const extension = definition.createProtocolExtension(protocol)!;
        expect(extension.capability.actions).toEqual([]);
        expect(extension.capability.routes).toEqual([]);
        expect(extension.capability.requiredActions).toContain("get_login_info");
        expect(extension.apply).toBeUndefined();
    });

    it.each([
        ["qq", "账号必须使用 platform.account_id"],
        ["qq.bad/id", "账号必须使用 platform.account_id"],
    ])("rejects unsafe account key %s", (account, message) => {
        expect(() => createFrameworkConnectionPlan({ framework: "zhin", account })).toThrow(
            message,
        );
    });

    it.each([
        ["file:///tmp/gateway", "只允许 http 或 https"],
        ["https://secret@example.com", "不能包含凭据"],
        ["https://example.com/?token=secret", "不能包含凭据"],
    ])("rejects unsafe public origin %s", (onebotsOrigin, message) => {
        expect(() =>
            createFrameworkConnectionPlan({
                framework: "zhin",
                account: "qq.main",
                onebotsOrigin,
            }),
        ).toThrow(message);
    });
});
