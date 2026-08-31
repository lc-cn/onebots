import { describe, expect, it, vi } from "vitest";
import { prepareWechatMediaSegments, uploadWechatMedia } from "./media.js";

describe("微信公众号临时素材管线", () => {
    it("上传视频和独立缩略图并保留段结构", async () => {
        const uploadTemporaryMedia = vi
            .fn()
            .mockResolvedValueOnce({ media_id: "video-1" })
            .mockResolvedValueOnce({ media_id: "thumb-1" });
        const result = await prepareWechatMediaSegments({ uploadTemporaryMedia }, [
            {
                type: "video",
                data: {
                    data: "aGVsbG8h",
                    name: "video.mp4",
                    thumb_data: "aGVsbG8h",
                    thumb_filename: "thumb.jpg",
                },
            },
        ]);
        expect(result).toEqual([
            expect.objectContaining({
                data: expect.objectContaining({
                    media_id: "video-1",
                    thumb_media_id: "thumb-1",
                }),
            }),
        ]);
        expect(uploadTemporaryMedia).toHaveBeenNthCalledWith(
            1,
            "video",
            expect.any(Blob),
            "video.mp4",
        );
        expect(uploadTemporaryMedia).toHaveBeenNthCalledWith(
            2,
            "thumb",
            expect.any(Blob),
            "thumb.jpg",
        );
    });

    it("入站素材 ID 优先于 URL 元数据，不重复上传", async () => {
        const uploadTemporaryMedia = vi.fn();
        const segment = {
            type: "image",
            data: { file_id: "media-1", url: "https://example.com/inbound.jpg" },
        };
        await expect(
            prepareWechatMediaSegments({ uploadTemporaryMedia }, [segment]),
        ).resolves.toEqual([expect.objectContaining({ data: segment.data })]);
        expect(uploadTemporaryMedia).not.toHaveBeenCalled();
    });

    it("在平台请求前拒绝超限缩略图", async () => {
        const uploadTemporaryMedia = vi.fn();
        const oversized = Buffer.alloc(64 * 1024 + 1).toString("base64");
        await expect(
            uploadWechatMedia({ uploadTemporaryMedia }, "thumb", {
                source: `base64://${oversized}`,
                filename: "thumb.jpg",
            }),
        ).rejects.toMatchObject({ code: "WECHAT_INVALID_MEDIA" });
        expect(uploadTemporaryMedia).not.toHaveBeenCalled();
    });
});
