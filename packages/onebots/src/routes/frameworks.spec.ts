import type { RouterContext } from "@onebots/core";
import { describe, expect, it, vi } from "vitest";
import type { App } from "../app.js";
import { registerFrameworkRoutes } from "./frameworks.js";

type Handler = (ctx: RouterContext) => void | Promise<void>;

function setup() {
    const gets = new Map<string, Handler>();
    const posts = new Map<string, Handler>();
    const app = {
        runtimeContractId: "sha256:frameworks",
        info: { instance_id: "instance-a" },
        adapters: new Map(),
    } as App;
    registerFrameworkRoutes(app, {
        get: vi.fn((path: string, handler: Handler) => gets.set(path, handler)),
        post: vi.fn((path: string, handler: Handler) => posts.set(path, handler)),
    } as never);
    return { gets, posts };
}

describe("framework management routes", () => {
    it("公开可运行与调研阶段的 Application 注册状态", () => {
        const { gets } = setup();
        const ctx = { set: vi.fn() } as unknown as RouterContext;

        gets.get("/api/applications")!(ctx);

        expect(ctx.body).toMatchObject({
            schemaVersion: 1,
            registered: expect.arrayContaining([
                expect.objectContaining({ name: "koishi", stage: "available", active: false }),
                expect.objectContaining({ name: "avilla", stage: "planned", active: false }),
            ]),
            active: [],
            protocols: [],
        });
    });

    it("lists all profiles even when no bot account is configured", () => {
        const { gets } = setup();
        const ctx = { set: vi.fn() } as unknown as RouterContext;

        gets.get("/api/frameworks")!(ctx);

        expect(ctx.body).toMatchObject({
            schemaVersion: 1,
            frameworks: expect.arrayContaining([
                expect.objectContaining({ id: "koishi" }),
                expect.objectContaining({ id: "astrbot" }),
                expect.objectContaining({ id: "langbot" }),
                expect.objectContaining({ id: "alicebot" }),
                expect.objectContaining({ id: "kotori" }),
                expect.objectContaining({ id: "zhenxun" }),
            ]),
            ecosystem: expect.arrayContaining([
                expect.objectContaining({ id: "olivos", protocols: ["onebot.v11", "onebot.v12"] }),
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

    it("reports a missing dynamic framework provider without changing the catalog", async () => {
        const { posts } = setup();
        const ctx = {
            set: vi.fn(),
            request: { body: { provider: "definitely-missing-framework-provider" } },
        } as unknown as RouterContext;

        await posts.get("/api/frameworks/load")!(ctx);

        expect(ctx.status).toBe(400);
        expect(ctx.body).toMatchObject({ code: "FRAMEWORK_PROVIDER_LOAD_FAILED" });
    });
});
