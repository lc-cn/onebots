import { describe, expect, it, vi } from "vitest";
import { ControlClient, type ControlTransport } from "./control.js";

describe("ControlClient MCP routes", () => {
    it("uses fixed POST routes and preserves session, payload and response", async () => {
        const replies: unknown[] = [
            { id: "session", gatewayInstanceId: "gateway" },
            { message: '{"jsonrpc":"2.0","id":1,"result":{}}' },
            { events: ['{"jsonrpc":"2.0","method":"notifications/message"}'] },
            { closed: true },
        ];
        const request = vi.fn<ControlTransport["request"]>(async <T>() => replies.shift() as T);
        const client = new ControlClient({ request });
        expect(await client.openMcp("mock/account.with/slash")).toEqual({ id: "session", gatewayInstanceId: "gateway" });
        const message = ' {"jsonrpc":"2.0","id":1,"method":"ping"} ';
        expect(await client.exchangeMcp("session", message)).toEqual({ message: '{"jsonrpc":"2.0","id":1,"result":{}}' });
        expect(await client.pollMcp("session")).toEqual({ events: ['{"jsonrpc":"2.0","method":"notifications/message"}'] });
        expect(await client.closeMcp("session")).toEqual({ closed: true });
        expect(request.mock.calls).toEqual([
            ["POST", "/api/control/mcp/open", { account: "mock/account.with/slash" }],
            ["POST", "/api/control/mcp/exchange", { id: "session", message }],
            ["POST", "/api/control/mcp/poll", { id: "session" }],
            ["POST", "/api/control/mcp/close", { id: "session" }],
        ]);
    });
    it("keeps account optional and notification responses null", async () => {
        const request = vi.fn<ControlTransport["request"]>(async <T>() => ({ message: null }) as T);
        const client = new ControlClient({ request });
        await client.openMcp();
        expect(request).toHaveBeenCalledExactlyOnceWith("POST", "/api/control/mcp/open", { account: undefined });
        expect(await client.exchangeMcp("session", "notification")).toEqual({ message: null });
    });
    it("propagates uncertain exchange failures without retry", async () => {
        const request = vi.fn<ControlTransport["request"]>().mockRejectedValue(new Error("unknown result"));
        const client = new ControlClient({ request });
        await expect(client.exchangeMcp("session", "tool call")).rejects.toThrow("unknown result");
        expect(request).toHaveBeenCalledTimes(1);
    });
});
