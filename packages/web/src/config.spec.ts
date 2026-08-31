import { describe, expect, it } from "vitest";
import { joinApiUrl, normalizeRuntimeHttpPrefix, resolveApiBaseUrl } from "./config";

describe("Web runtime gateway prefix", () => {
    it.each([
        ["", ""],
        ["/", ""],
        [" /gateway ", "/gateway"],
        ["/gateway/", "/gateway"],
        ["/gateway/admin", "/gateway/admin"],
    ])("接受同源规范前缀 %j", (configured, expected) => {
        expect(normalizeRuntimeHttpPrefix(configured)).toBe(expected);
    });

    it.each([
        "gateway",
        "//evil.example",
        "/gateway//admin",
        "/gateway/../admin",
        "/gateway/%2e%2e/admin",
        "/gateway%2fadmin",
        "/gateway?token=secret",
        "/gateway#fragment",
    ])("拒绝可能改写请求目标的运行时前缀 %j", configured => {
        expect(normalizeRuntimeHttpPrefix(configured)).toBe("");
    });

    it("组合运行时前缀、绝对 API base 与请求 path 时只保留一个分隔符", () => {
        expect(joinApiUrl("/gateway/", "/api/system")).toBe("/gateway/api/system");
        expect(joinApiUrl("https://gateway.example.com/root/", "health")).toBe(
            "https://gateway.example.com/root/health",
        );
        expect(joinApiUrl("", "/ready")).toBe("/ready");
    });

    it("构建期覆盖优先，生产读取运行时前缀，开发模式保持代理根路径", () => {
        expect(resolveApiBaseUrl("https://api.example.com/root/", "/gateway", false)).toBe(
            "https://api.example.com/root",
        );
        expect(resolveApiBaseUrl(undefined, "/gateway", false)).toBe("/gateway");
        expect(resolveApiBaseUrl(undefined, "/gateway", true)).toBe("");
        expect(resolveApiBaseUrl(undefined, "//evil.example", false)).toBe("");
    });
});
