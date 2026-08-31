import { afterEach, describe, expect, it, vi } from "vitest";
import { Logger } from "../logger.js";
import { TokenManager } from "./token-manager.js";

afterEach(() => {
    vi.restoreAllMocks();
});

describe("TokenManager credential rotation", () => {
    it("一次撤销全部访问与刷新令牌", () => {
        const manager = new TokenManager();
        const first = manager.generateToken({ username: "first" });
        const second = manager.generateToken({ username: "second" });

        expect(manager.revokeAll()).toBe(2);
        expect(manager.validateToken(first.token).valid).toBe(false);
        expect(manager.validateToken(second.token).valid).toBe(false);
        expect(manager.refreshToken(first.refreshToken!)).toBeNull();
        expect(manager.refreshToken(second.refreshToken!)).toBeNull();
        expect(manager.revokeAll()).toBe(0);
    });

    it("令牌生命周期日志只使用秘密证据，不保留访问令牌前缀", () => {
        const debug = vi.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
        const info = vi.spyOn(Logger.prototype, "info").mockImplementation(() => undefined);
        const manager = new TokenManager();

        const original = manager.generateToken();
        const refreshed = manager.refreshToken(original.refreshToken!);
        expect(refreshed).not.toBeNull();
        manager.revokeToken(refreshed!.token);

        const logs = JSON.stringify([...debug.mock.calls, ...info.mock.calls]);
        expect(logs).not.toContain(original.token);
        expect(logs).not.toContain(original.token.slice(0, 10));
        expect(logs).not.toContain(original.refreshToken!);
        expect(logs).not.toContain(refreshed!.token);
        expect(logs).not.toContain(refreshed!.token.slice(0, 10));
        expect(logs).not.toContain(refreshed!.refreshToken!);
        expect(logs).not.toContain("tokenPrefix");
        expect(logs).toMatch(/"fingerprint":"[a-f0-9]{16}"/u);
    });
});
