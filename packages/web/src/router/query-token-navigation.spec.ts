import { describe, expect, it, vi } from "vitest";
import { resolveQueryTokenNavigation } from "./query-token-navigation.js";

const target = {
    path: "/bots",
    hash: "#capabilities",
    query: { access_token: " candidate ", filter: "telegram" },
};

describe("URL 鉴权码导航", () => {
    it("只在服务端验证成功后进入去除鉴权码的目标", async () => {
        const authenticate = vi.fn(async () => ({ ok: true }));

        await expect(
            resolveQueryTokenNavigation(target, {
                authenticate,
                hasExistingSession: () => false,
            }),
        ).resolves.toEqual({
            path: "/bots",
            query: { filter: "telegram" },
            hash: "#capabilities",
            replace: true,
        });
        expect(authenticate).toHaveBeenCalledWith("candidate");
    });

    it("无效鉴权码不会提交，并将无秘密的原目标交给登录页", async () => {
        const authenticate = vi.fn(async () => ({ ok: false }));

        await expect(
            resolveQueryTokenNavigation(target, {
                authenticate,
                hasExistingSession: () => false,
            }),
        ).resolves.toEqual({
            path: "/login",
            query: {
                redirect: "/bots?filter=telegram#capabilities",
                reason: "invalid_token",
            },
            replace: true,
        });
    });

    it("无效链接保留已有会话并只清理地址栏中的鉴权码", async () => {
        await expect(
            resolveQueryTokenNavigation(target, {
                authenticate: async () => ({ ok: false }),
                hasExistingSession: () => true,
            }),
        ).resolves.toEqual({
            path: "/bots",
            query: { filter: "telegram" },
            hash: "#capabilities",
            replace: true,
        });
    });

    it("网络失败时不伪装成凭据错误，且重复参数不会进入验证器", async () => {
        await expect(
            resolveQueryTokenNavigation(target, {
                authenticate: async () => {
                    throw new Error("offline");
                },
                hasExistingSession: () => false,
            }),
        ).resolves.toMatchObject({
            path: "/login",
            query: { reason: "token_unavailable" },
        });

        const authenticate = vi.fn(async () => ({ ok: true }));
        await resolveQueryTokenNavigation(
            { ...target, query: { access_token: ["first", "second"] } },
            { authenticate, hasExistingSession: () => false },
        );
        expect(authenticate).not.toHaveBeenCalled();
    });

    it("没有鉴权码参数时不参与现有路由判定", async () => {
        await expect(
            resolveQueryTokenNavigation(
                { ...target, query: { filter: "telegram" } },
                { authenticate: vi.fn(), hasExistingSession: () => false },
            ),
        ).resolves.toBeNull();
    });
});
