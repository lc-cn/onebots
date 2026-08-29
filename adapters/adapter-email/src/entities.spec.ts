import { describe, expect, it } from "vitest";
import { parseRecipients } from "./entities.js";

describe("email recipients", () => {
    it("按大小写不敏感方式去重但保留原始地址", () => {
        expect(parseRecipients("Alice@Example.com,alice@example.com,Bob@example.com")).toEqual([
            "alice@example.com",
            "Bob@example.com",
        ]);
    });

    it("拒绝非法或空收件人", () => {
        expect(() => parseRecipients("invalid")).toThrow("无效的邮件收件人");
        expect(() => parseRecipients(" ")).toThrow("无效的邮件收件人");
    });
});
