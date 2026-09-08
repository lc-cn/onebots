import { describe, expect, it, vi, afterEach } from "vitest";
const mocks = vi.hoisted(() => ({ start: vi.fn(), output: vi.fn() }));
vi.mock("./host.js", () => ({ startControlHost: mocks.start }));
vi.mock("../cli-output.js", () => ({ writeCliOutput: mocks.output }));
import { runControlCommand } from "./command.js";
import { parseServeOptions } from "./serve-options.js";
afterEach(() => vi.clearAllMocks());
describe("管理服务命令边界", () => {
    it.each(["--help", "-h"])("%s 不启动管理服务或创建工作区", async flag => {
        expect(await runControlCommand(["node", "onebots", "serve", flag])).toBe(true);
        expect(mocks.start).not.toHaveBeenCalled();
        expect(mocks.output).toHaveBeenCalledWith(expect.stringContaining("onebots serve"));
    });
    it.each([
        ["--port"],
        ["--port", "6727", "--port", "8888"],
        ["--unknown"],
        ["--port", "0"],
        ["--port", "0x1234"],
        ["-r", "icqq"],
        ["--help", "--port", "6727"],
    ])("非法参数 %j 不启动服务", async (...args) => {
        await expect(runControlCommand(["node", "onebots", "serve", ...args])).rejects.toThrow();
        expect(mocks.start).not.toHaveBeenCalled();
    });
    it("显式设置优先于环境变量，保留工作区空格", () => {
        expect(
            parseServeOptions(["--data-dir", "/tmp/onebots test", "--port", "8080"], {
                PORT: "9000",
            }),
        ).toEqual({ workspace: "/tmp/onebots test", host: "127.0.0.1", port: 8080 });
    });
});
