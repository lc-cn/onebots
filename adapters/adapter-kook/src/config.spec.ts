import { describe, expect, test } from "vitest";
import { KookError } from "./errors.js";
import { assertKookConfig } from "./config.js";

describe("KOOK 运行时配置", () => {
    test("Webhook 模式必须显式配置 verify_token", () => {
        expect(() =>
            assertKookConfig({ account_id: "bot", token: "token", receive_mode: "webhook" }),
        ).toThrow(KookError);
    });

    test("限制 REST 重试次数", () => {
        expect(() =>
            assertKookConfig({ account_id: "bot", token: "token", max_retries: 11 }),
        ).toThrow("0 到 10");
    });

    test("manual 模式不要求 Webhook 凭据", () => {
        expect(() =>
            assertKookConfig({ account_id: "bot", token: "token", receive_mode: "manual" }),
        ).not.toThrow();
    });

    test("OAuth 关闭时不要求凭据，启用时闭合配置", () => {
        expect(() =>
            assertKookConfig({
                account_id: "bot",
                token: "token",
                oauth: { enabled: false },
            }),
        ).not.toThrow();
        expect(() =>
            assertKookConfig({
                account_id: "bot",
                token: "token",
                oauth: { enabled: true, client_id: "client" },
            } as never),
        ).toThrow("oauth.client_secret");
        expect(() =>
            assertKookConfig({
                account_id: "bot",
                token: "token",
                oauth: {
                    client_id: "client",
                    client_secret: "secret",
                    redirect_uri: "http://example.test/callback",
                },
            }),
        ).toThrow("HTTPS");
    });
});
