import { describe, expect, it } from "vitest";
import { BaseApp } from "./base-app.js";
import {
    assertAccountIdentifier,
    assertAccountIdentity,
    parseAccountConfigKey,
} from "./account-config.js";

describe("account config identity", () => {
    it.each(["bot-1", "mail@example.com", "中文.主账号", "team:primary", "bot_name"])(
        "接受可稳定组成配置键和 URL 路径的账号标识 %s",
        accountId => {
            expect(() => assertAccountIdentifier("account_id", accountId)).not.toThrow();
            expect(() =>
                assertAccountIdentity({ platform: "mock", account_id: accountId }),
            ).not.toThrow();
        },
    );

    it.each([
        "",
        " ",
        "bot name",
        "bot/name",
        "bot\\name",
        "bot%2Fchild",
        "bot?x",
        "bot#x",
        ".",
        "..",
        "bot\u0000name",
    ])("拒绝会形成空身份或歧义 URL 的账号标识 %#", accountId => {
        expect(() => assertAccountIdentifier("account_id", accountId)).toThrow(
            /账号配置字段 account_id/,
        );
    });

    it("只按第一个点号拆分账号配置键", () => {
        expect(parseAccountConfigKey("telegram.bot.eu")).toEqual({
            platform: "telegram",
            account_id: "bot.eu",
        });
        expect(parseAccountConfigKey("general")).toBeNull();
    });

    it.each([".bot", "mock.", "mock.   ", "mock..", "mock.%2F"])("拒绝畸形账号配置键 %s", key => {
        expect(() => parseAccountConfigKey(key)).toThrow(/账号配置字段/);
    });

    it("BaseApp 的嵌入式配置入口复用同一账号键解析边界", () => {
        const getter = Object.getOwnPropertyDescriptor(BaseApp.prototype, "adapterConfigs")?.get;

        expect(() => getter?.call({ config: { "mock.": {} } })).toThrow(/账号配置字段 account_id/);
    });
});
