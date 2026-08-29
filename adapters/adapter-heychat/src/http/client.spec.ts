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
