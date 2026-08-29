import { describe, expect, it } from "vitest";
import { buildProxyUrl, createProxyAgent, maskProxyUrl } from "./proxy.js";

describe("统一代理工厂", () => {
    it("安全编码认证信息并支持日志脱敏", () => {
        const url = buildProxyUrl({
            url: "http://proxy.example:8080",
            username: "user@example.com",
            password: "p@ss",
        });
        expect(url).toContain("user%40example.com:p%40ss@");
        expect(maskProxyUrl(url)).not.toContain("p%40ss");
    });

    it.each([
        ["http://127.0.0.1:8080", "HttpsProxyAgent"],
        ["socks5://127.0.0.1:1080", "SocksProxyAgent"],
    ])("按协议创建 %s 代理", async (url, constructorName) => {
        const agent = await createProxyAgent({ url });
        expect(agent).not.toBeNull();
        expect((agent as object).constructor.name).toBe(constructorName);
    });
});
