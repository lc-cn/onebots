import type { Context } from "koa";
import { describe, expect, it, vi } from "vitest";
import { createDefaultRateLimit, createRateLimit } from "./rate-limit.js";

function requestContext(path: string, method = "GET", ip = "127.0.0.1") {
    const headers = new Map<string, string>();
    const context = {
        ip,
        method,
        path,
        request: { ip },
        status: 200,
        set: (name: string, value: string) => headers.set(name, value),
    } as unknown as Context;
    return { context, headers };
}

describe("default HTTP rate limit", () => {
    it("isolates the default per-IP budget by application instance", async () => {
        const first = createDefaultRateLimit();
        const second = createDefaultRateLimit();
        const next = vi.fn(async () => undefined);

        try {
            for (let attempt = 0; attempt < 100; attempt++) {
                await first(requestContext("/api/config").context, next);
            }
            const limited = requestContext("/api/config");
            await first(limited.context, next);
            expect(limited.context.status).toBe(429);
            expect(limited.headers.get("Retry-After")).toBeTruthy();

            const otherInstance = requestContext("/api/config");
            await second(otherInstance.context, next);

            expect(otherInstance.context.status).toBe(200);
        } finally {
            first.close();
            second.close();
        }
    });

    it("does not count explicitly skipped observability paths", async () => {
        const limiter = createDefaultRateLimit({ skip: ctx => ctx.path === "/gateway/health" });
        const next = vi.fn(async () => undefined);

        try {
            for (let attempt = 0; attempt < 105; attempt++) {
                const request = requestContext("/gateway/health");
                await limiter(request.context, next);
                expect(request.context.status).toBe(200);
                expect(request.headers.size).toBe(0);
            }
            expect(next).toHaveBeenCalledTimes(105);
        } finally {
            limiter.close();
        }
    });

    it("treats prototype property names from custom key generators as ordinary keys", async () => {
        const limiter = createRateLimit({
            windowMs: 60_000,
            max: 1,
            keyGenerator: () => "__proto__",
        });
        const next = vi.fn(async () => undefined);

        try {
            await limiter(requestContext("/custom").context, next);
            const limited = requestContext("/custom");
            await limiter(limited.context, next);

            expect(next).toHaveBeenCalledOnce();
            expect(limited.context.status).toBe(429);
            expect(Object.prototype).not.toHaveProperty("count");
        } finally {
            limiter.close();
        }
    });
});
