import { describe, expect, it } from "vitest";
import {
    parseTerminalClientMessage,
    TERMINAL_MAX_COLUMNS,
    TERMINAL_MAX_INPUT_BYTES,
} from "./terminal-message.js";

describe("terminal client message", () => {
    it("只接受有界输入和尺寸，不把服务生命周期操作放进 shell 协议", () => {
        expect(parseTerminalClientMessage('{"type":"input","data":"pwd\\r"}')).toEqual({
            command: { type: "input", data: "pwd\r" },
        });
        expect(parseTerminalClientMessage('{"type":"resize","cols":120,"rows":40}')).toEqual({
            command: { type: "resize", cols: 120, rows: 40 },
        });
        for (const invalid of [
            "not-json",
            '{"type":"restart"}',
            JSON.stringify({ type: "input", data: "x".repeat(TERMINAL_MAX_INPUT_BYTES + 1) }),
            JSON.stringify({ type: "resize", cols: TERMINAL_MAX_COLUMNS + 1, rows: 40 }),
        ])
            expect(parseTerminalClientMessage(invalid)).toHaveProperty(
                "error.code",
                "INVALID_MESSAGE",
            );
    });
});
