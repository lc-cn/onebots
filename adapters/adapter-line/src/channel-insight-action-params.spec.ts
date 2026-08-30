import { describe, expect, it } from "vitest";
import {
    acquireChatControlRequest,
    createLiffRequest,
    missionStickerRequest,
    moduleLimit,
    requireAuthorizationCodeGrant,
    updateLiffRequest,
} from "./channel-action-params.js";
import {
    aggregationUnit,
    membershipId,
    membershipLimit,
    requireLineDateRange,
} from "./insight-action-params.js";

describe("LINE LIFF 与 Module 参数", () => {
    it("解析闭合的 LIFF 创建请求", () => {
        expect(
            createLiffRequest({
                request: {
                    view: { type: "full", url: "https://example.test/app", moduleMode: true },
                    scope: ["openid", "profile"],
                    permanentLinkPattern: "concat",
                    botPrompt: "normal",
                },
            }),
        ).toMatchObject({
            view: { type: "full", url: "https://example.test/app", moduleMode: true },
            scope: ["openid", "profile"],
        });
    });

    it("拒绝 LIFF 未知字段、fragment 与空更新", () => {
        expect(() =>
            createLiffRequest({
                request: { view: { type: "full", url: "https://example.test/#fragment" } },
            }),
        ).toThrow(/fragment/u);
        expect(() =>
            createLiffRequest({
                request: { view: { type: "wide", url: "https://example.test/" } },
            }),
        ).toThrow(/不受支持/u);
        expect(() => updateLiffRequest({ request: {} })).toThrow(/至少包含一个字段/u);
        expect(() => updateLiffRequest({ request: { view: {} } })).toThrow(/view 至少/u);
        expect(() => updateLiffRequest({ request: { description: "app", unknown: true } })).toThrow(
            /unknown/u,
        );
    });

    it("校验 Chat Control、Module 与 Mission Sticker 官方常量", () => {
        expect(acquireChatControlRequest({ request: { expired: true, ttl: 3600 } })).toEqual({
            expired: true,
            ttl: 3600,
        });
        expect(moduleLimit({ limit: 100 })).toBe(100);
        expect(requireAuthorizationCodeGrant({ grant_type: "authorization_code" })).toBe(
            "authorization_code",
        );
        expect(
            missionStickerRequest({
                request: {
                    to: "U1",
                    productId: "product",
                    productType: "STICKER",
                    sendPresentMessage: false,
                },
            }),
        ).toMatchObject({ productType: "STICKER", sendPresentMessage: false });

        expect(() => acquireChatControlRequest({ request: { ttl: 31_536_001 } })).toThrow(
            /31536000/u,
        );
        expect(() => moduleLimit({ limit: 101 })).toThrow(/1 到 100/u);
        expect(() => requireAuthorizationCodeGrant({ grant_type: "client_credentials" })).toThrow(
            /authorization_code/u,
        );
        expect(() =>
            missionStickerRequest({
                request: {
                    to: "U1",
                    productId: "product",
                    productType: "IMAGE",
                    sendPresentMessage: false,
                },
            }),
        ).toThrow(/STICKER/u);
    });
});

describe("LINE 洞察参数", () => {
    it("闭合会员、聚合单位与日期范围", () => {
        expect(membershipId({ membership_id: 1 })).toBe(1);
        expect(membershipLimit({ limit: 1000 })).toBe(1000);
        expect(aggregationUnit({ unit: "campaign" })).toBe("campaign");
        expect(requireLineDateRange({ from: "20240101", to: "20240131" }, 30)).toEqual([
            "20240101",
            "20240131",
        ]);
    });

    it("拒绝倒序、超长范围与无效边界", () => {
        expect(() => membershipId({ membership_id: 0 })).toThrow(/正整数/u);
        expect(() => membershipLimit({ limit: 1001 })).toThrow(/1 到 1000/u);
        expect(() => aggregationUnit({ unit: "x".repeat(31) })).toThrow(/30/u);
        expect(() => requireLineDateRange({ from: "20240102", to: "20240101" }, 30)).toThrow(
            /不能早于/u,
        );
        expect(() => requireLineDateRange({ from: "20240101", to: "20240201" }, 30)).toThrow(
            /30 天/u,
        );
    });
});
