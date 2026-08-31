import { describe, expect, it } from "vitest";
import { graphTokenAuthority, StructuredAgentsResponse } from "./bot-utils.js";

describe("Teams hosting bridge", () => {
    it("end 后按 WebResponse 契约同时报告已结束和已发送", () => {
        const response = new StructuredAgentsResponse();

        expect(response.headersSent).toBe(false);
        expect(response.writableEnded).toBe(false);
        response.end();
        expect(response.headersSent).toBe(true);
        expect(response.writableEnded).toBe(true);
    });

    it("将 Agents SDK 写入闭合为宿主无关响应", () => {
        const response = new StructuredAgentsResponse();
        response.status(202).setHeader("x-request-id", "r1").send({ accepted: true });

        expect(response.toResponse()).toEqual({
            status: 202,
            headers: { "x-request-id": "r1" },
            body: { accepted: true },
        });
    });

    it("只为 HTTPS Entra authority 生成租户令牌地址", () => {
        expect(graphTokenAuthority("https://login.microsoftonline.com/common", "tenant id")).toBe(
            "https://login.microsoftonline.com/tenant%20id",
        );
        expect(() => graphTokenAuthority("http://127.0.0.1", "tenant")).toThrow(/HTTPS/u);
    });
});
