import { describe, expect, it, vi } from "vitest";
import { compileZulipMessage } from "./messages.js";

describe("Zulip 消息编译", () => {
    it("编译文本、用户提及、图片和文件 Markdown", async () => {
        const resolveMention = vi.fn().mockResolvedValue({ id: 2, name: "Alice" });
        const upload = vi
            .fn()
            .mockResolvedValueOnce({ url: "/image.png", name: "image.png" })
            .mockResolvedValueOnce({ url: "/file.zip", name: "file.zip" });

        const content = await compileZulipMessage(
            [
                { type: "text", data: { text: "hello" } },
                { type: "at", data: { id: "2" } },
                { type: "image", data: { caption: "截图" } },
                { type: "file", data: { name: "资料" } },
            ],
            { resolveMention, upload },
        );

        expect(content).toBe("hello@**Alice|2**\n![截图](/image.png)\n[资料](/file.zip)");
    });

    it("拒绝平台无法无损表达的消息段", async () => {
        await expect(
            compileZulipMessage([{ type: "video", data: {} }], {
                resolveMention: vi.fn(),
                upload: vi.fn(),
            }),
        ).rejects.toMatchObject({ code: "ZULIP_UNSUPPORTED_SEGMENT" });
    });
});
