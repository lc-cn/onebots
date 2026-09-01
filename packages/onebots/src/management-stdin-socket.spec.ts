import { describe, expect, it, vi } from "vitest";
import { handleManagementStdinSocketAction } from "./management-stdin-socket.js";

function createStdin() {
    return {
        resume: vi.fn(),
        emit: vi.fn(() => true),
    };
}

async function waitForNextTick(): Promise<void> {
    await new Promise<void>(resolve => process.nextTick(resolve));
}

describe("management stdin WebSocket compatibility action", () => {
    it("forwards repeated input without ending the shared process stream", async () => {
        const stdin = createStdin();

        expect(
            handleManagementStdinSocketAction(
                { action: "system.input", data: "first", echo: 1 },
                stdin,
            ),
        ).toEqual({ event: "system.input.result", echo: 1, data: { success: true } });
        expect(
            handleManagementStdinSocketAction({ action: "system.input", data: "second" }, stdin),
        ).toEqual({ event: "system.input.result", data: { success: true } });
        await waitForNextTick();

        expect(stdin.resume).toHaveBeenCalledTimes(2);
        expect(stdin.emit).toHaveBeenNthCalledWith(1, "data", Buffer.from("first\n"));
        expect(stdin.emit).toHaveBeenNthCalledWith(2, "data", Buffer.from("second\n"));
        expect(stdin.emit).not.toHaveBeenCalledWith("end");
    });

    it("rejects non-string input without touching stdin", async () => {
        const stdin = createStdin();

        expect(
            handleManagementStdinSocketAction(
                { action: "system.input", data: { command: "help" } },
                stdin,
            ),
        ).toEqual({
            event: "system.input.result",
            data: {
                success: false,
                code: "INPUT_INVALID",
                message: "终端输入必须是字符串",
            },
        });
        await waitForNextTick();

        expect(stdin.resume).not.toHaveBeenCalled();
        expect(stdin.emit).not.toHaveBeenCalled();
    });

    it("ignores unrelated management actions", () => {
        expect(handleManagementStdinSocketAction({ action: "system.reload" }, createStdin())).toBe(
            undefined,
        );
    });
});
