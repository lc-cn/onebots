import { AccountMutationConflictError, type RouterContext } from "@onebots/core";
import { describe, expect, it, vi } from "vitest";
import type { App } from "../app.js";
import { registerAdapterRoutes } from "./adapter-api.js";

type RouteHandler = (ctx: RouterContext) => void | Promise<void>;

function setup(overrides: Partial<App> = {}) {
    const gets = new Map<string, RouteHandler>();
    const posts = new Map<string, RouteHandler>();
    const app = {
        adapterInfos: [],
        accounts: [],
        adapters: new Map(),
        addAccount: vi.fn(async () => undefined),
        updateAccount: vi.fn(async () => undefined),
        removeAccount: vi.fn(async () => undefined),
        ...overrides,
    } as unknown as App;
    registerAdapterRoutes(app, {
        get: vi.fn((route: string, handler: RouteHandler) => gets.set(route, handler)),
        post: vi.fn((route: string, handler: RouteHandler) => posts.set(route, handler)),
    } as never);
    return { app, gets, posts };
}

describe("adapter account routes", () => {
    it("账号配置事务冲突返回 409", async () => {
        const addAccount = vi.fn(async () => {
            throw new AccountMutationConflictError();
        });
        const { posts } = setup({ addAccount } as Partial<App>);
        const ctx = {
            request: { body: { platform: "mock", account_id: "10001" } },
        } as RouterContext;

        await posts.get("/api/add")!(ctx);

        expect(ctx.status).toBe(409);
        expect(ctx.body).toEqual({
            success: false,
            message: "OneBots 配置正在变更，请稍后重试账号操作",
        });
    });

    it.each([
        ["false", false],
        ["0", false],
        ["true", true],
        ["1", true],
    ])("将 force=%s 解析为 %s", async (force, expected) => {
        const { app, gets } = setup();
        const ctx = {
            request: { query: { platform: "mock", uin: "10001", force } },
        } as unknown as RouterContext;

        await gets.get("/api/remove")!(ctx);

        expect(app.removeAccount).toHaveBeenCalledWith("mock", "10001", expected);
        expect(ctx.body).toEqual({ success: true, message: "移除成功" });
    });
});
