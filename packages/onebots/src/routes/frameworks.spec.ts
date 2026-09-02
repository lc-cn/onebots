import type { RouterContext } from "@onebots/core";
import { describe, expect, it, vi } from "vitest";
import type { App } from "../app.js";
import { registerFrameworkRoutes } from "./frameworks.js";

type Handler = (ctx: RouterContext) => void;

function setup() {
    const gets = new Map<string, Handler>();
    const posts = new Map<string, Handler>();
    const app = {
        runtimeContractId: "sha256:frameworks",
        info: { instance_id: "instance-a" },
    } as App;
    registerFrameworkRoutes(app, {
        get: vi.fn((path: string, handler: Handler) => gets.set(path, handler)),
        post: vi.fn((path: string, handler: Handler) => posts.set(path, handler)),
    } as never);
    return { gets, posts };
}

describe("framework management routes", () => {
    it("lists all profiles even when no bot account is configured", () => {
        const { gets } = setup();
        const ctx = { set: vi.fn() } as unknown as RouterContext;

        gets.get("/api/frameworks")!(ctx);

        expect(ctx.body).toMatchObject({
            schemaVersion: 1,
            frameworks: expect.arrayContaining([
                expect.objectContaining({ id: "koishi" }),
                expect.objectContaining({ id: "zhenxun" }),
            ]),
            ecosystem: expect.arrayContaining([
                expect.objectContaining({ id: "astrbot", priority: "next" }),
                expect.objectContaining({ id: "kovi", protocols: ["milky.v1", "onebot.v11"] }),
            ]),
        });
    });

    it("creates a redacted plan and rejects invalid input", () => {
        const { posts } = setup();
        const valid = {
            set: vi.fn(),
            request: { body: { framework: "zhin", account: "qq.main" } },
        } as unknown as RouterContext;
        posts.get("/api/frameworks/plan")!(valid);
        expect(valid.body).toMatchObject({
            framework: { id: "zhin" },
            account: { key: "qq.main" },
        });
        expect(JSON.stringify(valid.body)).toContain("<shared-token>");

        const invalid = {
            set: vi.fn(),
            request: { body: { framework: "unknown", account: "qq.main" } },
        } as unknown as RouterContext;
        posts.get("/api/frameworks/plan")!(invalid);
        expect(invalid.status).toBe(400);
        expect(invalid.body).toMatchObject({ code: "FRAMEWORK_PLAN_INVALID" });
    });
});
