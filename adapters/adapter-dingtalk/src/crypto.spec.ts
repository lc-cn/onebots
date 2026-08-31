import { describe, expect, it } from "vitest";
import { ErrorCategory } from "onebots";
import { DingTalkCallbackCrypto } from "./crypto.js";
import { DingTalkError } from "./errors.js";

describe("DingTalkCallbackCrypto", () => {
    const key = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";

    it("按钉钉回调格式完成签名、加密与解密", () => {
        const crypto = new DingTalkCallbackCrypto("token", key, "ding-corp");
        const response = crypto.encryptResponse('{"EventType":"check_url"}', "1710000000000", "n1");
        expect(
            crypto.decrypt(
                response.encrypt,
                response.msg_signature,
                response.timeStamp,
                response.nonce,
            ),
        ).toBe('{"EventType":"check_url"}');
    });

    it("拒绝被篡改的签名", () => {
        const crypto = new DingTalkCallbackCrypto("token", key, "ding-corp");
        const response = crypto.encryptResponse("success", "1710000000000", "n1");
        try {
            crypto.decrypt(response.encrypt, "bad", response.timeStamp, response.nonce);
            throw new Error("预期签名校验失败");
        } catch (error) {
            expect(error).toBeInstanceOf(DingTalkError);
            expect(error).toMatchObject({
                code: "DINGTALK_CALLBACK_SIGNATURE_INVALID",
                category: ErrorCategory.PROTOCOL,
            });
        }
    });
});
