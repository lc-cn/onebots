import { ApiError } from "@tencent-connect/qqbot-nodejs/protocol";
import { ErrorCategory, OneBotsError } from "onebots";
import { describe, expect, it } from "vitest";
import { QQApiError } from "./errors.js";

describe("QQ 结构化错误", () => {
    it("把入站参数错误纳入核心验证分类", () => {
        const error = QQApiError.invalid("参数非法", "QQ_INVALID_ACTION_PARAMS");

        expect(error).toBeInstanceOf(OneBotsError);
        expect(error).toMatchObject({
            code: "QQ_INVALID_ACTION_PARAMS",
            category: ErrorCategory.VALIDATION,
        });
    });

    it("按官方 HTTP 状态保留资源与网络错误语义", () => {
        expect(QQApiError.wrap(new ApiError("不存在", 404, "/guilds/missing"))).toMatchObject({
            category: ErrorCategory.RESOURCE,
            status: 404,
            path: "/guilds/missing",
        });
        expect(QQApiError.wrap(new ApiError("不可用", 503, "/gateway"))).toMatchObject({
            category: ErrorCategory.NETWORK,
            status: 503,
        });
    });
});
