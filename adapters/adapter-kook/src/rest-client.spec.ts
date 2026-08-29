import { describe, expect, test, vi } from "vitest";
import { KookError } from "./errors.js";
import { KookRestClient } from "./rest-client.js";

describe("KOOK REST client", () => {
    test("429 后按响应头等待并重试", async () => {
        vi.useFakeTimers();
        const transport = vi
            .fn()
            .mockResolvedValueOnce(
                response(429, 42900, {
                    "x-rate-limit-bucket": "guild/list",
                    "x-rate-limit-reset": "0.01",
                }),
            )
            .mockResolvedValueOnce(response(200, 0));
        const client = new KookRestClient({ token: "token", max_retries: 1 }, transport);
        const pending = client.call("/v3/guild/list");
        await vi.advanceTimersByTimeAsync(10);
        await expect(pending).resolves.toEqual({ ok: true });
        expect(transport).toHaveBeenCalledTimes(2);
        vi.useRealTimers();
    });

    test("拒绝编码路径穿越和带凭据的 API 根地址", () => {
        const client = new KookRestClient({ token: "token" });
        expect(() => client.call("/v3/%2e%2e/secret")).toThrow(KookError);
        expect(
            () => new KookRestClient({ token: "token", api_base_url: "https://u:p@example.test" }),
        ).toThrow("无凭据");
    });

    test("原样读取 Badge 等二进制响应", async () => {
        const transport = vi.fn().mockResolvedValue(
            new Response(new Uint8Array([1, 2, 3]), {
                status: 200,
                headers: { "content-type": "image/png" },
            }),
        );
        const client = new KookRestClient({ token: "token" }, transport);
        await expect(client.download("/v3/badge/guild", { guild_id: "guild" })).resolves.toEqual({
            data: new Uint8Array([1, 2, 3]),
            contentType: "image/png",
        });
    });
});

function response(status: number, code: number, headers?: Record<string, string>): Response {
    return new Response(
        JSON.stringify({ code, message: code ? "limited" : "ok", data: { ok: true } }),
        {
            status,
            headers,
        },
    );
}
