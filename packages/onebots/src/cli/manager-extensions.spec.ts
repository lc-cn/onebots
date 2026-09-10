import { describe, expect, it, vi } from "vitest";
import { ControlClient } from "@onebots/core/control";
import type { PromptRequest, TuiPrompt } from "../tui/prompt.js";
import { runManagerExtensions } from "./manager-extensions.js";

const empty = { adapters: [], protocols: [], applications: [] };
const removal = { adapters: ["mock"], protocols: [], applications: [] };
const plan = {
    id: "a".repeat(64),
    planDigest: "b".repeat(64),
    baseGenerationId: null,
    selection: empty,
    removed: removal,
    packages: [
        { name: "onebots", version: "1.2.12" },
        { name: "@onebots/core", version: "1.2.12" },
    ],
    peers: [],
    recommendations: [],
};

function fixture(answers: string[][] = []) {
    const calls: Array<[string, string, unknown]> = [];
    const client = new ControlClient({
        request: async <T>(method: "GET" | "POST", route: string, body?: unknown) => {
            calls.push([method, route, body]);
            if (route.endsWith("/catalog"))
                return {
                    activeGenerationId: null,
                    selection: { adapters: ["mock"], protocols: [], applications: [] },
                    adapters: [{ name: "mock", displayName: "Mock", version: "1.0.0" }],
                    protocols: [],
                    applications: [],
                } as T;
            if (route.endsWith("/plan")) return plan as T;
            throw new Error("unexpected request");
        },
    });
    const requests: PromptRequest[] = [];
    const prompt: TuiPrompt = {
        ask: vi.fn(async request => {
            requests.push(request);
            const answer = answers.shift();
            if (!answer) throw new Error("unexpected prompt");
            return answer;
        }),
        report: vi.fn(),
    };
    const output = vi.fn();
    return {
        client,
        calls,
        requests,
        prompt,
        output,
        dependencies: { client: vi.fn(() => client), prompt, output, interactive: true },
    };
}

describe("extensions CLI", () => {
    it("plan-only 将活动完整集合扣除指定扩展后交给通用计划，不安装或激活", async () => {
        const f = fixture();
        expect(
            await runManagerExtensions(
                ["remove", "--adapter", "mock", "--plan-only", "--data-dir", "/data"],
                f.dependencies,
            ),
        ).toBe(0);
        expect(f.calls).toEqual([
            ["GET", "/api/control/installations/catalog", undefined],
            [
                "POST",
                "/api/control/installations/plan",
                { selection: empty, expectedGenerationId: null },
            ],
        ]);
        expect(JSON.parse(f.output.mock.calls[0][0]).removed).toEqual(removal);
    });

    it("交互移除明确确认候选，取消后不安装", async () => {
        const f = fixture([["no"]]);
        await runManagerExtensions(["remove", "--adapter", "mock"], f.dependencies);
        expect(f.requests[0].title).toContain("移除候选");
        expect(f.calls).toHaveLength(2);
    });

    it("install 子命令复用完整选择向导", async () => {
        const f = fixture([["mock"], [], [], ["no"]]);
        await runManagerExtensions(["install", "--data-dir", "/data"], f.dependencies);
        expect(f.calls.map(call => call[1])).toEqual([
            "/api/control/installations/catalog",
            "/api/control/installations/plan",
        ]);
    });

    it("非交互执行、空移除和无效名称在创建客户端前拒绝", async () => {
        const f = fixture();
        const create = vi.fn(() => f.client);
        await expect(
            runManagerExtensions(["remove", "--adapter", "mock"], {
                client: create,
                interactive: false,
            }),
        ).rejects.toThrow("--plan-only");
        await expect(
            runManagerExtensions(["remove", "--plan-only"], {
                client: create,
                interactive: false,
            }),
        ).rejects.toThrow("至少需要");
        await expect(
            runManagerExtensions(["remove", "--adapter", "../mock", "--plan-only"], {
                client: create,
                interactive: false,
            }),
        ).rejects.toThrow("无效");
        expect(create).not.toHaveBeenCalled();
    });

    it("待移除扩展不在活动完整集合时，不创建服务端计划", async () => {
        const f = fixture();
        await expect(
            runManagerExtensions(
                ["remove", "--protocol", "onebot-v11", "--plan-only"],
                f.dependencies,
            ),
        ).rejects.toThrow("不在当前活动运行版本");
        expect(f.calls).toEqual([["GET", "/api/control/installations/catalog", undefined]]);
    });
});
