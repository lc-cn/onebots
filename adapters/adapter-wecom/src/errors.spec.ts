import { describe, expect, test } from "vitest";
import { ErrorCategory, OneBotsError } from "onebots";
import { WeComApiError } from "./errors.js";

describe("企业微信结构化错误", () => {
    test("回调与 API 错误进入核心错误体系", () => {
        const signature = new WeComApiError("bad signature", {
            code: "WECOM_INVALID_SIGNATURE",
            status: 403,
        });
        expect(signature).toBeInstanceOf(OneBotsError);
        expect(signature.category).toBe(ErrorCategory.CONFIG);
        expect(signature.toJSON().context).toEqual({ status: 403 });
    });

    test("按 HTTP 状态保留资源与网络语义", () => {
        expect(new WeComApiError("missing", { status: 404 }).category).toBe(ErrorCategory.RESOURCE);
        expect(new WeComApiError("limited", { status: 429 }).category).toBe(ErrorCategory.NETWORK);
    });
});
