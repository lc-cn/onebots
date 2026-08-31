import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { MetaGraphTransport } from "./transport.js";

describe("MetaGraphTransport", () => {
    it("使用版本化安全路径、Bearer token、appsecret_proof 与重复 query", async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
            Response.json(
                { id: "page" },
                {
                    headers: {
                        "x-app-usage": '{"call_count":1}',
                        "x-fb-trace-id": "trace",
                    },
                },
            ),
        );
        const transport = new MetaGraphTransport(
            { accessToken: "token", appSecret: "secret", apiVersion: "v25.0" },
            fetcher,
        );
        const result = await transport.callWithMetadata<{ id: string }>("GET", "/me", {
            query: { fields: ["id", "name"] },
        });

        const [request, init] = fetcher.mock.calls[0];
        const url = new URL(String(request));
        expect(url.pathname).toBe("/v25.0/me");
        expect(url.searchParams.getAll("fields")).toEqual(["id", "name"]);
        expect(url.searchParams.get("appsecret_proof")).toBe(
            createHmac("sha256", "secret").update("token").digest("hex"),
        );
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer token");
        expect(String(request)).not.toContain("access_token");
        expect(result).toEqual({
            data: { id: "page" },
            usage: { app: { call_count: 1 }, traceId: "trace" },
        });
    });

    it("保留 Graph 结构化错误且拒绝跨 origin/路径穿越", async () => {
        const transport = new MetaGraphTransport(
            { accessToken: "token" },
            vi.fn<typeof fetch>().mockResolvedValue(
                Response.json(
                    {
                        error: {
                            message: "expired",
                            type: "OAuthException",
                            code: 190,
                            error_subcode: 463,
                            fbtrace_id: "trace",
                        },
                    },
                    { status: 401 },
                ),
            ),
        );
        await expect(transport.call("GET", "/me")).rejects.toMatchObject({
            code: "META_GRAPH_190",
            status: 401,
            details: { error_subcode: 463, fbtrace_id: "trace" },
        });
        await expect(transport.call("GET", "https://evil.example/me")).rejects.toThrow(/pathname/u);
        await expect(transport.call("GET", "/../token")).rejects.toThrow(/路径穿越/u);
    });

    it("拒绝畸形 API Origin/version 与 JSON/form 双重请求体", async () => {
        expect(
            () => new MetaGraphTransport({ accessToken: "token", apiOrigin: "https://host/x" }),
        ).toThrow(/Origin/u);
        expect(
            () => new MetaGraphTransport({ accessToken: "token", apiVersion: "latest" }),
        ).toThrow(/v25\.0/u);
        const transport = new MetaGraphTransport({ accessToken: "token" });
        await expect(
            transport.call("POST", "/me/messages", { body: {}, form: new FormData() }),
        ).rejects.toThrow(/同时提供/u);
        await expect(
            transport.call("GET", "/me", { query: { access_token: "leak" } }),
        ).rejects.toThrow(/不得放入/u);
        await expect(
            transport.call("GET", "/me", { query: { limit: Number.NaN } }),
        ).rejects.toThrow(/有限数字/u);
        await expect(transport.call("GET", "/me", { body: {} })).rejects.toThrow(
            /GET 请求不能包含 body/u,
        );
        await expect(
            transport.call("POST", "/me", { body: { count: Number.POSITIVE_INFINITY } }),
        ).rejects.toThrow(/有限数字/u);
        await expect(transport.call("POST", "/me", { body: { value: undefined } })).rejects.toThrow(
            /不是 JSON 值/u,
        );
    });

    it("拒绝 Graph 的非 JSON content type", async () => {
        const transport = new MetaGraphTransport(
            { accessToken: "token" },
            vi
                .fn<typeof fetch>()
                .mockResolvedValue(
                    new Response("{}", { headers: { "content-type": "text/html" } }),
                ),
        );
        await expect(transport.call("GET", "/me")).rejects.toMatchObject({
            code: "META_INVALID_RESPONSE",
        });
    });
});
