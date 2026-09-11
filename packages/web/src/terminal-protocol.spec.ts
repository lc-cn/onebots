import { describe, expect, it, vi } from "vitest";
import {
    parseTerminalServerMessage,
    parseTerminalStatus,
    parseTerminalTicket,
    terminalWebSocketUrl,
} from "./terminal-protocol.js";

describe("terminal protocol", () => {
    it("validates local availability without accepting partial status", () => {
        expect(
            parseTerminalStatus({ available: true, localOnly: true, activeSessions: 1 }),
        ).toEqual({
            available: true,
            localOnly: true,
            activeSessions: 1,
        });
        expect(() => parseTerminalStatus({ available: true, activeSessions: 0 })).toThrow(
            "终端状态响应无效",
        );
    });

    it("accepts only a fresh, fixed-size one-time ticket", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-09-11T00:00:00.000Z"));
        expect(
            parseTerminalTicket({ ticket: "a".repeat(43), expiresAt: Date.now() + 30_000 }),
        ).toEqual({ ticket: "a".repeat(43), expiresAt: Date.now() + 30_000 });
        expect(() =>
            parseTerminalTicket({ ticket: "short", expiresAt: Date.now() + 30_000 }),
        ).toThrow("终端连接票据无效或已过期");
        vi.useRealTimers();
    });

    it("parses the identity then terminal stream events", () => {
        expect(
            parseTerminalServerMessage({
                type: "identity",
                application: "onebots",
                version: "1.2.12",
                instance_id: "manager-a",
                cwd: "/workspace",
            }),
        ).toMatchObject({ type: "identity", instanceId: "manager-a" });
        expect(parseTerminalServerMessage({ type: "ready" })).toEqual({ type: "ready" });
        expect(parseTerminalServerMessage({ type: "output", data: "hello" })).toEqual({
            type: "output",
            data: "hello",
        });
    });

    it("uses a same-origin websocket and keeps the ticket in the query only", () => {
        expect(
            terminalWebSocketUrl("a".repeat(43), {
                protocol: "https:",
                host: "localhost:6727",
            } as Location),
        ).toBe(`wss://localhost:6727/api/control/terminal?ticket=${"a".repeat(43)}`);
    });
});
