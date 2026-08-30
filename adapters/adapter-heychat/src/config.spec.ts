import { describe, expect, it } from "vitest";
import { assertHeychatConfig, resolveHeychatReceiveMode } from "./config.js";

describe("Heychat 配置", () => {
    it("闭合接收模式并保留 websocket 默认值", () => {
        expect(() => assertHeychatConfig({ account_id: "bot", token: "token" })).not.toThrow();
        expect(() =>
            assertHeychatConfig({ account_id: "bot", token: "token", receive_mode: "manual" }),
        ).not.toThrow();
        expect(resolveHeychatReceiveMode({})).toBe("websocket");
        expect(resolveHeychatReceiveMode({ receive_mode: "manual" })).toBe("manual");
    });

    it("在创建传输前拒绝缺失凭据、未知模式与无效退避", () => {
        expect(() => assertHeychatConfig({ account_id: "bot", token: "" })).toThrowError(
            expect.objectContaining({ code: "HEYCHAT_INVALID_CONFIG" }),
        );
        expect(() =>
            assertHeychatConfig({
                account_id: "bot",
                token: "token",
                receive_mode: "gateway" as never,
            }),
        ).toThrowError(expect.objectContaining({ code: "HEYCHAT_INVALID_CONFIG" }));
        expect(() =>
            assertHeychatConfig({
                account_id: "bot",
                token: "token",
                reconnect_initial_delay_ms: 2_000,
                reconnect_max_delay_ms: 1_000,
            }),
        ).toThrowError(expect.objectContaining({ code: "HEYCHAT_INVALID_CONFIG" }));
        expect(() =>
            assertHeychatConfig({
                account_id: "bot",
                token: "token",
                oauth: {
                    client_id: "client",
                    client_secret: "",
                    redirect_uri: "not-a-url",
                },
            }),
        ).toThrowError(expect.objectContaining({ code: "HEYCHAT_INVALID_CONFIG" }));
        expect(() =>
            assertHeychatConfig({
                account_id: "bot",
                token: "token",
                oauth: { enabled: false },
            }),
        ).not.toThrow();
    });
});
