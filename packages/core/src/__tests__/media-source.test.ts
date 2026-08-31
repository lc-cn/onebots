import { describe, expect, it } from "vitest";
import { materializeMediaSource } from "../media-source.js";

describe("materializeMediaSource", () => {
    it("统一物化 Base64 来源并推断 MIME", async () => {
        const media = await materializeMediaSource({
            source: "base64://aGVsbG8=",
            filename: "hello.txt",
        });
        expect(new TextDecoder().decode(media.data)).toBe("hello");
        expect(media).toMatchObject({ filename: "hello.txt", contentType: "text/plain" });
    });

    it("拒绝凭据 URL 与 content type 注入", async () => {
        await expect(
            materializeMediaSource({ source: "https://user:pass@example.com/a" }),
        ).rejects.toThrow("不能包含凭据");
        await expect(
            materializeMediaSource({
                source: "base64://YQ==",
                contentType: "image/png\r\nX-Evil: yes",
            }),
        ).rejects.toThrow("content type 无效");
    });

    it("直接物化字节并统一清理文件元数据", async () => {
        const media = await materializeMediaSource({
            source: Uint8Array.from([1, 2, 3]),
            filename: '../unsafe"name.png',
            contentType: "image/png",
        });
        expect([...media.data]).toEqual([1, 2, 3]);
        expect(media.filename).toBe("unsafe_name.png");
        expect(media.contentType).toBe("image/png");
    });
});
