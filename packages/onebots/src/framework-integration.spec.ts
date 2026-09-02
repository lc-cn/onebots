import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import {
    createFrameworkConnectionPlan,
    getFrameworkProfile,
    listFrameworkProfiles,
} from "./framework-integration.js";

describe("framework integration profiles", () => {
    it("publishes one immutable profile for every promised downstream", () => {
        const profiles = listFrameworkProfiles();

        expect(profiles.map(profile => profile.id)).toEqual([
            "koishi",
            "nonebot",
            "karin",
            "zhin",
            "alemonjs",
            "yunzai",
            "zhenxun",
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
                        !["koishi", "nonebot", "karin", "zhin", "alemonjs"].includes(profile.id),
                )
                .every(profile => profile.verification === "documented"),
        ).toBe(true);
        expect(Object.isFrozen(getFrameworkProfile("nonebot"))).toBe(true);
        expect(Object.isFrozen(getFrameworkProfile("nonebot")?.limitations)).toBe(true);
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
