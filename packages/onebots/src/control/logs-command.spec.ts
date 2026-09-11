import { describe, expect, it, vi } from "vitest";
import { runLogsCommand } from "./logs-command.js";
import { runControlLogs } from "./tui-logs.js";
import type { TuiPrompt } from "../tui/prompt.js";
function fixture() {
    const query = vi.fn().mockResolvedValue({
        schemaVersion: 1,
        source: "gateway",
        text: "\x1b[2Jhello",
        exists: true,
        truncated: true,
        cursor: "0123456789abcdef.5",
        reset: false,
    });
    const output = vi.fn();
    return { query, output, client: { logs: { query } } };
}
describe("unified logs terminal clients", () => {
    it("CLI rejects extra arguments and reads once from selected workspace", async () => {
        const f = fixture();
        const create = vi.fn(() => f.client);
        await expect(runLogsCommand(["--path", "/secret"], create, f.output)).rejects.toThrow(
            "只接受",
        );
        expect(create).not.toHaveBeenCalled();
        await runLogsCommand(["--data-dir", "/tmp/log-workspace"], create, f.output);
        expect(create).toHaveBeenCalledWith("/tmp/log-workspace");
        expect(f.query).toHaveBeenCalledWith({ source: "gateway" });
        expect(f.output.mock.calls).toEqual([["hello"], ["仅显示最近 64 KiB 日志。"]]);
        await runLogsCommand(["--source", "manager"], create, f.output);
        expect(f.query).toHaveBeenLastCalledWith({ source: "manager" });
    });
    it("TUI requires explicit consent and emits safe text only", async () => {
        const f = fixture();
        const ask = vi.fn().mockResolvedValue(["no"]);
        const prompt: TuiPrompt = { ask, report: f.output };
        await runControlLogs(f.client, prompt);
        expect(f.query).not.toHaveBeenCalled();
        expect(ask.mock.calls[0][0].detail).toContain("凭据");
        ask.mockResolvedValueOnce(["yes"]).mockResolvedValueOnce(["operation"]);
        await runControlLogs(f.client, prompt);
        expect(f.query).toHaveBeenCalledWith({ source: "operation" });
        expect(f.output.mock.calls[0]).toEqual(["hello"]);
    });
    it("does not expose captured failure details in either terminal entry", async () => {
        const f = fixture();
        f.query.mockRejectedValue(new Error("private-key"));
        await expect(runLogsCommand([], () => f.client, f.output)).rejects.toThrow(
            "无法读取服务日志",
        );
        expect(f.output).not.toHaveBeenCalled();
        let promptCount = 0;
        await runControlLogs(f.client, {
            ask: async () => [promptCount++ === 0 ? "yes" : "gateway"],
            report: f.output,
        });
        expect(f.output.mock.calls.flat().join()).not.toContain("private-key");
    });
});
