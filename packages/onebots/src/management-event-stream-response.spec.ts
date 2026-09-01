import type { RouterContext } from "@onebots/core";
import { describe, expect, it, vi } from "vitest";
import { prepareManagementEventStream } from "./management-event-stream-response.js";

describe("management event-stream response", () => {
    it("disables storage, transformation, and proxy buffering", () => {
        const socket = {
            setTimeout: vi.fn(),
            setNoDelay: vi.fn(),
            setKeepAlive: vi.fn(),
        };
        const set = vi.fn();
        const ctx = {
            request: { socket },
            req: { socket },
            set,
        } as unknown as RouterContext;

        prepareManagementEventStream(ctx);

        expect(socket.setTimeout).toHaveBeenCalledWith(0);
        expect(socket.setNoDelay).toHaveBeenCalledWith(true);
        expect(socket.setKeepAlive).toHaveBeenCalledWith(true);
        expect(set).toHaveBeenCalledWith({
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-store, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type",
        });
        expect(ctx.status).toBe(200);
        expect(ctx.respond).toBe(false);
    });
});
