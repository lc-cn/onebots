import { describe, expect, it } from "vitest";
import { TokenManager } from "./token-manager.js";

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
});
