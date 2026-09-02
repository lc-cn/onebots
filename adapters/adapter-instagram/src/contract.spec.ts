import { AdapterRegistry, type ValidationRule } from "onebots";
import { describe, expect, it } from "vitest";
import { instagramSchema } from "./index.js";
import { assertInstagramConfig } from "./validation.js";

describe("Instagram 配置与注册契约", () => {
    it("Schema 注册成功，并用结构化动态字段表达接收和过滤", () => {
        expect(AdapterRegistry.getSchema("instagram")).toBeDefined();
        expect(rule("receive_mode").choices?.map(choice => choice.value)).toEqual([
            "webhook",
            "manual",
        ]);
        for (const field of ["subscribed_fields", "event_types", "declared_permissions"]) {
            expect(rule(field)).toMatchObject({ type: "array", ui: { widget: "choice-list" } });
        }
        expect(rule("verify_token").ui?.visibleWhen).toEqual({
            path: "receive_mode",
            oneOf: ["webhook"],
        });
        for (const field of ["access_token", "app_secret", "verify_token"]) {
            expect(rule(field).sensitive).toBe(true);
        }
    });

    it("运行时校验闭合 webhook 凭据、账号 ID 与官方稳定订阅字段", () => {
        expect(() =>
            assertInstagramConfig({
                account_id: "account",
                instagram_user_id: "100",
                access_token: "token",
                receive_mode: "manual",
            }),
        ).not.toThrow();
        expect(() =>
            assertInstagramConfig({
                account_id: "account",
                instagram_user_id: "username",
                access_token: "token",
                receive_mode: "manual",
            }),
        ).toThrow(/Meta ID/u);
        expect(() =>
            assertInstagramConfig({
                account_id: "account",
                instagram_user_id: "100",
                access_token: "token",
                receive_mode: "webhook",
            }),
        ).toThrow(/app_secret/u);
        expect(() =>
            assertInstagramConfig({
                account_id: "account",
                instagram_user_id: "100",
                access_token: "token",
                receive_mode: "manual",
                subscribed_fields: ["future_field"],
            }),
        ).toThrow(/未定义字段/u);
    });
});

function rule(name: string): ValidationRule {
    const value = instagramSchema[name] as ValidationRule | undefined;
    if (!value || !("type" in value)) throw new Error(`Schema 字段不存在: ${name}`);
    return value;
}
