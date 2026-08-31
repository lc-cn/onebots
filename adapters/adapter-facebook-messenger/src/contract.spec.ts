import { AdapterRegistry, type ValidationRule } from "onebots";
import { describe, expect, it } from "vitest";
import { describeFacebookMessengerCapabilities } from "./capabilities.js";
import { facebookMessengerSchema } from "./index.js";
import { assertFacebookMessengerConfig } from "./validation.js";

describe("Facebook Messenger 配置与能力契约", () => {
    it("Schema 注册成功，并用结构化动态字段表达接收和过滤", () => {
        expect(AdapterRegistry.getSchema("facebook-messenger")).toBeDefined();
        expect(rule("receive_mode").choices?.map(choice => choice.value)).toEqual([
            "webhook",
            "manual",
        ]);
        for (const field of ["subscribed_fields", "event_types", "declared_permissions"]) {
            expect(rule(field)).toMatchObject({
                type: "array",
                ui: { widget: "choice-list" },
            });
        }
        expect(rule("verify_token").ui?.visibleWhen).toEqual({
            path: "receive_mode",
            oneOf: ["webhook"],
        });
        for (const field of ["page_access_token", "app_secret", "verify_token"]) {
            expect(rule(field).sensitive).toBe(true);
        }
    });

    it("运行时校验闭合 webhook 凭据、Page ID 和稳定订阅字段", () => {
        expect(() =>
            assertFacebookMessengerConfig({
                account_id: "page",
                page_id: "100",
                page_access_token: "token",
                receive_mode: "manual",
            }),
        ).not.toThrow();
        expect(() =>
            assertFacebookMessengerConfig({
                account_id: "page",
                page_id: "page",
                page_access_token: "token",
                receive_mode: "manual",
            }),
        ).toThrow(/Meta ID/u);
        expect(() =>
            assertFacebookMessengerConfig({
                account_id: "page",
                page_id: "100",
                page_access_token: "token",
                receive_mode: "webhook",
            }),
        ).toThrow(/app_secret/u);
        expect(() =>
            assertFacebookMessengerConfig({
                account_id: "page",
                page_id: "100",
                page_access_token: "token",
                receive_mode: "manual",
                subscribed_fields: ["future_field"],
            }),
        ).toThrow(/未定义字段/u);
        expect(() =>
            assertFacebookMessengerConfig({
                account_id: "page",
                page_id: "100",
                page_access_token: "token",
                receive_mode: "manual",
                event_types: ["future_event" as "message"],
            }),
        ).toThrow(/未定义事件/u);
    });

    it("Utility Messaging 只有声明对应权限时才展示为可用", () => {
        const messagingOnly = describeFacebookMessengerCapabilities({
            declared_permissions: ["pages_messaging"],
        });
        expect(messagingOnly.actions.send_facebook_messenger_utility_template?.support).toBe(
            "unsupported",
        );
        const utility = describeFacebookMessengerCapabilities({
            declared_permissions: ["page_utility_messaging"],
        });
        expect(utility.actions.send_facebook_messenger_utility_template?.support).toBe("native");
    });
});

function rule(name: string): ValidationRule {
    const value = facebookMessengerSchema[name] as ValidationRule | undefined;
    if (!value || !("type" in value)) throw new Error(`Schema 字段不存在: ${name}`);
    return value;
}
