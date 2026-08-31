import { describe, expect, test } from "vitest";
import { ErrorCategory, OneBotsError } from "onebots";
import { WhatsAppApiError } from "./errors.js";

describe("WhatsApp 结构化错误", () => {
    test("接入与 Graph API 错误进入核心错误体系", () => {
        const signature = new WhatsAppApiError("bad signature", {
            code: "WHATSAPP_INVALID_SIGNATURE",
            status: 401,
        });
        expect(signature).toBeInstanceOf(OneBotsError);
        expect(signature.category).toBe(ErrorCategory.CONFIG);
        expect(signature.toJSON().context).toEqual({ status: 401 });
    });

    test("按 HTTP 状态保留资源与网络语义", () => {
        expect(new WhatsAppApiError("missing", { status: 404 }).category).toBe(
            ErrorCategory.RESOURCE,
        );
        expect(new WhatsAppApiError("limited", { status: 429 }).category).toBe(
            ErrorCategory.NETWORK,
        );
    });
});
