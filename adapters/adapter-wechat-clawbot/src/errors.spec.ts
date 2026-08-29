import { ErrorCategory, OneBotsError } from "onebots";
import { describe, expect, it } from "vitest";
import { GatewayFault } from "./sdk/internal/errors.js";

describe("微信 ClawBot 结构化错误", () => {
    it("继承核心错误并保留平台操作上下文", () => {
        const error = new GatewayFault("UPSTREAM_HTTP_ERROR", "上游失败", {
            operation: "getupdates",
            status: 503,
            details: { ret: -1 },
        });
        expect(error).toBeInstanceOf(OneBotsError);
        expect(error.category).toBe(ErrorCategory.NETWORK);
        expect(error.context).toMatchObject({
            operation: "getupdates",
            status: 503,
            details: { ret: -1 },
        });
    });
});
