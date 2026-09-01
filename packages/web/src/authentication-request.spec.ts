import { describe, expect, it } from "vitest";
import {
    authenticationRequestErrorMessage,
    authenticationRequestInit,
} from "./authentication-request.js";

describe("认证请求时间边界", () => {
    it("默认禁用缓存并在时间边界后取消请求", async () => {
        const init = authenticationRequestInit({ method: "POST" }, 1);
        const signal = init.signal!;

        expect(init).toMatchObject({ method: "POST", cache: "no-store", redirect: "error" });
        await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve()));
        expect(signal.aborted).toBe(true);
        expect(signal.reason).toMatchObject({ name: "TimeoutError" });
    });

    it("调用方取消会立即传播到组合信号", () => {
        const controller = new AbortController();
        const signal = authenticationRequestInit({ signal: controller.signal }).signal!;

        controller.abort();

        expect(signal.aborted).toBe(true);
        expect(signal.reason).toMatchObject({ name: "AbortError" });
    });

    it("为超时、主动取消和普通网络失败提供不同诊断", () => {
        expect(
            authenticationRequestErrorMessage(new DOMException("timeout", "TimeoutError")),
        ).toContain("超时");
        expect(
            authenticationRequestErrorMessage(new DOMException("cancel", "AbortError")),
        ).toContain("取消");
        expect(authenticationRequestErrorMessage(new TypeError("fetch failed"))).toContain(
            "无法连接",
        );
    });
});
