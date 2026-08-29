import { describe, expect, it } from "vitest";
import { DingTalkCallbackCrypto } from "./crypto.js";

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
        expect(() =>
            crypto.decrypt(response.encrypt, "bad", response.timeStamp, response.nonce),
        ).toThrow("签名验证失败");
    });
});
