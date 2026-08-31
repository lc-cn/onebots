import crypto from "node:crypto";
import type { Context, Next } from "koa";
import { describe, expect, it, vi } from "vitest";
import { TokenManager } from "./token-manager.js";
import { createHMACValidator, createManagedTokenValidator } from "./token-validator.js";

function context(options: {
    authorization?: string;
    query?: Record<string, string | string[]>;
    body?: unknown;
}): Context {
    return {
        get: vi.fn((name: string) =>
            name.toLowerCase() === "authorization" ? options.authorization || "" : "",
        ),
        path: "/test",
        query: options.query ?? {},
        request: { body: options.body },
        state: {},
        status: 404,
    } as unknown as Context;
}

describe("token validators", () => {
    it("managed validator respects token sources and custom validation", async () => {
        const manager = new TokenManager();
        const { token } = manager.generateToken({ role: "admin" });
        const validator = vi.fn((value: string) => value === token);
        const middleware = createManagedTokenValidator(manager, {
            fromHeader: false,
            fromQuery: true,
            validator,
        });
        const next = vi.fn<Next>();

        const headerOnly = context({ authorization: `Bearer ${token}` });
        await middleware(headerOnly, next);
        expect(headerOnly.status).toBe(401);
        expect(validator).not.toHaveBeenCalled();

        const query = context({ query: { access_token: token } });
        await middleware(query, next);
        expect(next).toHaveBeenCalledOnce();
        expect(validator).toHaveBeenCalledWith(token, query);
        expect(query.state.tokenInfo).toMatchObject({ metadata: { role: "admin" } });
    });

    it("rejects a managed token when the additional validator rejects it", async () => {
        const manager = new TokenManager();
        const { token } = manager.generateToken();
        const middleware = createManagedTokenValidator(manager, {
            validator: () => false,
            errorMessage: "scope denied",
        });
        const ctx = context({ authorization: `Bearer ${token}` });

        await middleware(ctx, vi.fn<Next>());

        expect(ctx.status).toBe(401);
        expect(ctx.body).toEqual({ error: "Unauthorized", message: "scope denied" });
    });

    it("treats malformed HMAC signatures as authentication failures instead of throwing", async () => {
        const body = { event: "message" };
        const secret = "secret";
        const validSignature = crypto
            .createHmac("sha256", secret)
            .update(JSON.stringify(body))
            .digest("hex");
        const middleware = createHMACValidator(secret);
        const next = vi.fn<Next>();

        const malformed = context({ body });
        Object.assign(malformed, { get: () => "short" });
        await expect(middleware(malformed, next)).resolves.toBeUndefined();
        expect(malformed.status).toBe(401);

        const valid = context({ body });
        Object.assign(valid, { get: () => validSignature });
        await middleware(valid, next);
        expect(next).toHaveBeenCalledOnce();
    });
});
