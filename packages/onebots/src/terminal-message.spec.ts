import { describe, expect, it } from "vitest";
import {
    TERMINAL_MAX_COLUMNS,
    TERMINAL_MAX_INPUT_BYTES,
    TERMINAL_MAX_ROWS,
    parseTerminalClientMessage,
} from "./terminal-message.js";

describe("terminal client message contract", () => {
    it("accepts input, bounded resize, and restart commands", () => {
        expect(parseTerminalClientMessage('{"type":"input","data":"help\\r"}')).toEqual({
            success: true,
            command: { type: "input", data: "help\r" },
        });
        expect(
            parseTerminalClientMessage(
                JSON.stringify({
                    type: "resize",
                    cols: TERMINAL_MAX_COLUMNS,
                    rows: TERMINAL_MAX_ROWS,
                }),
            ),
        ).toEqual({
            success: true,
            command: { type: "resize", cols: TERMINAL_MAX_COLUMNS, rows: TERMINAL_MAX_ROWS },
        });
        expect(parseTerminalClientMessage('{"type":"restart"}')).toEqual({
            success: true,
            command: { type: "restart" },
        });
    });

    it.each([
        ["non-string input", { type: "input", data: 7 }],
        ["oversized input", { type: "input", data: "界".repeat(TERMINAL_MAX_INPUT_BYTES) }],
        ["zero columns", { type: "resize", cols: 0, rows: 24 }],
        ["fractional rows", { type: "resize", cols: 80, rows: 2.5 }],
        ["oversized columns", { type: "resize", cols: TERMINAL_MAX_COLUMNS + 1, rows: 24 }],
        ["oversized rows", { type: "resize", cols: 80, rows: TERMINAL_MAX_ROWS + 1 }],
    ])("rejects %s before invoking the PTY", (_name, payload) => {
        expect(parseTerminalClientMessage(JSON.stringify(payload))).toMatchObject({
            success: false,
            error: { type: "error", code: "INVALID_MESSAGE" },
        });
    });

    it("distinguishes malformed JSON, missing type, and unknown actions", () => {
        expect(parseTerminalClientMessage("{")).toMatchObject({
            success: false,
            error: { code: "INVALID_JSON" },
        });
        expect(parseTerminalClientMessage("[]")).toMatchObject({
            success: false,
            error: { code: "INVALID_MESSAGE" },
        });
        expect(parseTerminalClientMessage('{"type":"erase"}')).toEqual({
            success: false,
            error: { type: "error", code: "UNKNOWN_ACTION", message: "未知终端动作" },
        });
    });
});
