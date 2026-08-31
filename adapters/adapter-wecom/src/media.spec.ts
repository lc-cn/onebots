import { describe, expect, it, vi } from "vitest";
import { prepareWeComMediaSegments, uploadWeComMedia } from "./media.js";

describe("企业微信临时素材管线", () => {
    it("物化 Base64 图片并替换为当前应用的 media_id", async () => {
        const uploadTemporaryMedia = vi.fn().mockResolvedValue({
            media_id: "media-1",
            created_at: "1",
        });
        const segments = await prepareWeComMediaSegments({ uploadTemporaryMedia }, [
            {
                type: "image",
                data: { data: "aGVsbG8h", name: "image.png" },
            },
        ]);
        expect(segments).toEqual([
            expect.objectContaining({ data: expect.objectContaining({ media_id: "media-1" }) }),
        ]);
        expect(uploadTemporaryMedia).toHaveBeenCalledWith("image", expect.any(Blob), "image.png");
    });

    it("已有 media_id 不重复上传", async () => {
        const uploadTemporaryMedia = vi.fn();
        const segment = { type: "file", data: { file: "wecom://media/existing" } };
        await expect(
            prepareWeComMediaSegments({ uploadTemporaryMedia }, [segment]),
        ).resolves.toEqual([segment]);
        expect(uploadTemporaryMedia).not.toHaveBeenCalled();
    });

    it("在平台请求前拒绝不支持的语音格式", async () => {
        const uploadTemporaryMedia = vi.fn();
        await expect(
            uploadWeComMedia({ uploadTemporaryMedia }, "voice", {
                source: "base64://aGVsbG8h",
                filename: "voice.mp3",
            }),
        ).rejects.toMatchObject({ code: "WECOM_INVALID_MEDIA" });
        expect(uploadTemporaryMedia).not.toHaveBeenCalled();
    });

    it("拒绝多个外部来源，但平台素材 ID 优先于 URL 元数据", async () => {
        const uploadTemporaryMedia = vi.fn();
        await expect(
            prepareWeComMediaSegments({ uploadTemporaryMedia }, [
                { type: "file", data: { url: "https://example.com/a", data: "YWJj" } },
            ]),
        ).rejects.toMatchObject({ code: "WECOM_INVALID_MEDIA" });
        const canonical = {
            type: "image",
            data: { file_id: "m1", url: "https://example.com/inbound.jpg" },
        };
        await expect(
            prepareWeComMediaSegments({ uploadTemporaryMedia }, [canonical]),
        ).resolves.toEqual([canonical]);
        expect(uploadTemporaryMedia).not.toHaveBeenCalled();
    });
});
