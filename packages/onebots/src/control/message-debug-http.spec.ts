import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import type { ControlAuth } from "./auth.js";
import { ControlMessageDebugHttp } from "./message-debug-http.js";

const handlers: ControlMessageDebugHttp[] = [];
afterEach(() => {
    for (const handler of handlers.splice(0)) handler.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
});
function fixture() {
    let valid = true;
    const verify = vi.fn((token: string) => valid && token === "device-session");
    const auth = { verify } as Pick<ControlAuth, "verify"> as ControlAuth;
    const service = {
        history: vi.fn(async () => ({ gatewayInstanceId: "first", entries: [] })),
        clear: vi.fn(async (_input: unknown) => ({
            gatewayInstanceId: "first",
            clearedCount: 1,
            clearedThroughSeq: 5,
        })),
    };
    const handler = new ControlMessageDebugHttp(service, auth);
    handlers.push(handler);
    return {
        handler,
        service,
        verify,
        revoke: () => {
            valid = false;
        },
    };
}
function transport(method = "GET", token = "device-session") {
    const request = new IncomingMessage(new Socket());
    request.method = method;
    request.headers.authorization = `Bearer ${token}`;
    const response = new ServerResponse(request);
    const write = vi.spyOn(response, "write").mockReturnValue(true);
    const end = vi.spyOn(response, "end").mockReturnValue(response);
    const destroy = vi.spyOn(response, "destroy").mockReturnValue(response);
    return { request, response, write, end, destroy };
}
const route = (suffix: string) => `/api/control/message-debug/${suffix}`;
const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
};

it("requires header authentication before reading history; URL credentials do not authorize", async () => {
    const f = fixture();
    const h = transport("GET", "");
    h.request.url = route("history") + "?access_token=device-session";
    await f.handler.handle(h.request, h.response, route("history"), false);
    expect(h.response.statusCode).toBe(401);
    expect(f.service.history).not.toHaveBeenCalled();
});
it("withholds a history result revoked during its read", async () => {
    const f = fixture();
    f.service.history.mockImplementationOnce(async () => {
        f.revoke();
        return { gatewayInstanceId: "private-instance", entries: [] };
    });
    const h = transport();
    await f.handler.handle(h.request, h.response, route("history"), false);
    expect(h.response.statusCode).toBe(401);
    expect(JSON.stringify(h.end.mock.calls)).not.toContain("private-instance");
});
it("does not clear when authorization is revoked while reading the body", async () => {
    const f = fixture();
    const h = transport("POST");
    const work = f.handler.handle(h.request, h.response, route("clear"), false);
    h.request.push('{"expectedGatewayInstanceId":');
    await new Promise(resolve => setImmediate(resolve));
    f.revoke();
    h.request.push('"first"}');
    h.request.push(null);
    await work;
    expect(h.response.statusCode).toBe(401);
    expect(f.service.clear).not.toHaveBeenCalled();
});
it("withholds a completed clear receipt after revocation and never retries", async () => {
    const f = fixture();
    f.service.clear.mockImplementationOnce(async () => {
        f.revoke();
        return { gatewayInstanceId: "private-instance", clearedCount: 1, clearedThroughSeq: 5 };
    });
    const h = transport("POST");
    const work = f.handler.handle(h.request, h.response, route("clear"), false);
    h.request.push('{"expectedGatewayInstanceId":"first"}');
    h.request.push(null);
    await work;
    expect(h.response.statusCode).toBe(401);
    expect(JSON.stringify(h.end.mock.calls)).not.toContain("private-instance");
    expect(f.service.clear).toHaveBeenCalledExactlyOnceWith({ expectedGatewayInstanceId: "first" });
});
it("streams full snapshots across instance changes and closes revoked sessions", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const h = transport();
    await f.handler.handle(h.request, h.response, route("stream"), false);
    await settle();
    expect(h.write).toHaveBeenCalledWith(
        'event: snapshot\ndata: {"gatewayInstanceId":"first","entries":[]}\n\n',
    );
    f.service.history.mockResolvedValue({ gatewayInstanceId: "second", entries: [] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.write).toHaveBeenLastCalledWith(
        'event: snapshot\ndata: {"gatewayInstanceId":"second","entries":[]}\n\n',
    );
    f.revoke();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(f.service.history).toHaveBeenCalledTimes(2);
});
it("does not overlap slow reads and checks revocation while a read is pending", async () => {
    vi.useFakeTimers();
    const f = fixture();
    let finish!: (value: { gatewayInstanceId: string; entries: [] }) => void;
    f.service.history.mockImplementation(
        () =>
            new Promise(resolve => {
                finish = resolve;
            }),
    );
    const h = transport();
    await f.handler.handle(h.request, h.response, route("stream"), false);
    await vi.advanceTimersByTimeAsync(4000);
    expect(f.service.history).toHaveBeenCalledOnce();
    f.revoke();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.destroy).toHaveBeenCalledOnce();
    finish({ gatewayInstanceId: "private-instance", entries: [] });
    await settle();
    expect(h.write).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
});
it("drops slow clients instead of accumulating writes", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const h = transport();
    h.write.mockReturnValue(false);
    await f.handler.handle(h.request, h.response, route("stream"), false);
    await settle();
    await vi.advanceTimersByTimeAsync(4000);
    expect(h.destroy).toHaveBeenCalledOnce();
    expect(f.service.history).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
});
it.each(["close", "error"])("removes a disconnected response on %s", async event => {
    vi.useFakeTimers();
    const f = fixture();
    const h = transport();
    await f.handler.handle(h.request, h.response, route("stream"), false);
    h.response.emit(event);
    await vi.advanceTimersByTimeAsync(4000);
    expect(f.service.history).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
});
it("limits streams to 16 and shuts down every stream without future polling", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const clients = Array.from({ length: 17 }, () => transport());
    for (const h of clients) await f.handler.handle(h.request, h.response, route("stream"), false);
    expect(clients[16].response.statusCode).toBe(429);
    expect(f.service.history).toHaveBeenCalledTimes(16);
    f.handler.close();
    await vi.advanceTimersByTimeAsync(4000);
    expect(vi.getTimerCount()).toBe(0);
    for (const h of clients.slice(0, 16)) expect(h.destroy).toHaveBeenCalledOnce();
    const after = transport();
    await f.handler.handle(after.request, after.response, route("history"), false);
    expect(after.response.statusCode).toBe(503);
});

it("fails closed when auth storage throws", async () => {
    const f = fixture();
    f.verify.mockImplementation(() => {
        throw new Error("private storage failure");
    });
    const h = transport();
    await f.handler.handle(h.request, h.response, route("history"), false);
    expect(h.response.statusCode).toBe(401);
    expect(f.service.history).not.toHaveBeenCalled();
    expect(JSON.stringify(h.end.mock.calls)).not.toContain("private storage failure");
});
it("returns the instance-bound clear receipt exactly once", async () => {
    const f = fixture();
    const h = transport("POST");
    const work = f.handler.handle(h.request, h.response, route("clear"), false);
    h.request.push('{"expectedGatewayInstanceId":"first"}');
    h.request.push(null);
    await work;
    expect(h.response.statusCode).toBe(200);
    expect(f.service.clear).toHaveBeenCalledExactlyOnceWith({ expectedGatewayInstanceId: "first" });
    expect(h.end).toHaveBeenCalledWith(
        JSON.stringify({
            gatewayInstanceId: "first",
            clearedCount: 1,
            clearedThroughSeq: 5,
        }),
    );
});
it("drops failed gateway streams without retrying or exposing errors", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.service.history.mockRejectedValue(new Error("private gateway failure"));
    const h = transport();
    await f.handler.handle(h.request, h.response, route("stream"), false);
    await vi.advanceTimersByTimeAsync(4000);
    expect(f.service.history).toHaveBeenCalledOnce();
    expect(h.write).not.toHaveBeenCalled();
    expect(h.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
});
it("does not write an outstanding snapshot after host shutdown", async () => {
    vi.useFakeTimers();
    const f = fixture();
    let finish!: (value: { gatewayInstanceId: string; entries: [] }) => void;
    f.service.history.mockImplementation(
        () =>
            new Promise(resolve => {
                finish = resolve;
            }),
    );
    const h = transport();
    await f.handler.handle(h.request, h.response, route("stream"), false);
    f.handler.close();
    finish({ gatewayInstanceId: "first", entries: [] });
    await vi.advanceTimersByTimeAsync(4000);
    expect(h.write).not.toHaveBeenCalled();
    expect(h.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
});
