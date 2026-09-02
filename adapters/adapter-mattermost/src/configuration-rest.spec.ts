import { describe, expect, it, vi } from "vitest";
import {
    assertMattermostApiPath,
    assertMattermostConfig,
    parseMattermostServerUrl,
} from "./configuration.js";
import { FetchMattermostRestTransport } from "./rest.js";
import type { MattermostConfig } from "./types.js";

describe("Mattermost configuration", () => {
    it("接受 HTTPS、localhost 子路径与明确 manual 模式", () => {
        expect(parseMattermostServerUrl("https://chat.example.com/mattermost/").href).toBe(
            "https://chat.example.com/mattermost",
        );
        expect(() => assertMattermostConfig(config({ receive_mode: "manual" }))).not.toThrow();
        expect(parseMattermostServerUrl("http://127.0.0.1:8065").origin).toBe(
            "http://127.0.0.1:8065",
        );
    });

    it("拒绝公网 HTTP、URL 凭据、重复过滤器与错误退避区间", () => {
        expect(() => parseMattermostServerUrl("http://chat.example.com")).toThrow(/HTTPS/u);
        expect(() => parseMattermostServerUrl("https://user:pass@chat.example.com")).toThrow(
            /凭据/u,
        );
        expect(() => assertMattermostConfig(config({ team_ids: ["team1", "team1"] }))).toThrow(
            /重复/u,
        );
        expect(() =>
            assertMattermostConfig(
                config({ reconnect_initial_delay_ms: 2_000, reconnect_max_delay_ms: 1_000 }),
            ),
        ).toThrow(/不能大于/u);
    });

    it("API path 拒绝普通及百分号编码的越界路径", () => {
        expect(assertMattermostApiPath("posts/abc123/thread")).toBe("posts/abc123/thread");
        for (const path of ["../users", "%2e%2e/users", "users/%2Fadmin", "/users", "users?q=1"]) {
            expect(() => assertMattermostApiPath(path)).toThrow();
        }
    });
});

describe("Mattermost REST transport", () => {
    it("保留实例子路径、覆盖伪造鉴权头并编码 query/body", async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "ok" }));
        const rest = new FetchMattermostRestTransport(
            config({ server_url: "https://chat.example.com/workspace" }),
            fetcher,
        );
        await rest.call("POST", "posts", {
            query: { silent: true, page: 0 },
            body: { message: "hello" },
            headers: { authorization: "Bearer forged" },
        });

        const [input, init] = fetcher.mock.calls[0];
        const url = new URL(String(input));
        expect(url.pathname).toBe("/workspace/api/v4/posts");
        expect(Object.fromEntries(url.searchParams)).toEqual({ silent: "true", page: "0" });
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer token");
        expect(init?.body).toBe(JSON.stringify({ message: "hello" }));
    });

    it("投影官方错误字段和限流窗口", async () => {
        const rest = new FetchMattermostRestTransport(
            config(),
            vi.fn<typeof fetch>().mockResolvedValue(
                Response.json(
                    {
                        id: "app.rate_limit.app_error",
                        message: "Too many requests",
                        detailed_error: "slow down",
                        request_id: "request1",
                        status_code: 429,
                    },
                    { status: 429, headers: { "retry-after": "2" } },
                ),
            ),
        );
        await expect(rest.call("GET", "users/me")).rejects.toMatchObject({
            code: "app.rate_limit.app_error",
            status: 429,
            requestId: "request1",
            detailedError: "slow down",
            retryAfterMs: 2_000,
        });
    });

    it("限制声明长度与实际响应长度，并拒绝成功的非 JSON 响应", async () => {
        const tooLarge = new FetchMattermostRestTransport(
            config({ max_response_bytes: 1_024 }),
            vi
                .fn<typeof fetch>()
                .mockResolvedValue(new Response("x", { headers: { "content-length": "2048" } })),
        );
        await expect(tooLarge.call("GET", "users/me")).rejects.toMatchObject({
            code: "MATTERMOST_RESPONSE_TOO_LARGE",
        });

        const invalid = new FetchMattermostRestTransport(
            config(),
            vi.fn<typeof fetch>().mockResolvedValue(new Response("ok")),
        );
        await expect(invalid.call("GET", "users/me")).rejects.toMatchObject({
            code: "MATTERMOST_INVALID_RESPONSE",
        });
    });
});

function config(overrides: Partial<MattermostConfig> = {}): MattermostConfig {
    return {
        account_id: "account",
        server_url: "https://chat.example.com",
        access_token: "token",
        ...overrides,
    };
}
