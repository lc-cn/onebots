import { ErrorCategory } from "onebots";
import { describe, expect, it } from "vitest";
import { assertZulipConfig } from "./config.js";
import type { ZulipConfig } from "./types.js";

const config: ZulipConfig = {
    account_id: "bot",
    server_url: "https://example.zulipchat.com",
    email: "bot@example.com",
    api_key: "secret",
};

describe("Zulip 配置", () => {
    it("接受 HTTPS 与本机 HTTP 组织根地址", () => {
        expect(() => assertZulipConfig(config)).not.toThrow();
        expect(() =>
            assertZulipConfig({ ...config, server_url: "http://127.0.0.1:9991" }),
        ).not.toThrow();
    });

    it("拒绝未知、重复事件和倒置退避", () => {
        expect(() =>
            assertZulipConfig({
                ...config,
                event_queue: { event_types: ["message", "message"] },
            }),
        ).toThrowError(expect.objectContaining({ category: ErrorCategory.CONFIG }));
        expect(() =>
            assertZulipConfig({
                ...config,
                event_queue: { retry_initial_delay_ms: 2_000, retry_max_delay_ms: 1_000 },
            }),
        ).toThrowError(expect.objectContaining({ code: "ZULIP_INVALID_CONFIG" }));
        expect(() => assertZulipConfig({ ...config, receive_mode: "websocket" as never })).toThrow(
            /仅支持 event_queue 或 manual/u,
        );
        expect(() =>
            assertZulipConfig({
                ...config,
                event_queue: { enabled: false } as never,
            }),
        ).toThrow(/event_queue.enabled 已移除/u);
    });
});
