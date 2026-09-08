import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { BaseApp } from "@onebots/core";
import { afterEach, expect, it, vi } from "vitest";
import { GatewayMcpSessions } from "./mcp-sessions.js";
import { handleGatewayMcpMessage } from "./mcp-ipc.js";
import { isGatewayMcpMessage, isGatewayMcpReply } from "./mcp-contracts.js";
const cleanups: GatewayMcpSessions[] = [];
afterEach(() => {
    for (const session of cleanups.splice(0)) session.close();
});
class Protocol extends EventEmitter {
    name = "mcp";
    version = "v1";
    handleStdioMessage = vi.fn(async (text: string): Promise<string | null> => {
        const value = JSON.parse(text);
        return value.id === undefined
            ? null
            : JSON.stringify({ jsonrpc: "2.0", id: value.id, result: {} });
    });
}
function fixture(two = false) {
    const protocol = new Protocol();
    let now = 0;
    const accounts = new Map([["id/with/slash", { protocols: [protocol] }]]);
    if (two) accounts.set("other", { protocols: [new Protocol()] });
    const app = { adapters: new Map([["mock", { accounts }]]) } as unknown as Pick<
        BaseApp,
        "adapters"
    >;
    const sessions = new GatewayMcpSessions(app, () => now);
    cleanups.push(sessions);
    return {
        protocol,
        sessions,
        advance: () => {
            now += 60_000;
        },
    };
}
async function initialize(sessions: GatewayMcpSessions, id: string) {
    await sessions.request({
        action: "exchange",
        sessionId: id,
        message: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    await sessions.request({
        action: "exchange",
        sessionId: id,
        message: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
}
it("only uses configured accounts and preserves slash suffix; close only removes its listener", async () => {
    const f = fixture(true),
        id = randomUUID();
    await expect(f.sessions.request({ action: "open", sessionId: id })).rejects.toThrow(
        "请明确选择",
    );
    await f.sessions.request({ action: "open", sessionId: id, account: "mock/id/with/slash" });
    expect(f.protocol.listenerCount("mcp.notification")).toBe(1);
    await f.sessions.request({ action: "close", sessionId: id });
    expect(f.protocol.listenerCount("mcp.notification")).toBe(0);
    expect(f.protocol.handleStdioMessage).not.toHaveBeenCalled();
});
it("notifications require successful initialize and initialized, poll drains <=32", async () => {
    const f = fixture(),
        id = randomUUID();
    await f.sessions.request({ action: "open", sessionId: id });
    f.protocol.emit("mcp.notification", "before");
    expect(await f.sessions.request({ action: "poll", sessionId: id })).toEqual({ events: [] });
    await initialize(f.sessions, id);
    for (let index = 0; index < 40; index++)
        f.protocol.emit(
            "mcp.notification",
            JSON.stringify({ jsonrpc: "2.0", method: "notifications/message", params: { index } }),
        );
    expect((await f.sessions.request({ action: "poll", sessionId: id })).events).toHaveLength(32);
    expect((await f.sessions.request({ action: "poll", sessionId: id })).events).toHaveLength(8);
});
it("limits sessions and idle lifetime; overflow fails closed", async () => {
    const f = fixture(),
        ids = Array.from({ length: 8 }, () => randomUUID());
    for (const id of ids) await f.sessions.request({ action: "open", sessionId: id });
    await expect(f.sessions.request({ action: "open", sessionId: randomUUID() })).rejects.toThrow(
        "上限",
    );
    await initialize(f.sessions, ids[0]);
    for (let i = 0; i < 65; i++) f.protocol.emit("mcp.notification", "event");
    await expect(f.sessions.request({ action: "poll", sessionId: ids[0] })).rejects.toThrow(
        "队列已满",
    );
    f.advance();
    await expect(f.sessions.request({ action: "poll", sessionId: ids[1] })).rejects.toThrow(
        "会话不可用",
    );
    expect(f.protocol.listenerCount("mcp.notification")).toBe(0);
});
it("parallel exchange is refused; failure does not initialize or expose SDK error", async () => {
    const f = fixture(),
        id = randomUUID();
    await f.sessions.request({ action: "open", sessionId: id });
    const deferred = Promise.withResolvers<string | null>();
    f.protocol.handleStdioMessage.mockReturnValueOnce(deferred.promise);
    const first = f.sessions.request({
        action: "exchange",
        sessionId: id,
        message: '{"jsonrpc":"2.0","id":1,"method":"initialize"}',
    });
    await expect(
        f.sessions.request({ action: "exchange", sessionId: id, message: "{}" }),
    ).rejects.toThrow("繁忙");
    deferred.reject(new Error("secret-token"));
    await expect(first).rejects.toThrow("MCP 消息处理失败");
    await f.sessions.request({
        action: "exchange",
        sessionId: id,
        message: '{"jsonrpc":"2.0","method":"initialized"}',
    });
    f.protocol.emit("mcp.notification", "event");
    expect((await f.sessions.request({ action: "poll", sessionId: id })).events).toEqual([]);
});
it("closed wire rejects extra fields, oversized frames and wrong identity before dispatch", async () => {
    const identity = {
        protocolVersion: 1 as const,
        controlInstanceId: randomUUID(),
        gatewayInstanceId: randomUUID(),
    };
    const value = {
        ...identity,
        type: "gateway.mcp",
        requestId: randomUUID(),
        request: { action: "open", sessionId: randomUUID() },
    };
    expect(isGatewayMcpMessage(value)).toBe(true);
    expect(isGatewayMcpMessage({ ...value, token: "secret" })).toBe(false);
    expect(
        isGatewayMcpMessage({
            ...value,
            request: { ...value.request, action: "exchange", message: "x".repeat(65536) },
        }),
    ).toBe(false);
    const send = vi.fn(),
        f = fixture();
    handleGatewayMcpMessage(
        { ...value, controlInstanceId: randomUUID() },
        identity,
        f.sessions,
        send,
    );
    expect(send).not.toHaveBeenCalled();
    expect(f.protocol.listenerCount("mcp.notification")).toBe(0);
    handleGatewayMcpMessage(value, identity, undefined, send);
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(isGatewayMcpReply(send.mock.calls[0][0])).toBe(true);
    expect(send.mock.calls[0][0].error).toBe("MCP 网关不可用");
});

it("escaped notification size cannot strand an unpollable queue, and shutdown detaches all listeners", async () => {
    const f = fixture(),
        id = randomUUID();
    await f.sessions.request({ action: "open", sessionId: id });
    await initialize(f.sessions, id);
    f.protocol.emit("mcp.notification", '"'.repeat(40_000));
    await expect(f.sessions.request({ action: "poll", sessionId: id })).rejects.toThrow("队列已满");
    await f.sessions.request({ action: "open", sessionId: randomUUID() });
    f.sessions.close();
    expect(f.protocol.listenerCount("mcp.notification")).toBe(0);
    await expect(f.sessions.request({ action: "open", sessionId: randomUUID() })).rejects.toThrow(
        "网关不可用",
    );
});

it.each(["close", "expire"] as const)(
    "%s releases hung session listeners but not active tool capacity",
    async mode => {
        const f = fixture();
        const deferred = Array.from({ length: 8 }, () => Promise.withResolvers<string | null>());
        const outcomes: Promise<unknown>[] = [];
        for (const pending of deferred) {
            const id = randomUUID();
            await f.sessions.request({ action: "open", sessionId: id });
            f.protocol.handleStdioMessage.mockReturnValueOnce(pending.promise);
            outcomes.push(
                f.sessions
                    .request({ action: "exchange", sessionId: id, message: "{}" })
                    .catch(error => error.message),
            );
            if (mode === "close") await f.sessions.request({ action: "close", sessionId: id });
        }
        if (mode === "expire") f.advance();
        const nextId = randomUUID();
        await f.sessions.request({ action: "open", sessionId: nextId });
        expect(f.protocol.listenerCount("mcp.notification")).toBe(1);
        await expect(
            f.sessions.request({ action: "exchange", sessionId: nextId, message: "{}" }),
        ).rejects.toThrow("繁忙");
        expect(f.protocol.handleStdioMessage).toHaveBeenCalledTimes(8);
        expect(await f.sessions.request({ action: "poll", sessionId: nextId })).toEqual({
            events: [],
        });
        deferred[0].resolve(null);
        await outcomes[0];
        await expect(
            f.sessions.request({ action: "exchange", sessionId: nextId, message: "{}" }),
        ).resolves.toEqual({ message: null });
        expect(f.protocol.handleStdioMessage).toHaveBeenCalledTimes(9);
        for (const pending of deferred.slice(1)) pending.resolve(null);
        await Promise.all(outcomes);
    },
);
