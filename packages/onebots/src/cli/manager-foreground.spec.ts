import { beforeEach, describe, expect, it, vi } from "vitest";
const control = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../control/command.js", () => ({ runControlCommand: control }));
import { runManagerForeground } from "./manager-foreground.js";
import { prepareCliInvocation } from "../cli-invocation.js";
beforeEach(() => control.mockClear());
describe("public foreground manager entry", () => {
    it("delegates run arguments unchanged to the same serve lifecycle", async () => {
        const args = ["--data-dir", "/tmp/manager", "--host", "127.0.0.1", "--port", "6767"];
        await runManagerForeground(args);
        expect(control).toHaveBeenCalledWith([process.execPath, process.argv[1], "serve", ...args]);
    });
    it.each([
        "-c",
        "-r",
        "-p",
        "-t",
        "--config=file",
        "--register=mock",
        "--protocol=onebot-v11",
        "--target=zhin",
    ])("rejects legacy %s without starting anything", async flag => {
        await expect(runManagerForeground([flag, "old-value"])).rejects.toThrow("migrate");
        expect(control).not.toHaveBeenCalled();
    });
    it("routes nonTTY default management options without mistaking their values for a command", () => {
        const argv = ["node", "onebots", "--data-dir", "/tmp/new", "--port", "6767"];
        expect(prepareCliInvocation(argv, false)).toEqual({
            kind: "cli",
            argv: ["node", "onebots", "run", ...argv.slice(2)],
        });
        expect(prepareCliInvocation(["node", "onebots"], false)).toEqual({
            kind: "cli",
            argv: ["node", "onebots", "run"],
        });
    });
    it("rejects the removed legacy service runtime entry", () => {
        expect(
            prepareCliInvocation(["node", "onebots", "--service-runtime", "-c", "/tmp/old"], false),
        ).toEqual({
            kind: "invalid",
            message: "--service-runtime 已移除；旧服务请先执行 onebots migrate",
        });
    });
    it("delegates help without interpreting it as startup configuration", async () => {
        await runManagerForeground(["--help"]);
        expect(control.mock.calls[0]).toEqual([
            [process.execPath, process.argv[1], "serve", "--help"],
        ]);
    });
});
