import { ErrorCategory, OneBotsError } from "onebots";
import { describe, expect, it } from "vitest";
import { HeychatApiError } from "./errors.js";

describe("黑盒语音结构化错误", () => {
    it("将动作参数与资源缺失纳入核心分类", () => {
        const invalid = HeychatApiError.invalid("参数非法", "HEYCHAT_INVALID_ACTION_PARAMS");
        const missing = HeychatApiError.resource("频道不存在", "HEYCHAT_CHANNEL_NOT_FOUND");

        expect(invalid).toBeInstanceOf(OneBotsError);
        expect(invalid.category).toBe(ErrorCategory.VALIDATION);
        expect(missing.category).toBe(ErrorCategory.RESOURCE);
    });

    it("按 HTTP 状态区分平台资源与网络故障", () => {
        expect(new HeychatApiError("不存在", { status: 404 }).category).toBe(
            ErrorCategory.RESOURCE,
        );
        expect(new HeychatApiError("不可用", { status: 503 }).category).toBe(ErrorCategory.NETWORK);
    });
});
