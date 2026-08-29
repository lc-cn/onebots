import { describe, expect, it } from "vitest";
import { assertZulipApiPath, encodeZulipParams, parseZulipResponse } from "./http.js";

describe("Zulip HTTP 契约", () => {
    it("按官方表单格式编码数组、对象和标量", () => {
        expect(
            encodeZulipParams({
                queue_id: "queue-1",
                values: [1, 2],
                capabilities: { empty_topic_name: true },
                enabled: false,
            }),
        ).toBe(
            "queue_id=queue-1&values=%5B1%2C2%5D&capabilities=%7B%22empty_topic_name%22%3Atrue%7D&enabled=false",
        );
    });

    it("把平台错误和非法 JSON 转成结构化错误", () => {
        expect(() =>
            parseZulipResponse(
                '{"result":"error","msg":"bad queue","code":"BAD_EVENT_QUEUE_ID"}',
                400,
            ),
        ).toThrowError(expect.objectContaining({ code: "BAD_EVENT_QUEUE_ID", status: 400 }));
        expect(() => parseZulipResponse("not-json", 200)).toThrowError(
            expect.objectContaining({ code: "ZULIP_INVALID_JSON" }),
        );
    });

    it("只接受当前 API 根下的安全相对路径", () => {
        expect(assertZulipApiPath("messages/42/reactions")).toBe("messages/42/reactions");
        expect(() => assertZulipApiPath("https://evil.example")).toThrowError(
            expect.objectContaining({ code: "ZULIP_INVALID_API_PATH" }),
        );
        expect(() => assertZulipApiPath("../admin")).toThrowError(
            expect.objectContaining({ code: "ZULIP_INVALID_API_PATH" }),
        );
    });
});
