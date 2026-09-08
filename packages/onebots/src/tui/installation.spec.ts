import { describe, expect, it, vi } from "vitest";
import { createInstallationPlan } from "../installation-local.js";
import { runInstallation } from "./onboarding.js";
import { TuiCancelled, type PromptRequest, type TuiPrompt } from "./prompt.js";

function scripted(answers: Array<string[] | Error>, inspect?: (request: PromptRequest) => void) {
    const requests: PromptRequest[] = [];
    const prompt: TuiPrompt = {
        ask: vi.fn(async request => {
            requests.push(request);
            inspect?.(request);
            const answer = answers.shift();
            if (answer instanceof Error) throw answer;
            if (!answer) throw new Error(`缺少测试回答：${request.title}`);
            return answer;
        }),
        report: vi.fn(),
    };
    return { prompt, requests };
}

describe("TUI 依赖安装流程", () => {
    it("收集并确认全部信息后才安装，安装成功后才验证", async () => {
        const install = vi.fn(async () => {});
        const verify = vi.fn(async () => {
            expect(install).toHaveBeenCalledOnce();
        });
        const { prompt, requests } = scripted(
            [["icqq"], ["private-test-token"], ["onebot-v11"], ["nonebot"], ["install"]],
            () => expect(install).not.toHaveBeenCalled(),
        );
        const selection = await runInstallation(
            prompt,
            "/runtime",
            { adapters: [], protocols: [] },
            { install, verify },
        );
        expect(selection).toEqual({
            adapters: ["icqq"],
            protocols: ["onebot-v11"],
            applications: ["nonebot"],
        });
        expect(install).toHaveBeenCalledWith(
            expect.arrayContaining([expect.stringMatching(/^@onebots\/adapter-icqq@\d/)]),
            "/runtime",
            "private-test-token",
            expect.any(Function),
        );
        expect(requests[1].secret).toBe(true);
        expect(JSON.stringify(requests)).not.toContain("private-test-token");
        expect(verify).toHaveBeenCalledWith(selection, "/runtime");
    });

    it("取消不安装任何包", async () => {
        const dependencies = { install: vi.fn(), verify: vi.fn() };
        const { prompt } = scripted([["telegram"], ["onebot-v11"], [], new TuiCancelled()]);
        await expect(
            runInstallation(prompt, "/runtime", { adapters: [], protocols: [] }, dependencies),
        ).rejects.toBeInstanceOf(TuiCancelled);
        expect(dependencies.install).not.toHaveBeenCalled();
        expect(dependencies.verify).not.toHaveBeenCalled();
    });

    it("确认页返回可以重选，取消 ICQQ 后清除凭据", async () => {
        const dependencies = { install: vi.fn(async () => {}), verify: vi.fn(async () => {}) };
        const { prompt } = scripted([
            ["icqq"],
            ["secret"],
            ["onebot-v11"],
            [],
            ["0"],
            ["telegram"],
            ["onebot-v11"],
            [],
            ["install"],
        ]);
        await runInstallation(prompt, "/runtime", { adapters: [], protocols: [] }, dependencies);
        expect(dependencies.install).toHaveBeenCalledOnce();
        expect(dependencies.install.mock.calls[0][2]).toBe("");
    });

    it("框架与协议不匹配时回到选择页，不擅自加装协议", async () => {
        const dependencies = { install: vi.fn(), verify: vi.fn() };
        const { prompt } = scripted([
            ["telegram"],
            ["mcp-v1"],
            ["nonebot"],
            new TuiCancelled(),
            new TuiCancelled(),
        ]);
        await expect(
            runInstallation(prompt, "/runtime", { adapters: [], protocols: [] }, dependencies),
        ).rejects.toBeInstanceOf(TuiCancelled);
        expect(prompt.report).toHaveBeenCalledWith(expect.stringContaining("onebot-v11"));
        expect(dependencies.install).not.toHaveBeenCalled();
    });

    it("安装失败可重试；验证失败只重试验证，不重装", async () => {
        const { prompt } = scripted([
            ["telegram"],
            ["onebot-v11"],
            [],
            ["install"],
            ["retry"],
            ["retry"],
        ]);
        const dependencies = {
            install: vi
                .fn()
                .mockRejectedValueOnce(new Error("network failure"))
                .mockResolvedValue(undefined),
            verify: vi
                .fn()
                .mockRejectedValueOnce(new Error("broken plugin"))
                .mockResolvedValue(undefined),
        };
        await runInstallation(prompt, "/runtime", { adapters: [], protocols: [] }, dependencies);
        expect(dependencies.install).toHaveBeenCalledTimes(2);
        expect(dependencies.verify).toHaveBeenCalledTimes(2);
    });

    it("协议页返回平台时保留选择", async () => {
        const { prompt, requests } = scripted([
            ["telegram"],
            new TuiCancelled(),
            ["telegram"],
            ["onebot-v11"],
            [],
            ["cancel"],
        ]);
        await expect(
            runInstallation(
                prompt,
                "/runtime",
                { adapters: [], protocols: [] },
                { install: vi.fn(), verify: vi.fn() },
            ),
        ).rejects.toBeInstanceOf(TuiCancelled);
        expect(requests[2].selected).toEqual(["telegram"]);
    });

    it("确认页列出所选适配器的必需 peer，不为未选择的平台安装 SDK", async () => {
        expect(createInstallationPlan({ adapters: ["icqq"], protocols: [] }).peers).toEqual([
            "@icqqjs/icqq@^1.10.18",
        ]);
        expect(createInstallationPlan({ adapters: ["telegram"], protocols: [] }).peers).toEqual([]);
        const { prompt, requests } = scripted([
            ["icqq"],
            ["token"],
            ["onebot-v11"],
            [],
            ["cancel"],
        ]);
        await expect(
            runInstallation(
                prompt,
                "/runtime",
                { adapters: [], protocols: [] },
                { install: vi.fn(), verify: vi.fn() },
            ),
        ).rejects.toBeInstanceOf(TuiCancelled);
        expect(requests.at(-1)?.detail).toContain("@icqqjs/icqq@^1.10.18");
    });

    it("框架是内置方案，安装计划只包含用户所选适配器与协议的精确版本", () => {
        const plan = createInstallationPlan({
            adapters: ["telegram"],
            protocols: ["onebot-v11"],
            applications: ["nonebot"],
        });
        expect(plan.packages).toHaveLength(2);
        expect(plan.packages.every(name => /@\d+\.\d+\.\d+$/.test(name))).toBe(true);
        expect(plan.packages.join(" ")).not.toMatch(/application-|latest|nonebot/);
        expect(() => createInstallationPlan({ adapters: ["unknown"], protocols: [] })).toThrow(
            "安装目录中没有",
        );
    });
});
