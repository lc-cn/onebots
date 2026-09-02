import { describe, expect, it } from "vitest";
import { parseFrameworkCatalog, parseFrameworkPlan } from "./framework-integration.js";

const profile = {
    id: "yunzai",
    displayName: "云崽",
    kind: "distribution",
    protocol: "onebot.v11",
    transport: "reverse-websocket",
    verification: "documented",
    upstream: "https://example.com",
    limitations: ["尚未完成进程验证"],
    distributionAudit: {
        sourceRevision: "abc",
        auditedAt: "2026-09-02",
        requiredActions: ["send_msg"],
        supportedActions: ["send_msg"],
        unsupportedActions: [],
        note: "静态审计",
    },
};

const ecosystemEntry = {
    id: "astrbot",
    displayName: "AstrBot",
    kind: "distribution",
    language: "Python",
    protocols: ["onebot.v11", "satori.v1"],
    transports: ["reverse-websocket"],
    priority: "next",
    upstream: "https://example.com/astrbot",
    evidence: "官方文档说明 OneBot v11 反向 WebSocket 接入。",
    limitation: "尚未提供配置生成器。",
};

describe("framework integration management payloads", () => {
    it("parses catalogs and plans without trusting arbitrary server shapes", () => {
        expect(
            parseFrameworkCatalog({
                schemaVersion: 1,
                frameworks: [profile],
                ecosystem: [ecosystemEntry],
            }),
        ).toMatchObject({
            frameworks: [
                {
                    id: "yunzai",
                    distributionAudit: { supportedActions: ["send_msg"] },
                },
            ],
            ecosystem: [{ id: "astrbot", priority: "next" }],
        });
        expect(
            parseFrameworkPlan({
                framework: profile,
                endpoint: "ws://example.com",
                onebotsConfig: "onebots",
                frameworkConfig: "framework",
                checks: [{ name: "握手", expected: "成功" }],
                limitations: [],
            }),
        ).toMatchObject({ endpoint: "ws://example.com", checks: [{ name: "握手" }] });
    });

    it("rejects malformed catalog versions and profile fields", () => {
        expect(() =>
            parseFrameworkCatalog({ schemaVersion: 2, frameworks: [], ecosystem: [] }),
        ).toThrow("版本无效");
        expect(() =>
            parseFrameworkCatalog({
                schemaVersion: 1,
                frameworks: [{ ...profile, limitations: 1 }],
                ecosystem: [],
            }),
        ).toThrow("limitations 必须是数组");
    });
});
