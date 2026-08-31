import { describe, expect, it } from "vitest";
import { normalizeGatewayPathPrefix } from "./gateway-path.js";

describe("normalizeGatewayPathPrefix", () => {
    it.each([
        ["", ""],
        ["/", ""],
        ["gateway", "/gateway"],
        ["/gateway/", "/gateway"],
        [" /gateway/admin/ ", "/gateway/admin"],
    ])("将 %j 规范化为 %j", (configured, expected) => {
        expect(normalizeGatewayPathPrefix(configured)).toBe(expected);
    });

    it.each([
        42,
        "//example.com/gateway",
        "/gateway//admin",
        "/gateway/../admin",
        "/gateway/%2e%2e/admin",
        "/gateway%2fadmin",
        "/gateway?token=secret",
        "/gateway#fragment",
    ])("拒绝不安全或非字符串的前缀 %j", configured => {
        expect(() => normalizeGatewayPathPrefix(configured)).toThrow("网关 path");
    });
});
