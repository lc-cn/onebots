import { describe, expect, it, vi } from "vitest";
import { ControlLogClient, isControlLogSnapshot, sanitizeLogText } from "./control-logs.js";
const snapshot = { source: "gateway", text: "hello", truncated: false, exists: true };
describe("control logs", () => {
    it("accepts only the fixed bounded snapshot without getters or extra keys", () => {
        expect(isControlLogSnapshot(snapshot)).toBe(true);
        for (const value of [
            null,
            [],
            { ...snapshot, path: "/tmp/secret" },
            { ...snapshot, source: "manager" },
            { ...snapshot, exists: false },
            { ...snapshot, text: "a".repeat(65537) },
        ])
            expect(isControlLogSnapshot(value)).toBe(false);
        const getter = vi.fn();
        expect(
            isControlLogSnapshot({
                ...snapshot,
                get text() {
                    return getter();
                },
            }),
        ).toBe(false);
        expect(getter).not.toHaveBeenCalled();
        expect(isControlLogSnapshot({ ...snapshot, text: "a".repeat(65536) })).toBe(true);
        expect(isControlLogSnapshot({ ...snapshot, text: "�".repeat(65536) })).toBe(true);
        expect(isControlLogSnapshot({ ...snapshot, text: "", exists: false })).toBe(true);
    });
    it("removes CSI, OSC hyperlinks/clipboard, DCS, C1, and bidi commands but retains newlines/tabs", () => {
        expect(
            sanitizeLogText(
                "\x1b[31mred\x1b[0m\n\tOK\x1b]52;c;secret\x07\x1bPsecret\x1b\\\x9b2J\u202e\r",
            ),
        ).toBe("red\n\tOK");
        expect(sanitizeLogText("\x1b]8;;https://bad\x1b\\link\x1b]8;;\x1b\\")).toBe("link");
        expect(sanitizeLogText("before\x1b]52;unfinished")).toBe("before");
    });
    it("does not read automatically and only calls the fixed route once", async () => {
        const request = vi.fn().mockResolvedValue({ ...snapshot, text: "\x1b[2Jhello" });
        const client = new ControlLogClient({ request });
        expect(request).not.toHaveBeenCalled();
        expect((await client.gateway()).text).toBe("hello");
        expect(request.mock.calls).toEqual([["GET", "/api/control/logs/gateway"]]);
    });
    it("does not leak transport or malformed response details", async () => {
        const request = vi.fn().mockRejectedValue(new Error("secret"));
        await expect(new ControlLogClient({ request }).gateway()).rejects.toThrow(
            "无法读取网关日志",
        );
        request.mockResolvedValue({ ...snapshot, text: "a".repeat(65537) });
        await expect(new ControlLogClient({ request }).gateway()).rejects.not.toThrow("secret");
        expect(request).toHaveBeenCalledTimes(2);
    });
});
