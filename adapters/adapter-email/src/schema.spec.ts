import { describe, expect, it } from "vitest";
import { emailSchema } from "./index.js";

describe("邮件配置 Schema", () => {
    it("按认证方式动态展示单一凭据", () => {
        const auth = emailSchema.auth;
        expect(auth?.method?.choices).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ value: "password" }),
                expect.objectContaining({ value: "oauth2" }),
            ]),
        );
        expect(auth?.method?.ui?.inferValueFromPresence).toEqual([
            { path: "auth.access_token", value: "oauth2" },
            { path: "auth.password", value: "password" },
        ]);
        expect(auth?.user?.ui?.visibleWhen).toBeUndefined();
        expect(auth?.password?.ui?.visibleWhen).toEqual({
            path: "auth.method",
            oneOf: ["password"],
        });
        expect(auth?.access_token?.ui?.visibleWhen).toEqual({
            path: "auth.method",
            oneOf: ["oauth2"],
        });
    });

    it("为 SMTP 与 IMAP 数值提供静态边界", () => {
        expect(emailSchema.smtp?.port?.max).toBe(65_535);
        expect(emailSchema.imap?.retry_initial_delay_ms?.min).toBe(100);
        expect(emailSchema.imap?.retry_max_delay_ms?.min).toBe(1_000);
    });

    it("提供 manual 接入并按接收模式隐藏全部 IMAP 字段", () => {
        expect(emailSchema.receive_mode.choices?.map(choice => choice.value)).toEqual([
            "imap",
            "manual",
        ]);
        for (const rule of Object.values(emailSchema.imap)) {
            expect(rule.ui?.visibleWhen).toEqual({
                path: "receive_mode",
                oneOf: ["imap"],
            });
        }
        expect(emailSchema.imap.host.required).toBeUndefined();
    });
});
