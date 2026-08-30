import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { HeychatApiError } from "../errors.js";
import { HeychatHttpClient } from "./client.js";

let server: Server | undefined;

afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
        server?.close(error => (error ? reject(error) : resolve()));
    });
    server = undefined;
});

describe("HeychatHttpClient", () => {
    it("统一附加鉴权与客户端 query，并解包 result", async () => {
        const base = await listen((request, response) => {
            const url = new URL(request.url || "/", "http://localhost");
            expect(request.headers.token).toBe("secret");
            expect(url.searchParams.get("chat_os_type")).toBe("bot");
            expect(url.searchParams.get("room_id")).toBe("r1");
            response.setHeader("content-type", "application/json");
            response.end(
                JSON.stringify({
                    status: "ok",
                    msg: "",
                    result: {
                        room_id: "r1",
                        room: { room_id: "r1", room_name: "测试房间", user_count: 3 },
                    },
                }),
            );
        });
        const client = new HeychatHttpClient({
            account_id: "bot",
            token: "secret",
            api_base_url: base,
            upload_base_url: base,
        });

        await expect(client.getRoomInfo("r1")).resolves.toMatchObject({
            room_id: "r1",
            room_name: "测试房间",
            member_count: 3,
        });
    });

    it("把平台失败响应转换为结构化错误", async () => {
        const base = await listen((_request, response) => {
            response.setHeader("content-type", "application/json");
            response.end(JSON.stringify({ status: "failed", msg: "权限不足", result: {} }));
        });
        const client = new HeychatHttpClient({
            account_id: "bot",
            token: "secret",
            api_base_url: base,
        });

        const error = await client.callApi("/chatroom/v2/room/view").catch(value => value);
        expect(error).toBeInstanceOf(HeychatApiError);
        expect(error).toMatchObject({
            code: "HEYCHAT_API_ERROR",
            status: 200,
            path: "/chatroom/v2/room/view",
        });
    });

    it("使用 multipart 上传并返回 CDN URL", async () => {
        const base = await listen((request, response) => {
            expect(request.headers["content-type"]).toContain("multipart/form-data; boundary=");
            const chunks: Buffer[] = [];
            request.on("data", chunk => chunks.push(Buffer.from(chunk)));
            request.on("end", () => {
                expect(Buffer.concat(chunks).toString()).toContain("image-bytes");
                response.end(
                    JSON.stringify({
                        status: "ok",
                        result: { url: "https://cdn.example/image.png" },
                    }),
                );
            });
        });
        const client = new HeychatHttpClient({
            account_id: "bot",
            token: "secret",
            api_base_url: base,
            upload_base_url: base,
        });

        await expect(
            client.uploadMedia(Buffer.from("image-bytes"), "image.png", "image/png"),
        ).resolves.toBe("https://cdn.example/image.png");
    });

    it("保留代理 Base URL 路径前缀并拒绝不安全端点", async () => {
        const base = await listen((request, response) => {
            expect(request.url).toContain("/proxy/chatroom/v2/room/view");
            response.end(JSON.stringify({ status: "ok", result: { room_id: "r1" } }));
        });
        const client = new HeychatHttpClient({
            account_id: "bot",
            token: "secret",
            api_base_url: `${base}/proxy`,
        });
        await expect(client.getRoomView("r1")).resolves.toMatchObject({ room_id: "r1" });
        expect(
            () =>
                new HeychatHttpClient({
                    account_id: "bot",
                    token: "secret",
                    api_base_url: "http://remote.example",
                }),
        ).toThrowError(expect.objectContaining({ code: "HEYCHAT_INVALID_CONFIG_URL" }));
    });

    it("在 HTTP 客户端边界拒绝编码穿越与非 chatroom 路径", async () => {
        const client = new HeychatHttpClient({ account_id: "bot", token: "secret" });
        await expect(client.callApi("/chatroom/v2/%2e%2e/token")).rejects.toMatchObject({
            code: "HEYCHAT_INVALID_API_PATH",
        });
        await expect(client.callApi("/open-apis/token")).rejects.toMatchObject({
            code: "HEYCHAT_INVALID_API_PATH",
        });
    });

    it("以独立凭据闭合 OAuth 授权、令牌与用户资源请求", async () => {
        const base = await listen((request, response) => {
            const url = new URL(request.url || "/", "http://localhost");
            response.setHeader("content-type", "application/json");
            if (url.pathname === "/chatroom/api/token") {
                expect(request.headers.token).toBeUndefined();
                const chunks: Buffer[] = [];
                request.on("data", chunk => chunks.push(Buffer.from(chunk)));
                request.on("end", () => {
                    const form = new URLSearchParams(Buffer.concat(chunks).toString());
                    expect(form.get("grant_type")).toBe("authorization_code");
                    expect(form.get("client_id")).toBe("client");
                    expect(form.get("client_secret")).toBe("oauth-secret");
                    expect(form.get("code")).toBe("code-1");
                    response.end(
                        JSON.stringify({
                            access_token: "access",
                            expires_in: 7200,
                            refresh_token: "refresh",
                            scope: "user_info_read",
                            token_type: "Bearer",
                        }),
                    );
                });
                return;
            }
            expect(request.headers.token).toBe("secret");
            if (url.pathname === "/chatroom/api/account/info") {
                if (url.searchParams.has("client_id")) {
                    expect(request.headers.authorization).toBeUndefined();
                    expect(url.searchParams.get("client_id")).toBe("client");
                    expect(url.searchParams.get("scope")).toBe("user_info_read");
                } else {
                    expect(request.headers.authorization).toBe("Bearer access");
                }
                response.end(
                    JSON.stringify({
                        status: "ok",
                        result: { avatar: "https://cdn.example/avatar", username: "用户" },
                    }),
                );
                return;
            }
            expect(request.headers.authorization).toBe("Bearer access");
            expect(url.searchParams.get("room_id")).toBe("r1");
            expect(url.searchParams.get("appid")).toBe("730");
            response.end(JSON.stringify({ status: "ok", result: { durations: [] } }));
        });
        const client = new HeychatHttpClient({
            account_id: "bot",
            token: "secret",
            oauth: {
                client_id: "client",
                client_secret: "oauth-secret",
                redirect_uri: "https://example.com/callback",
                api_base_url: base,
                resource_base_url: base,
            },
        });

        const authorization = new URL(
            client.buildOAuthAuthorizationUrl(["user_info_read", "user_chat_duration_read"]),
        );
        expect(authorization.pathname).toBe("/account/bot_oauth");
        expect(authorization.searchParams.get("client_id")).toBe("client");
        expect(authorization.searchParams.get("scope")).toBe(
            "user_info_read user_chat_duration_read",
        );
        await expect(client.exchangeOAuthCode("code-1")).resolves.toMatchObject({
            access_token: "access",
        });
        await expect(client.getOAuthUserInfo("access")).resolves.toMatchObject({
            username: "用户",
        });
        await expect(client.requestOAuthUserInfo("42", ["user_info_read"])).resolves.toMatchObject({
            username: "用户",
        });
        await expect(
            client.getOAuthVoiceDuration("access", { room_id: "r1", appid: "730" }),
        ).resolves.toEqual({ durations: [] });
        await expect(
            client.getOAuthVoiceDuration("access", {
                begin_time: 1,
                end_time: 31 * 86400,
            }),
        ).rejects.toMatchObject({ code: "HEYCHAT_INVALID_ACTION_PARAMS" });
    });
});

async function listen(handler: RequestListener): Promise<string> {
    server = createServer(handler);
    await new Promise<void>((resolve, reject) => {
        server?.once("error", reject);
        server?.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
}
