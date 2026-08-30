import { describe, expect, it } from "vitest";
import { buildICQQClientConfig, parseICQQNumericId, parseICQQUin } from "./client-config.js";

describe("ICQQ 客户端配置", () => {
    it("保留显式关闭值，不用默认值覆盖 false 或 0", () => {
        expect(
            buildICQQClientConfig({
                account_id: "10000",
                protocol: {
                    log_level: "warn",
                    ignore_self: false,
                    resend: false,
                    reconn_interval: 0,
                    cache_group_member: false,
                    auto_server: false,
                    QQNT: false,
                    NTLogin: false,
                },
            }),
        ).toMatchObject({
            ignore_self: false,
            resend: false,
            reconn_interval: 0,
            cache_group_member: false,
            auto_server: false,
            log_level: "warn",
            QQNT: false,
            NTLogin: false,
        });
    });

    it("拒绝 parseInt 会部分接受的非法账号", () => {
        expect(() => parseICQQUin("12345tail")).toThrow("正安全整数");
        expect(parseICQQUin("12345")).toBe(12345);
        expect(() => parseICQQNumericId("NaN", "group_id")).toThrow("group_id");
    });
});
