import { describe, expect, it } from "vitest";
import { parseAdapterInventory } from "./adapter-inventory.js";

describe("adapter runtime inventory", () => {
    it("接受身份闭合的零账号和已配置适配器", () => {
        const value = [
            { platform: "mock", accounts: [] },
            {
                platform: "qq",
                accounts: [{ uin: "bot", platform: "qq", protocols: [] }],
            },
        ];
        expect(parseAdapterInventory(value)).toBe(value);
    });

    it("拒绝重复平台、重复账号和跨平台账号身份", () => {
        expect(() =>
            parseAdapterInventory([
                { platform: "mock", accounts: [] },
                { platform: "mock", accounts: [] },
            ]),
        ).toThrow("重复平台");
        expect(() =>
            parseAdapterInventory([
                {
                    platform: "mock",
                    accounts: [
                        { uin: "bot", platform: "mock", protocols: [] },
                        { uin: "bot", platform: "mock", protocols: [] },
                    ],
                },
            ]),
        ).toThrow("重复账号");
        expect(() =>
            parseAdapterInventory([
                {
                    platform: "mock",
                    accounts: [{ uin: "bot", platform: "other", protocols: [] }],
                },
            ]),
        ).toThrow("平台身份不一致");
    });

    it("拒绝缺少账号或协议生命周期数组的条目", () => {
        expect(() => parseAdapterInventory([{ platform: "mock" }])).toThrow("缺少账号数组");
        expect(() =>
            parseAdapterInventory([
                { platform: "mock", accounts: [{ uin: "bot", platform: "mock" }] },
            ]),
        ).toThrow("缺少协议生命周期数组");
    });
});
