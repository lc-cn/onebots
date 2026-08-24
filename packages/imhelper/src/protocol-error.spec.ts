import { describe, expect, test } from "vitest";
import { ProtocolError } from "./protocol-error.js";

describe("ProtocolError", () => {
    test("exposes protocol operation kind and transport context", () => {
        const response = { message: "upstream unavailable" };
        const error = new ProtocolError({
            protocol: "onebot-v12",
            operation: "get_self_info",
            kind: "transport",
            message: "请求失败",
            httpStatus: 503,
            code: "UPSTREAM_UNAVAILABLE",
            response,
        });

        expect(error).toMatchObject({
            name: "ProtocolError",
            protocol: "onebot-v12",
            operation: "get_self_info",
            kind: "transport",
            httpStatus: 503,
            code: "UPSTREAM_UNAVAILABLE",
            response,
        });
    });
});
