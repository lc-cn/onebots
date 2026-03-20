import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { parseSimpleXml, verifyWeComSignature } from "./crypto.js";

describe("parseSimpleXml", () => {
    it("解析微信客服回调明文 XML", () => {
        const xml = `<?xml version="1.0"?><xml>
   <ToUserName><![CDATA[ww123]]></ToUserName>
   <CreateTime>1348831860</CreateTime>
   <MsgType><![CDATA[event]]></MsgType>
   <Event><![CDATA[kf_msg_or_event]]></Event>
   <Token><![CDATA[ENCtoken]]></Token>
   <OpenKfId><![CDATA[wktest]]></OpenKfId>
</xml>`;
        const o = parseSimpleXml(xml);
        expect(o.ToUserName).toBe("ww123");
        expect(o.CreateTime).toBe(1348831860);
        expect(o.Event).toBe("kf_msg_or_event");
        expect(o.Token).toBe("ENCtoken");
        expect(o.OpenKfId).toBe("wktest");
    });
});

describe("verifyWeComSignature", () => {
    it("合法签名通过", () => {
        const token = "test";
        const timestamp = "123";
        const nonce = "456";
        const encrypt = "cipher";
        const arr = [token, timestamp, nonce, encrypt].sort().join("");
        const msg_signature = createHash("sha1").update(arr).digest("hex");
        expect(verifyWeComSignature(token, msg_signature, timestamp, nonce, encrypt)).toBe(true);
        expect(verifyWeComSignature(token, "bad", timestamp, nonce, encrypt)).toBe(false);
    });
});
