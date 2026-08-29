import { ErrorCategory, OneBotsError } from "onebots";
import { describe, expect, it } from "vitest";
import { WechatApiError } from "./errors.js";

describe("微信公众号结构化错误", () => {
    it("继承核心错误并保留协议上下文", () => {
        const error = new WechatApiError("签名无效", {
            code: "WECHAT_INVALID_SIGNATURE",
            status: 403,
            path: "/wechat/bot/webhook",
        });
        expect(error).toBeInstanceOf(OneBotsError);
        expect(error.category).toBe(ErrorCategory.CONFIG);
        expect(error.context).toMatchObject({ status: 403, path: "/wechat/bot/webhook" });
    });
});
