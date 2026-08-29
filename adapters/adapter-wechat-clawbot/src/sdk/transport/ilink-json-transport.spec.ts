import { afterEach, describe, expect, it, vi } from "vitest";
import { IlinkJsonTransport } from "./ilink-json-transport.js";

afterEach(() => vi.unstubAllGlobals());

describe("IlinkJsonTransport", () => {
    it("保留代理路径前缀并拒绝不安全服务根地址", async () => {
        const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);
        const transport = new IlinkJsonTransport({
            baseUrl: "https://proxy.example.test/wechat",
            cdnBaseUrl: "https://cdn.example.test/c2c",
            token: "token",
        });

        await transport.notifyStart();
        expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
            "https://proxy.example.test/wechat/ilink/bot/msg/notifystart",
        );
        expect(
            () =>
                new IlinkJsonTransport({
                    baseUrl: "http://remote.example.test",
                    cdnBaseUrl: "https://cdn.example.test",
                }),
        ).toThrow("必须使用 HTTPS");
        expect(
            () =>
                new IlinkJsonTransport({
                    baseUrl: "https://user:pass@example.test",
                    cdnBaseUrl: "https://cdn.example.test",
                }),
        ).toThrow("不能包含凭据");
    });

    it("将畸形或非对象 JSON 转成结构化网关错误", async () => {
        const transport = new IlinkJsonTransport({
            baseUrl: "https://example.test",
            cdnBaseUrl: "https://cdn.example.test",
        });
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response("not-json", { status: 200 })),
        );
        await expect(transport.notifyStart()).rejects.toMatchObject({
            name: "GatewayFault",
            code: "INVALID_JSON",
            operation: "ilink/bot/msg/notifystart",
        });
    });
});
