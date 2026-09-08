import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { bridgeManagerMcp, parseMcpOptions, type McpManagerClient } from "./manager-mcp.js";
function fixture() {
    const input = new PassThrough();
    let text = "";
    const output = new Writable({
        write(chunk, _encoding, callback) {
            text += String(chunk);
            setTimeout(callback, 2);
        },
    });
    const client: McpManagerClient = {
        openMcp: vi.fn(async () => ({ id: "session", gatewayInstanceId: "gateway" })),
        exchangeMcp: vi.fn(async (_id, message) => ({ message })),
        pollMcp: vi.fn(async () => ({ events: [] })),
        closeMcp: vi.fn(async () => ({ closed: true })),
    };
    return { input, output, client, text: () => text };
}
const message = (id: number) => JSON.stringify({ jsonrpc: "2.0", id, method: "tools/list" });
describe("manager MCP stdio client", () => {
    it("preserves the account suffix after the first slash", () => {
        expect(parseMcpOptions(["--account", "mock/room/member"])?.account).toBe(
            "mock/room/member",
        );
        expect(() => parseMcpOptions(["--account", "mock/"])).toThrow();
    });
    it("preserves FIFO and closes only its own session on EOF", async () => {
        const f = fixture();
        const work = bridgeManagerMcp(f.client, f.input, f.output, "mock/bot");
        f.input.end(`${message(1)}\n${message(2)}\n`);
        await work;
        expect(f.text()).toBe(`${message(1)}\n${message(2)}\n`);
        expect(f.client.openMcp).toHaveBeenCalledWith("mock/bot");
        expect(f.client.closeMcp).toHaveBeenCalledExactlyOnceWith("session");
    });
    it("does not replay unknown exchanges or drain queued calls", async () => {
        const f = fixture();
        f.client.exchangeMcp = vi.fn(async () => {
            throw new Error("synthetic-secret");
        });
        const work = bridgeManagerMcp(f.client, f.input, f.output);
        f.input.end(`${message(1)}\n${message(2)}\n`);
        await expect(work).rejects.toThrow(/^MCP 管理连接/);
        expect(f.client.exchangeMcp).toHaveBeenCalledTimes(1);
        expect(f.text()).toBe("");
    });
    it.each(["oversize", "queue", "truncated"])("rejects bounded input %s", async kind => {
        const f = fixture();
        const work = bridgeManagerMcp(f.client, f.input, f.output);
        f.input.end(
            kind === "oversize"
                ? "x".repeat(65537)
                : kind === "queue"
                  ? Array.from({ length: 33 }, (_, i) => message(i)).join("\n") + "\n"
                  : message(1),
        );
        await expect(work).rejects.toThrow();
        expect(f.client.closeMcp).toHaveBeenCalledTimes(1);
    });
    it("polls notifications without adding stdout status text", async () => {
        vi.useFakeTimers();
        try {
            const f = fixture();
            f.client.pollMcp = vi.fn(async () => ({
                events: [
                    JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed" }),
                ],
            }));
            const work = bridgeManagerMcp(f.client, f.input, f.output);
            await vi.advanceTimersByTimeAsync(510);
            expect(f.client.pollMcp).toHaveBeenCalledTimes(1);
            expect(JSON.parse(f.text().trim()).method).toBe("notifications/tools/list_changed");
            f.input.end();
            await work;
        } finally {
            vi.useRealTimers();
        }
    });
    it("waits for stdout writes before dispatching the next exchange", async () => {
        const f = fixture();
        const callbacks: Array<() => void> = [];
        const output = new Writable({
            write(_chunk, _encoding, callback) {
                callbacks.push(callback);
            },
        });
        const work = bridgeManagerMcp(f.client, f.input, output);
        f.input.end(`${message(1)}\n${message(2)}\n`);
        await new Promise(resolve => setImmediate(resolve));
        expect(f.client.exchangeMcp).toHaveBeenCalledTimes(1);
        callbacks.shift()!();
        await new Promise(resolve => setImmediate(resolve));
        expect(f.client.exchangeMcp).toHaveBeenCalledTimes(2);
        callbacks.shift()!();
        await work;
    });
    it("SIGTERM closes only its session and removes signal listeners", async () => {
        const f = fixture(),
            signals = new EventEmitter();
        const work = bridgeManagerMcp(f.client, f.input, f.output, undefined, signals);
        await new Promise(resolve => setImmediate(resolve));
        signals.emit("SIGTERM");
        await work;
        expect(f.client.closeMcp).toHaveBeenCalledExactlyOnceWith("session");
        expect(f.client.exchangeMcp).not.toHaveBeenCalled();
        expect(signals.listenerCount("SIGTERM")).toBe(0);
    });
    it("poll failure closes without replaying a tool call", async () => {
        vi.useFakeTimers();
        try {
            const f = fixture();
            f.client.pollMcp = vi.fn(async () => {
                throw new Error("synthetic-secret");
            });
            const work = bridgeManagerMcp(f.client, f.input, f.output);
            const assertion = expect(work).rejects.toThrow(/^MCP 管理连接/);
            await vi.advanceTimersByTimeAsync(501);
            await assertion;
            expect(f.client.exchangeMcp).not.toHaveBeenCalled();
            expect(f.text()).toBe("");
            expect(f.client.closeMcp).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });
    it("rejects old flags and supports only manager options", () => {
        expect(parseMcpOptions(["--help"])).toBeNull();
        expect(parseMcpOptions(["--account", "mock/bot"])?.account).toBe("mock/bot");
        for (const flag of ["-c", "-r", "-p", "-t"])
            expect(() => parseMcpOptions([flag, "value"])).toThrow();
    });
});
