import { describe, expect, test } from "vitest";
import { ErrorCategory, OneBotsError } from "onebots";
import { WeComKfError } from "./errors.js";

describe("微信客服结构化错误", () => {
    test("回调与 API 错误进入核心错误体系", () => {
        const signature = new WeComKfError("bad signature", {
            code: "WECOM_KF_INVALID_SIGNATURE",
            status: 403,
        });
        expect(signature).toBeInstanceOf(OneBotsError);
        expect(signature.category).toBe(ErrorCategory.CONFIG);
        expect(signature.toJSON().context).toEqual({ status: 403 });
    });

    test("按 HTTP 状态保留资源与网络语义", () => {
        expect(new WeComKfError("missing", { status: 404 }).category).toBe(ErrorCategory.RESOURCE);
        expect(new WeComKfError("limited", { status: 429 }).category).toBe(ErrorCategory.NETWORK);
    });
});
