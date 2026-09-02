import { describe, expect, it } from "vitest";
import { CliError } from "./command-application.js";
import { showFrameworkConnections } from "./framework-command.js";

describe("frameworks command", () => {
    it("lists every profile as stable JSON without requiring a bot account", async () => {
        const result = await showFrameworkConnections({ json: true });
        const report = JSON.parse(result.output ?? "{}") as {
            schemaVersion: number;
            profiles: Array<{ id: string; verification: string }>;
            ecosystem: Array<{ id: string; priority: string }>;
        };

        expect(result.raw).toBe(true);
        expect(report.schemaVersion).toBe(1);
        expect(report.profiles.map(profile => profile.id)).toEqual([
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
        ]);
        expect(
            report.profiles
                .filter(profile =>
                    ["koishi", "nonebot", "karin", "zhin", "alemonjs"].includes(profile.id),
                )
                .every(profile => profile.verification === "handshake"),
        ).toBe(true);
        expect(report.ecosystem).toHaveLength(11);
        expect(report.ecosystem).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: "avilla", priority: "later" }),
                expect.objectContaining({ id: "genshinuid", priority: "later" }),
            ]),
        );
        expect(
            report.profiles
                .filter(profile => ["yunzai", "zhenxun"].includes(profile.id))
                .every(profile => profile.verification === "documented"),
        ).toBe(true);
    });

    it("shows distribution source coverage without describing it as process verification", async () => {
        const list = await showFrameworkConnections({ json: false });
        const plan = await showFrameworkConnections({
            framework: "yunzai",
            account: "qq.main",
            json: false,
        });

        expect(list.output).toContain("yunzai");
        expect(list.output).toContain("actions 31/59");
        expect(list.output).toContain("已调研候选");
        expect(list.output).toContain("astrbot");
        expect(plan.output).toContain("状态: documented");
        expect(plan.output).toContain("源码动作: 31/59");
        expect(plan.output).toContain("不代表完整进程互操作已验证");
    });

    it("renders pinned handshake evidence without overstating the verification level", async () => {
        const result = await showFrameworkConnections({
            framework: "nonebot",
            account: "mock.bot",
            framework_origin: "http://127.0.0.1:9000",
            json: false,
        });

        expect(result.output).toContain("NoneBot2 接入方案");
        expect(result.output).toContain("状态: handshake（固定版本已验证到此等级）");
        expect(result.output).toContain(
            "证据: framework 2.5.0 / adapter 2.4.6，2026-09-02，pnpm interop:nonebot",
        );
        expect(result.output).toContain("ws://127.0.0.1:9000/onebot/v11/ws");
        expect(result.output).toContain("<shared-token>");
    });

    it("requires a valid framework and account before generating templates", async () => {
        await expect(
            showFrameworkConnections({ framework: "unknown", account: "mock.bot", json: false }),
        ).rejects.toBeInstanceOf(CliError);
        await expect(
            showFrameworkConnections({ framework: "nonebot", json: false }),
        ).rejects.toThrow("需要 --account platform.account_id");
        await expect(
            showFrameworkConnections({ account: "mock.bot", json: false }),
        ).rejects.toThrow("只能与 --framework 一起使用");
    });
});
