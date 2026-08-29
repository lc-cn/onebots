import { describe, expect, test } from "vitest";
import { ErrorCategory, OneBotsError } from "onebots";
import { LineApiError } from "./errors.js";

describe("LINE 结构化错误", () => {
    test("Webhook 入站错误进入核心协议/配置分类", () => {
        const signature = new LineApiError("bad signature", {
            code: "LINE_INVALID_SIGNATURE",
            status: 401,
        });
        expect(signature).toBeInstanceOf(OneBotsError);
        expect(signature.category).toBe(ErrorCategory.CONFIG);
        expect(signature.toJSON().context).toEqual({ status: 401 });
    });

    test("按 HTTP 状态保留资源与网络语义", () => {
        expect(new LineApiError("missing", { status: 404 }).category).toBe(ErrorCategory.RESOURCE);
        expect(new LineApiError("limited", { status: 429 }).category).toBe(ErrorCategory.NETWORK);
    });
});
