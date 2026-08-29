import { afterEach, describe, expect, it, vi } from "vitest";
import { IlinkJsonTransport } from "./ilink-json-transport.js";
import { ADAPTER_SEMVER, ILINK_APP_CLIENT_VERSION, ILINK_APP_ID } from "../internal/config.js";

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
        const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
        expect(headers["iLink-App-Id"]).toBe(ILINK_APP_ID);
        expect(headers["iLink-App-ClientVersion"]).toBe(String(ILINK_APP_CLIENT_VERSION));
        expect(headers).not.toHaveProperty("Content-Length");
        expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
            base_info: { channel_version: ADAPTER_SEMVER, bot_agent: `OneBots/${ADAPTER_SEMVER}` },
        });
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

    it("按当前协议使用 POST 创建二维码并携带本地 token 列表", async () => {
        const fetchMock = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({ qrcode: "qr", qrcode_img_content: "https://qr.test" }),
                ),
        );
        vi.stubGlobal("fetch", fetchMock);
        const transport = new IlinkJsonTransport({ baseUrl: "https://example.test" });
        await transport.openLoginBitmap({ localTokens: ["existing"] });
        expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
        expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
            local_token_list: ["existing"],
        });
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

    it("统一校验业务错误、凭证失效与扫码状态", async () => {
        const transport = new IlinkJsonTransport({
            baseUrl: "https://example.test",
            token: "token",
        });
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ ret: 7, errmsg: "typing rejected" })),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ errcode: -14, errmsg: "expired" })),
            )
            .mockResolvedValueOnce(new Response(JSON.stringify({ status: "surprise" })));
        vi.stubGlobal("fetch", fetchMock);
        await expect(transport.signalTypingState({})).rejects.toMatchObject({
            code: "API_ERROR",
            operation: "sendtyping",
        });
        await expect(transport.notifyStart()).rejects.toMatchObject({
            code: "SESSION_EXPIRED",
        });
        await expect(transport.probeLoginPhase({ qrcode: "qr" })).rejects.toMatchObject({
            code: "INVALID_QR_STATUS",
        });
        await expect(
            transport.probeLoginPhase({ qrcode: "qr", baseUrl: "http://unsafe.test" }),
        ).rejects.toThrow("必须使用 HTTPS");
    });
});
