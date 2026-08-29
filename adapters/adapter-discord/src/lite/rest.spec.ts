import { describe, expect, it } from "vitest";
import { buildDiscordMultipart } from "./multipart.js";
import { DiscordREST } from "./rest.js";

describe("DiscordREST endpoint boundary", () => {
    it("在发送 token 前拒绝外部 URL、路径穿越和内嵌 query", async () => {
        const rest = new DiscordREST({ token: "secret" });
        await expect(rest.request("https://example.com/api")).rejects.toThrow("安全绝对路径");
        await expect(rest.request("/guilds/../users/@me")).rejects.toThrow("安全绝对路径");
        await expect(rest.request("/users/@me?with_counts=true")).rejects.toThrow("安全绝对路径");
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
        expect(body).toContain('"attachments":[{"id":0,"filename":"image.png","description":"截图"}]');
        expect(body).toContain('name="files[0]"; filename="image.png"');
        expect(body).toContain("Content-Type: image/png\r\n\r\nbinary");
        expect(body.endsWith("--boundary--\r\n")).toBe(true);
    });
});
