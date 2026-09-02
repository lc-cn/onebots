import { describe, expect, it } from "vitest";
import { CliError } from "./command-application.js";
import { showFrameworkConnections } from "./framework-command.js";

describe("frameworks command", () => {
    it("lists every profile as stable JSON without requiring a bot account", () => {
        const result = showFrameworkConnections({ json: true });
        const report = JSON.parse(result.output ?? "{}") as {
            schemaVersion: number;
            profiles: Array<{ id: string; verification: string }>;
        };

        expect(result.raw).toBe(true);
        expect(report.schemaVersion).toBe(1);
        expect(report.profiles.map(profile => profile.id)).toEqual([
            "koishi",
            "nonebot",
            "karin",
            "zhin",
            "alemonjs",
            "yunzai",
            "zhenxun",
        ]);
        expect(report.profiles.every(profile => profile.verification === "documented")).toBe(true);
    });

    it("renders a human connection plan without presenting documented as verified", () => {
        const result = showFrameworkConnections({
            framework: "nonebot",
            account: "mock.bot",
            framework_origin: "http://127.0.0.1:9000",
            json: false,
        });

        expect(result.output).toContain("NoneBot2 接入方案");
        expect(result.output).toContain("状态: documented（上游接入面不等于 OneBots 已验证）");
        expect(result.output).toContain("ws://127.0.0.1:9000/onebot/v11/ws");
        expect(result.output).toContain("<shared-token>");
    });

    it("requires a valid framework and account before generating templates", () => {
        expect(() =>
            showFrameworkConnections({ framework: "unknown", account: "mock.bot", json: false }),
        ).toThrow(CliError);
        expect(() => showFrameworkConnections({ framework: "nonebot", json: false })).toThrow(
            "需要 --account platform.account_id",
        );
        expect(() => showFrameworkConnections({ account: "mock.bot", json: false })).toThrow(
            "只能与 --framework 一起使用",
        );
    });
});
