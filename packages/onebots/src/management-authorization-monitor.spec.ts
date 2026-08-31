import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TokenManager } from "@onebots/core";
import { startManagementAuthorizationMonitor } from "./management-authorization-monitor.js";

describe("management authorization monitor", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("会话自然过期后只通知一次并停止定时器", () => {
        const tokenManager = new TokenManager({ defaultExpiration: 150 });
        const session = tokenManager.generateToken({ username: "admin" });
        const onAuthorized = vi.fn();
        const onUnauthorized = vi.fn();
        startManagementAuthorizationMonitor({ config: {}, tokenManager }, session.token, {
            onAuthorized,
            onUnauthorized,
            intervalMs: 100,
        });

        vi.advanceTimersByTime(100);
        vi.advanceTimersByTime(500);

        expect(onAuthorized).toHaveBeenCalledOnce();
        expect(onUnauthorized).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("配置 token 保持有效，显式 stop 幂等取消后续校验", () => {
        const tokenManager = new TokenManager();
        const onAuthorized = vi.fn();
        const stop = startManagementAuthorizationMonitor(
            { config: { access_token: "configured" }, tokenManager },
            "configured",
            { onAuthorized, onUnauthorized: vi.fn(), intervalMs: 100 },
        );

        vi.advanceTimersByTime(200);
        stop();
        stop();
        vi.advanceTimersByTime(500);

        expect(onAuthorized).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
    });
});
