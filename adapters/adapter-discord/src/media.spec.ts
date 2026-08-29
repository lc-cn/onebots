import { describe, expect, it } from "vitest";
import { materializeDiscordFile } from "./media.js";

describe("Discord media", () => {
    it("物化 base64:// 与 data URL", async () => {
        const base64 = await materializeDiscordFile({
            source: "base64://aGVsbG8=",
            filename: "hello.txt",
        });
        expect(new TextDecoder().decode(base64.data)).toBe("hello");
        expect(base64.contentType).toBe("text/plain");

        const dataUrl = await materializeDiscordFile({
            source: "data:image/png;base64,aW1hZ2U=",
            filename: "image.png",
            description: "图像",
        });
        expect(new TextDecoder().decode(dataUrl.data)).toBe("image");
        expect(dataUrl.contentType).toBe("image/png");
        expect(dataUrl.description).toBe("图像");
    });

    it("拒绝无效 Base64、响应头注入和带凭据 URL", async () => {
        await expect(materializeDiscordFile({ source: "base64://***" })).rejects.toThrow(
            "Base64 数据无效",
        );
        await expect(
            materializeDiscordFile({
                source: "base64://YQ==",
                contentType: "image/png\r\nX-Evil: yes",
            }),
        ).rejects.toThrow("content type 无效");
        await expect(
            materializeDiscordFile({ source: "https://user:pass@example.com/file" }),
        ).rejects.toThrow("不能包含凭据");
    });
});
