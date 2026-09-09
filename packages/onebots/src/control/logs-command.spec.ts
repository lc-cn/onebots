import { describe, expect, it, vi } from "vitest";
import { runLogsCommand } from "./logs-command.js";
import { runControlLogs } from "./tui-logs.js";
import type { TuiPrompt } from "../tui/prompt.js";
function fixture() {
    const gateway = vi
        .fn()
        .mockResolvedValue({
            source: "gateway",
            text: "\x1b[2Jhello",
            exists: true,
            truncated: true,
        });
    const output = vi.fn();
    return { gateway, output, client: { logs: { gateway } } };
}
describe("gateway logs terminal clients", () => {
    it("CLI rejects extra arguments and reads once from selected workspace", async () => {
        const f = fixture();
        const create = vi.fn(() => f.client);
        await expect(runLogsCommand(["--path", "/secret"], create, f.output)).rejects.toThrow(
            "只接受",
        );
        expect(create).not.toHaveBeenCalled();
        await runLogsCommand(["--data-dir", "/tmp/log-workspace"], create, f.output);
        expect(create).toHaveBeenCalledWith("/tmp/log-workspace");
        expect(f.gateway).toHaveBeenCalledTimes(1);
        expect(f.output.mock.calls).toEqual([["hello"], ["仅显示最近 64 KiB 日志。"]]);
    });
    it("TUI requires explicit consent and emits safe text only", async () => {
        const f = fixture();
        const ask = vi.fn().mockResolvedValue(["no"]);
        const prompt: TuiPrompt = { ask, report: f.output };
        await runControlLogs(f.client, prompt);
        expect(f.gateway).not.toHaveBeenCalled();
        expect(ask.mock.calls[0][0].detail).toContain("凭据");
        ask.mockResolvedValue(["yes"]);
        await runControlLogs(f.client, prompt);
        expect(f.gateway).toHaveBeenCalledTimes(1);
        expect(f.output.mock.calls[0]).toEqual(["hello"]);
    });
    it("does not expose captured failure details in either terminal entry", async () => {
        const f = fixture();
        f.gateway.mockRejectedValue(new Error("private-key"));
        await expect(runLogsCommand([], () => f.client, f.output)).rejects.toThrow(
            "无法读取网关日志",
        );
        expect(f.output).not.toHaveBeenCalled();
        await runControlLogs(f.client, { ask: async () => ["yes"], report: f.output });
        expect(f.output.mock.calls.flat().join()).not.toContain("private-key");
    });
});
