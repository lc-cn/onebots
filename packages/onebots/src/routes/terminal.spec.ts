import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { App } from "../app.js";
import { handleTerminalProcessExit } from "./terminal.js";

describe("terminal PTY lifecycle", () => {
    it("notifies and closes every client when the PTY exits", () => {
        const first = client();
        const second = client();
        const app = {
            ptyTerminal: { kill: vi.fn() },
            terminalClients: new Set([first, second]),
            logger: { error: vi.fn(), warn: vi.fn() },
        } as unknown as App;

        handleTerminalProcessExit(app);

        expect(app.ptyTerminal).toBeNull();
        expect(app.terminalClients.size).toBe(0);
        for (const connection of [first, second]) {
            expect(connection.send).toHaveBeenCalledOnce();
            expect(JSON.parse(connection.send.mock.calls[0][0])).toEqual({ type: "exit" });
            expect(connection.close).toHaveBeenCalledWith(1000, "Terminal exited");
        }
    });
});

function client() {
    return {
        readyState: WebSocket.OPEN,
        bufferedAmount: 0,
        send: vi.fn(),
        close: vi.fn(),
    };
}
