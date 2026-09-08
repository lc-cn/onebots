import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ControlMcpService } from "./mcp-api.js";
import type { GatewayMcpResult } from "../gateway/mcp-contracts.js";
function fixture() {
    let now = 0,
        gateway: string | undefined = randomUUID();
    const forward = vi.fn(
        async (_instance: string, request: { action: string }): Promise<GatewayMcpResult> =>
            request.action === "exchange"
                ? { message: null }
                : request.action === "poll"
                  ? { events: [] }
                  : {},
    );
    const api = new ControlMcpService({ currentGateway: () => gateway, forward, now: () => now });
    const call = (action: string, body: unknown = {}, owner = "local") =>
        api.handle({
            pathname: `/api/control/mcp/${action}`,
            method: "POST",
            owner,
            body: async () => body,
        });
    const open = async () => {
        const result = await call("open");
        expect(result?.status).toBe(200);
        return (result!.body as { id: string }).id;
    };
    return {
        api,
        forward,
        call,
        open,
        tick: (ms: number) => {
            now += ms;
        },
        change: () => {
            gateway = randomUUID();
        },
        unavailable: () => {
            gateway = undefined;
        },
    };
}
describe("manager MCP broker", () => {
    it("binds owner and gateway and returns the four public shapes", async () => {
        const f = fixture(),
            id = await f.open();
        expect((await f.call("poll", { id }, "other"))?.status).toBe(404);
        expect(
            await f.call("exchange", {
                id,
                message: '{"jsonrpc":"2.0","id":1,"method":"initialize"}',
            }),
        ).toEqual({ status: 200, body: { message: null } });
        expect(await f.call("poll", { id })).toEqual({ status: 200, body: { events: [] } });
        expect(await f.call("close", { id })).toEqual({ status: 200, body: { closed: true } });
        expect((await f.call("poll", { id }))?.status).toBe(404);
    });
    it("reserves all eight slots during concurrent opens", async () => {
        const f = fixture();
        const resolve: Array<(result: GatewayMcpResult) => void> = [];
        f.forward.mockImplementation(() => new Promise(done => resolve.push(done)));
        const requests = Array.from({ length: 8 }, () => f.call("open"));
        await Promise.resolve();
        await Promise.resolve();
        expect((await f.call("open"))?.status).toBe(429);
        resolve.forEach(done => done({}));
        await Promise.all(requests);
    });
    it("expires precisely at idle deadline and never forwards into a replacement", async () => {
        const f = fixture(),
            id = await f.open();
        f.tick(60000);
        expect((await f.call("poll", { id }))?.status).toBe(404);
        const other = await f.open();
        f.change();
        const count = f.forward.mock.calls.length;
        expect((await f.call("exchange", { id: other, message: "{}" }))?.status).toBe(404);
        expect(f.forward).toHaveBeenCalledTimes(count);
    });
    it("allows poll during exchange but refuses concurrent exchanges", async () => {
        const f = fixture(),
            id = await f.open();
        let complete!: (result: GatewayMcpResult) => void;
        f.forward.mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    complete = resolve;
                }),
        );
        const exchange = f.call("exchange", { id, message: "{}" });
        await Promise.resolve();
        await Promise.resolve();
        expect((await f.call("exchange", { id, message: "{}" }))?.status).toBe(409);
        expect((await f.call("poll", { id }))?.status).toBe(200);
        complete({ message: null });
        expect((await exchange)?.status).toBe(200);
    });
    it("does not retain a late open after its reservation expires", async () => {
        const f = fixture();
        let complete!: (result: GatewayMcpResult) => void;
        f.forward.mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    complete = resolve;
                }),
        );
        const opening = f.call("open");
        await Promise.resolve();
        await Promise.resolve();
        f.tick(60000);
        complete({});
        expect((await opening)?.status).toBe(503);
        expect(f.forward.mock.calls.map(call => call[1].action)).toEqual(["open", "close"]);
    });
    it("times out open and closes only a late success on the original instance", async () => {
        vi.useFakeTimers();
        try {
            const f = fixture();
            let complete!: (result: GatewayMcpResult) => void;
            f.forward.mockImplementationOnce(
                () =>
                    new Promise(resolve => {
                        complete = resolve;
                    }),
            );
            const opening = f.call("open");
            await vi.advanceTimersByTimeAsync(30001);
            expect((await opening)?.status).toBe(503);
            complete({});
            await Promise.resolve();
            await Promise.resolve();
            expect(f.forward.mock.calls.map(call => call[1].action)).toEqual([
                "open",
                "close",
                "close",
            ]);
        } finally {
            vi.useRealTimers();
        }
    });
    it.each([false, true])(
        "exchange timeout cleanup never targets a replacement (changed=%s)",
        async changed => {
            vi.useFakeTimers();
            try {
                const f = fixture(),
                    id = await f.open();
                f.forward.mockImplementationOnce(() => new Promise(() => {}));
                const request = f.call("exchange", { id, message: "{}" });
                await vi.advanceTimersByTimeAsync(1);
                if (changed) f.change();
                await vi.advanceTimersByTimeAsync(30000);
                expect((await request)?.status).toBe(503);
                expect(f.forward.mock.calls.map(call => call[1].action)).toEqual(
                    changed ? ["open", "exchange"] : ["open", "exchange", "close"],
                );
            } finally {
                vi.useRealTimers();
            }
        },
    );
    it("owner revocation closes each existing session exactly once even when cleanup fails", async () => {
        const f = fixture();
        await f.open();
        f.forward.mockRejectedValueOnce(new Error("cleanup failed"));
        f.api.revokeOwner("local");
        f.api.revokeOwner("local");
        await Promise.resolve();
        await Promise.resolve();
        expect(f.forward.mock.calls.map(call => call[1].action)).toEqual(["open", "close"]);
    });
    it("removes failures without replay or raw error disclosure", async () => {
        const f = fixture(),
            id = await f.open();
        f.forward.mockRejectedValueOnce(new Error("synthetic-secret"));
        const result = await f.call("exchange", { id, message: "{}" });
        expect(result?.status).toBe(503);
        expect(JSON.stringify(result)).not.toContain("synthetic-secret");
        expect((await f.call("exchange", { id, message: "{}" }))?.status).toBe(404);
        expect(f.forward.mock.calls.map(call => call[1].action)).toEqual([
            "open",
            "exchange",
            "close",
        ]);
    });
    it("rejects malformed result and rejects foreign body fields before dispatch", async () => {
        const f = fixture(),
            id = await f.open();
        expect((await f.call("poll", { id, token: "secret" }))?.status).toBe(400);
        expect((await f.call("poll", { id: "invalid" }))?.status).toBe(400);
        f.forward.mockResolvedValueOnce({});
        expect((await f.call("poll", { id }))?.status).toBe(503);
        expect((await f.call("poll", { id }))?.status).toBe(404);
    });
    it("revocation prevents an in-flight response from becoming a live session", async () => {
        const f = fixture();
        let complete!: (result: GatewayMcpResult) => void;
        f.forward.mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    complete = resolve;
                }),
        );
        const opening = f.call("open");
        await Promise.resolve();
        await Promise.resolve();
        f.api.revokeOwner("local");
        complete({});
        expect((await opening)?.status).toBe(503);
    });
});
