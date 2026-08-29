import { describe, expect, it, vi } from "vitest";
import { prepareHeychatMediaSegments, uploadHeychatMedia } from "./media.js";

describe("黑盒语音媒体管线", () => {
    it("物化 Base64 图片并上传到官方 CDN", async () => {
        const uploadMedia = vi.fn().mockResolvedValue("https://cdn.example/image.png");
        await expect(
            prepareHeychatMediaSegments({ uploadMedia }, [
                { type: "image", data: { data: "aGVsbG8=", name: "image.png" } },
            ]),
        ).resolves.toEqual([
            expect.objectContaining({
                data: expect.objectContaining({ url: "https://cdn.example/image.png" }),
            }),
        ]);
        expect(uploadMedia).toHaveBeenCalledWith(expect.any(Uint8Array), "image.png", "image/png");
    });

    it("拒绝多个来源与 content type 注入", async () => {
        const uploadMedia = vi.fn();
        await expect(
            prepareHeychatMediaSegments({ uploadMedia }, [
                { type: "image", data: { url: "https://example.com/a", data: "YWJj" } },
            ]),
        ).rejects.toMatchObject({ code: "HEYCHAT_INVALID_MESSAGE" });
        await expect(
            uploadHeychatMedia(
                { uploadMedia },
                {
                    source: "base64://aGVsbG8=",
                    filename: "a.png",
                    contentType: "image/png\r\nx-forged: true",
                },
            ),
        ).rejects.toMatchObject({ code: "HEYCHAT_MEDIA_UPLOAD_ERROR" });
        expect(uploadMedia).not.toHaveBeenCalled();
    });
});
