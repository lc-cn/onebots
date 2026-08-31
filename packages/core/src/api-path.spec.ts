import { describe, expect, it } from "vitest";
import { isSafeAbsoluteApiPath } from "./api-path.js";

describe("isSafeAbsoluteApiPath", () => {
    it("接受规范绝对 API 路径", () => {
        expect(isSafeAbsoluteApiPath("/cgi-bin/user/get")).toBe(true);
    });

    it.each([
        "relative/path",
        "//evil.example/path",
        "/cgi-bin/../token",
        "/cgi-bin/%2e%2e/token",
        "/cgi-bin/a%2fb",
        "/cgi-bin/user?userid=u1",
        "/cgi-bin/user#fragment",
        "/cgi-bin//user",
    ])("拒绝不规范路径 %s", path => {
        expect(isSafeAbsoluteApiPath(path)).toBe(false);
    });
});
