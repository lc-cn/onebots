import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDiscordMultipart } from "./multipart.js";
import { DiscordREST } from "./rest.js";
import type { DiscordHttpResponse, DiscordHttpTransport } from "./rest-transport.js";

afterEach(() => vi.useRealTimers());

describe("DiscordREST endpoint boundary", () => {
    it("在发送 token 前拒绝外部 URL、路径穿越和内嵌 query", async () => {
        const rest = new DiscordREST({ token: "secret" });
        await expect(rest.request("https://example.com/api")).rejects.toThrow("安全绝对路径");
        await expect(rest.request("/guilds/../users/@me")).rejects.toThrow("安全绝对路径");
        await expect(rest.request("/guilds/%2e%2e/users/@me")).rejects.toThrow("安全绝对路径");
        await expect(rest.request("/guilds/%2F/users/@me")).rejects.toThrow("安全绝对路径");
        await expect(rest.request("/users/@me?with_counts=true")).rejects.toThrow("安全绝对路径");
    });

    it("保留 Discord 平台错误字段与请求标识", async () => {
        const transport = sequenceTransport([
            {
                status: 404,
                headers: { "x-request-id": "request-1" },
                body: JSON.stringify({ code: 10_007, message: "Unknown Member" }),
            },
        ]);
        const rest = new DiscordREST({ token: "secret", transport });

        await expect(rest.getGuildMember("1", "2")).rejects.toMatchObject({
            name: "DiscordError",
            code: "DISCORD_API_ERROR",
            status: 404,
            discordCode: 10_007,
            requestId: "request-1",
            endpoint: "/guilds/1/members/2",
        });
    });

    it("遵守 429 retry_after 后自动重试同一路由", async () => {
        vi.useFakeTimers();
        const transport = sequenceTransport([
            {
                status: 429,
                headers: {},
                body: JSON.stringify({ message: "rate limited", retry_after: 0.01 }),
            },
            { status: 200, headers: {}, body: JSON.stringify({ id: "ok" }) },
        ]);
        const rest = new DiscordREST({ token: "secret", transport });

        const request = rest.getUser("123");
        await vi.advanceTimersByTimeAsync(20);

        await expect(request).resolves.toMatchObject({ id: "ok" });
        expect(transport.request).toHaveBeenCalledTimes(2);
    });

    it("保留 false 请求体并编码审计日志原因", async () => {
        const transport = sequenceTransport([{ status: 200, headers: {}, body: "{}" }]);
        const rest = new DiscordREST({ token: "secret", transport });

        await rest.request("/applications/1", {
            method: "PATCH",
            body: false,
            reason: "空 格/测试",
        });

        expect(transport.request).toHaveBeenCalledWith(
            "https://discord.com/api/v10/applications/1",
            expect.objectContaining({
                body: "false",
                headers: expect.objectContaining({
                    "X-Audit-Log-Reason": encodeURIComponent("空 格/测试"),
                }),
            }),
        );
    });

    it("以重复 query key 编码 Discord 数组筛选器", async () => {
        const transport = sequenceTransport([{ status: 200, headers: {}, body: "{}" }]);
        const rest = new DiscordREST({ token: "secret", transport });

        await rest.request("/guilds/1/messages/search", {
            query: {
                channel_id: ["10", "20"],
                author_type: ["user", "-bot"],
                include_nsfw: false,
                omitted: undefined,
            },
        });

        expect(transport.request).toHaveBeenCalledWith(
            "https://discord.com/api/v10/guilds/1/messages/search?channel_id=10&channel_id=20&author_type=user&author_type=-bot&include_nsfw=false",
            expect.any(Object),
        );
    });

    it("在传输前拒绝过长审计日志原因", async () => {
        const transport = sequenceTransport([{ status: 200, headers: {}, body: "{}" }]);
        const rest = new DiscordREST({ token: "secret", transport });

        await expect(
            rest.request("/applications/1", { reason: "x".repeat(513) }),
        ).rejects.toMatchObject({ code: "DISCORD_AUDIT_REASON_INVALID" });
        expect(transport.request).not.toHaveBeenCalled();
    });

    it("已识别为同一 Discord bucket 的不同路由不会并发穿透", async () => {
        let release!: () => void;
        const blocked = new Promise<void>(resolve => {
            release = resolve;
        });
        let call = 0;
        const transport: DiscordHttpTransport = {
            request: vi.fn(async () => {
                call += 1;
                if (call === 3) await blocked;
                return {
                    status: 200,
                    headers: { "x-ratelimit-bucket": "shared" },
                    body: "{}",
                };
            }),
        };
        const rest = new DiscordREST({ token: "secret", transport });
        const firstRoute = "/channels/100000000000000001/messages";
        const secondRoute = "/channels/100000000000000002/messages";
        await rest.request(firstRoute);
        await rest.request(secondRoute);

        const first = rest.request(firstRoute);
        const second = rest.request(secondRoute);
        await vi.waitFor(() => expect(transport.request).toHaveBeenCalledTimes(3));
        expect(transport.request).toHaveBeenCalledTimes(3);
        release();
        await Promise.all([first, second]);
        expect(transport.request).toHaveBeenCalledTimes(4);
    });
});

describe("Discord multipart", () => {
    it("使用 payload_json 与 files[n] 构建附件请求", () => {
        const result = buildDiscordMultipart(
            { content: "说明" },
            [
                {
                    data: new TextEncoder().encode("binary"),
                    filename: "image.png",
                    contentType: "image/png",
                    description: "截图",
                },
            ],
            "boundary",
        );
        const body = new TextDecoder().decode(result.body);
        expect(result.contentType).toBe("multipart/form-data; boundary=boundary");
        expect(body).toContain('name="payload_json"');
        expect(body).toContain(
            '"attachments":[{"id":0,"filename":"image.png","description":"截图"}]',
        );
        expect(body).toContain('name="files[0]"; filename="image.png"');
        expect(body).toContain("Content-Type: image/png\r\n\r\nbinary");
        expect(body.endsWith("--boundary--\r\n")).toBe(true);
    });
});

function sequenceTransport(responses: DiscordHttpResponse[]): DiscordHttpTransport {
    return {
        request: vi.fn(async () => {
            const response = responses.shift();
            if (!response) throw new Error("missing response");
            return response;
        }),
    };
}
