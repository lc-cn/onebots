import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorCategory } from "onebots";
import { TeamsGraphClient } from "./graph.js";

describe("TeamsGraphClient", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("在最底层拒绝路径穿越和编码分隔符", async () => {
        const request = vi.fn();
        vi.stubGlobal("fetch", request);
        const graph = createGraph();

        await expect(graph.call("/teams/%2e%2e/users", { method: "GET" })).rejects.toMatchObject({
            code: "TEAMS_GRAPH_PATH_INVALID",
            category: ErrorCategory.VALIDATION,
        });
        await expect(graph.call("/users%2Fadmin", { method: "GET" })).rejects.toMatchObject({
            code: "TEAMS_GRAPH_PATH_INVALID",
        });
        expect(request).not.toHaveBeenCalled();
    });

    it("并发请求共享一次 app-only token 获取", async () => {
        const request = vi.fn(async (input: string | URL) => {
            const url = String(input);
            return url.includes("oauth2/v2.0/token")
                ? jsonResponse({ access_token: "token-1", expires_in: 3600 })
                : jsonResponse({ value: [] });
        });
        vi.stubGlobal("fetch", request);
        const graph = createGraph();

        await Promise.all([
            graph.call("/users", { method: "GET" }),
            graph.call("/groups", { method: "GET" }),
        ]);

        expect(
            request.mock.calls.filter(([input]) => String(input).includes("oauth2/v2.0/token")),
        ).toHaveLength(1);
    });

    it("401 后刷新一次 token，并分离稳定错误码与 Graph 平台码", async () => {
        const request = vi
            .fn()
            .mockResolvedValueOnce(jsonResponse({ access_token: "expired", expires_in: 3600 }))
            .mockResolvedValueOnce(
                jsonResponse({ error: { code: "InvalidAuthenticationToken" } }, 401),
            )
            .mockResolvedValueOnce(jsonResponse({ access_token: "fresh", expires_in: 3600 }))
            .mockResolvedValueOnce(
                jsonResponse(
                    { error: { code: "Request_ResourceNotFound", message: "missing" } },
                    404,
                    { "request-id": "request-1" },
                ),
            );
        vi.stubGlobal("fetch", request);
        const graph = createGraph();

        await expect(graph.call("/users/missing", { method: "GET" })).rejects.toMatchObject({
            code: "TEAMS_GRAPH_API_ERROR",
            platformCode: "Request_ResourceNotFound",
            status: 404,
            category: ErrorCategory.RESOURCE,
        });
        expect(request).toHaveBeenCalledTimes(4);
        expect(request.mock.calls[1]?.[1]).toMatchObject({
            headers: expect.objectContaining({ authorization: "Bearer expired" }),
        });
        expect(request.mock.calls[3]?.[1]).toMatchObject({
            headers: expect.objectContaining({ authorization: "Bearer fresh" }),
        });
    });
});

function createGraph(): TeamsGraphClient {
    return new TeamsGraphClient({
        account_id: "test",
        app_id: "app-id",
        app_password: "secret",
        tenant_id: "00000000-0000-0000-0000-000000000001",
    });
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
    });
}
