import { MediaFileType, MsgType } from "@tencent-connect/qqbot-nodejs";
import { describe, expect, it, vi } from "vitest";
import type { QQClient } from "./client.js";
import { QQApiError } from "./errors.js";
import { compileMessage, sendQQMessage } from "./messages.js";

describe("QQ 消息编译", () => {
    it("编译文本、提及、回复和媒体而不丢失平台语义", () => {
        const result = compileMessage([
            { type: "reply", data: { message_id: "m0" } },
            { type: "at", data: { qq: "u1" } },
            { type: "text", data: { text: " hello" } },
            { type: "image", data: { url: "https://example.com/a.png" } },
        ]);
        expect(result).toMatchObject({
            content: "<@u1> hello",
            replyId: "m0",
            media: [{ type: MediaFileType.IMAGE, source: "https://example.com/a.png" }],
        });
    });

    it("保留 Markdown 和键盘结构", () => {
        const result = compileMessage([
            { type: "markdown", data: { content: "# 标题" } },
            { type: "keyboard", data: { content: { rows: [] } } },
        ]);
        expect(result.advanced).toMatchObject({
            msgType: MsgType.MARKDOWN,
            markdown: { content: "# 标题" },
            keyboard: { content: { rows: [] } },
        });
    });

    it("拒绝静默丢弃未知消息段", () => {
        expect(() => compileMessage([{ type: "unknown", data: {} }])).toThrow(QQApiError);
    });

    it("将统一用户 ID 还原为 QQ openid", () => {
        const resolveUserId = vi.fn(value => `openid:${value}`);
        const result = compileMessage([{ type: "at", data: { user_id: 42 } }], resolveUserId);
        expect(result.content).toBe("<@openid:42>");
        expect(resolveUserId).toHaveBeenCalledWith(42);
    });

    it("还原统一回复 ID，并接受 canonical Id 对象", () => {
        const id = { string: "mapped-message", source: "native-message", number: 42 };
        expect(compileMessage([{ type: "reply", data: { message_id: id } }])).toMatchObject({
            replyId: "native-message",
        });
    });

    it("拒绝重复回复与互相覆盖的富消息段", () => {
        expect(() =>
            compileMessage([
                { type: "reply", data: { id: "m1" } },
                { type: "reply", data: { id: "m2" } },
            ]),
        ).toThrowError(/只能包含一个 reply/u);
        expect(() =>
            compileMessage([
                { type: "markdown", data: { content: "hello" } },
                { type: "ark", data: { template_id: 1 } },
            ]),
        ).toThrowError(/富消息段/u);
    });

    it("校验 keyboard 结构而不接受任意 JSON 断言", () => {
        expect(() =>
            compileMessage([{ type: "keyboard", data: { content: { rows: [{}] } } }]),
        ).toThrowError(/buttons 数组/u);
    });

    it("将群媒体文本合并为 caption 并剥离 Base64 前缀", async () => {
        const send = vi.fn();
        const sendMedia = vi.fn().mockResolvedValue({ message: { id: "m1" } });
        const client = { send, sendMedia } as unknown as QQClient;
        await expect(
            sendQQMessage(client, {
                scene_type: "group",
                scene_id: { string: "g1", source: "g1", number: 1 },
                message: [
                    { type: "text", data: { text: "说明" } },
                    { type: "image", data: { file: "base64://YWJj" } },
                ],
            }),
        ).resolves.toBe("m1");
        expect(send).not.toHaveBeenCalled();
        expect(sendMedia).toHaveBeenCalledWith(
            expect.objectContaining({ content: "说明", fileData: "YWJj" }),
        );
    });

    it("使用上传返回的 file_id 直接发送富媒体而不重复上传", async () => {
        const send = vi.fn().mockResolvedValue({ id: "m1" });
        const sendMedia = vi.fn();
        const client = { send, sendMedia } as unknown as QQClient;
        const resolveId = vi.fn(() => "opaque-file-info");

        await expect(
            sendQQMessage(
                client,
                {
                    scene_type: "private",
                    scene_id: { string: "u1", source: "u1", number: 1 },
                    message: [
                        { type: "text", data: { text: "附件" } },
                        { type: "file", data: { file_id: 42, name: "report.pdf" } },
                    ],
                },
                resolveId,
            ),
        ).resolves.toBe("m1");
        expect(resolveId).toHaveBeenCalledWith(42);
        expect(sendMedia).not.toHaveBeenCalled();
        expect(send).toHaveBeenCalledWith({
            target: { scope: "c2c", targetId: "u1", msgId: undefined },
            msgType: MsgType.MEDIA,
            media: { file_info: "opaque-file-info" },
            content: "附件",
        });
    });

    it("在请求前拒绝频道多图与本地图片路径", async () => {
        const call = vi.fn();
        const client = { call } as unknown as QQClient;
        const params = {
            scene_type: "channel" as const,
            scene_id: { string: "c1", source: "c1", number: 1 },
            message: [
                { type: "image", data: { url: "https://example.com/1.png" } },
                { type: "image", data: { url: "https://example.com/2.png" } },
            ],
        };
        await expect(sendQQMessage(client, params)).rejects.toMatchObject({
            code: "QQ_GUILD_MEDIA_LIMIT",
        });
        await expect(
            sendQQMessage(client, {
                ...params,
                message: [{ type: "image", data: { path: "/tmp/image.png" } }],
            }),
        ).rejects.toMatchObject({ code: "QQ_GUILD_IMAGE_URL_REQUIRED" });
        expect(call).not.toHaveBeenCalled();
    });
});
