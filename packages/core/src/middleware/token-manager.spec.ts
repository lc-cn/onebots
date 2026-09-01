import { afterEach, describe, expect, it, vi } from "vitest";
import { Logger } from "../logger.js";
import { TokenManager } from "./token-manager.js";

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("TokenManager credential rotation", () => {
    it("访问令牌过期后保留仍在有效期内的刷新令牌", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
        const manager = new TokenManager({
            defaultExpiration: 1_000,
            refreshExpiration: 10_000,
        });
        const original = manager.generateToken({ username: "admin" });

        vi.advanceTimersByTime(1_001);
        expect(manager.validateToken(original.token)).toMatchObject({
            valid: false,
            expired: true,
        });
        const refreshed = manager.refreshToken(original.refreshToken!);

        expect(refreshed).not.toBeNull();
        expect(manager.validateToken(refreshed!.token).valid).toBe(true);
    });

    it("批量清理按访问与刷新令牌各自的过期时间处理", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
        const manager = new TokenManager({
            defaultExpiration: 1_000,
            refreshExpiration: 10_000,
        });
        const original = manager.generateToken();

        vi.advanceTimersByTime(1_001);
        expect(manager.cleanup()).toBe(1);
        expect(manager.refreshToken(original.refreshToken!)).not.toBeNull();
    });

    it("刷新令牌自身过期后拒绝续期并清除对应访问令牌", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
        const manager = new TokenManager({
            defaultExpiration: 1_000,
            refreshExpiration: 2_000,
        });
        const original = manager.generateToken();

        vi.advanceTimersByTime(2_001);
        expect(manager.refreshToken(original.refreshToken!)).toBeNull();
        expect(manager.getTokenInfo(original.token)).toBeUndefined();
    });

    it("签发新会话时按清理周期回收过期记录而不依赖后台定时器", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
        const manager = new TokenManager({
            defaultExpiration: 1_000,
            refreshExpiration: 2_000,
        });
        const expired = manager.generateToken();

        vi.advanceTimersByTime(5 * 60 * 1_000);
        const active = manager.generateToken();

        expect(manager.getTokenInfo(expired.token)).toBeUndefined();
        expect(manager.refreshToken(expired.refreshToken!)).toBeNull();
        expect(manager.validateToken(active.token).valid).toBe(true);
    });

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
