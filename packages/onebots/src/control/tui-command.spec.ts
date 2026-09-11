import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import { ControlClient } from "@onebots/core/control";
import type { TuiPrompt } from "../tui/prompt.js";
import { isDirectControlTuiInvocation, runControlTuiCommand } from "./tui-command.js";
function fixture(answers: string[][], handler: (route: string) => unknown = () => ({})) {
    const request = vi.fn(
        async <T>(_method: "GET" | "POST", route: string): Promise<T> => handler(route) as T,
    );
    const client = vi.fn(() => new ControlClient({ request }));
    const ask = vi.fn(async () => {
        const answer = answers.shift();
        if (!answer) throw new Error("unexpected");
        return answer;
    });
    const prompt: TuiPrompt = { ask, report: vi.fn() };
    return { client, request, prompt, interactive: true };
}
describe("顶层管理工作台入口", () => {
    it("ui/tui和交互无参数使用管理入口，非交互默认不冒充TUI", () => {
        expect(isDirectControlTuiInvocation(["node", "onebots"], true)).toBe(true);
        expect(isDirectControlTuiInvocation(["node", "onebots"], false)).toBe(false);
        for (const command of ["ui", "tui", "setup", "--setup", "--configure", "--data-dir"])
            expect(isDirectControlTuiInvocation(["node", "onebots", command], true)).toBe(true);
        expect(isDirectControlTuiInvocation(["node", "onebots", "run"], true)).toBe(false);
    });
    it("使用明确data-dir检查服务后进入菜单，不创建本地App", async () => {
        const options = fixture([["quit"]]);
        await runControlTuiCommand(["--data-dir", "test-workspace"], options);
        expect(options.client).toHaveBeenCalledWith(path.resolve("test-workspace"));
        expect(options.request).toHaveBeenCalledTimes(1);
        expect(options.request).toHaveBeenCalledWith("GET", "/api/control/status");
    });
    it("管理离线只提示serve，无旧网关启动也无错误秘密回显", async () => {
        const options = fixture([], () => {
            throw new Error("private-token ENOENT");
        });
        await expect(runControlTuiCommand([], options)).rejects.toThrow(
            "请先在另一个终端运行 onebots serve",
        );
        expect(options.prompt.ask).not.toHaveBeenCalled();
        expect(options.request).toHaveBeenCalledTimes(1);
    });
    it("旧配置与运行参数、web和未知参数明确拒绝，不静默忽略", async () => {
        const options = fixture([]);
        for (const args of [
            ["-c", "secret.yaml"],
            ["--config=old.yaml"],
            ["-r", "mock"],
            ["--system"],
            ["--force"],
            ["--reset"],
            ["--web"],
            ["--unknown"],
            ["--setup", "--configure"],
            ["--data-dir"],
        ])
            await expect(runControlTuiCommand(args, options)).rejects.toThrow();
        expect(options.client).not.toHaveBeenCalled();
    });
    it("help不要求TTY/服务，configure进入新草稿向导后回菜单", async () => {
        const output = vi.fn();
        await runControlTuiCommand(["--help"], { interactive: false, output });
        expect(output).toHaveBeenCalledWith(expect.stringContaining("onebots serve"));
        const options = fixture([["back"], ["quit"]]);
        await runControlTuiCommand(["--configure"], options);
        expect(options.prompt.ask).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ title: "配置草稿" }),
        );
    });
    it("setup走ControlClient安装向导而非旧工作区", async () => {
        const options = fixture([[], [], [], ["no"], ["quit"]], route => {
            if (route.endsWith("catalog"))
                return {
                    activeGenerationId: null,
                    selection: { adapters: [], protocols: [], applications: [] },
                    adapters: [],
                    protocols: [],
                    applications: [],
                };
            if (route.endsWith("plan"))
                return { id: "plan", packages: [], peers: [], recommendations: [] };
            return {};
        });
        await runControlTuiCommand(["--setup"], options);
        expect(options.request.mock.calls.map(call => call[1])).toEqual([
            "/api/control/status",
            "/api/control/installations/catalog",
            "/api/control/installations/plan",
        ]);
    });
});
