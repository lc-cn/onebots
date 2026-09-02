import { afterEach, describe, expect, it, vi } from "vitest";
import { reserveMachineReadableStdout } from "./machine-readable-output.js";

let restore: (() => void) | undefined;

afterEach(() => {
    restore?.();
    restore = undefined;
    vi.restoreAllMocks();
});

describe("machine-readable stdout boundary", () => {
    it("把同步、异步和最终文档之后的 stdout 都转到 stderr", async () => {
        const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
        const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        const boundary = reserveMachineReadableStdout();
        restore = boundary.restore;

        process.stdout.write("plugin initialization\n");
        await Promise.resolve();
        process.stdout.write("plugin ready\n");
        boundary.writeDocument('{"ok":true}\n');
        process.stdout.write("late plugin output\n");

        expect(stderr.mock.calls.map(call => String(call[0]))).toEqual([
            "plugin initialization\n",
            "plugin ready\n",
            "late plugin output\n",
        ]);
        expect(stdout.mock.calls.map(call => String(call[0]))).toEqual(['{"ok":true}\n']);
    });

    it("显式释放后恢复调用前 writer，且重复释放保持幂等", () => {
        const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
        vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        const boundary = reserveMachineReadableStdout();

        boundary.restore();
        boundary.restore();
        process.stdout.write("after restore\n");

        expect(stdout.mock.calls.map(call => String(call[0]))).toEqual(["after restore\n"]);
        expect(() => boundary.writeDocument("late document\n")).toThrow(
            "机器可读 stdout 边界已经释放",
        );
    });
});
