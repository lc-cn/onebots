import { describe, expect, it } from "vitest";
import { compileGoogleChatMessage, projectGoogleChatMessage } from "./messages.js";

describe("Google Chat 消息编译", () => {
    it("编译文本、mention、emoji 与已上传附件", () => {
        expect(
            compileGoogleChatMessage([
                { type: "text", data: { text: "hello " } },
                { type: "at", data: { user_id: "users/alice" } },
                { type: "emoji", data: { emoji: "👍" } },
                {
                    type: "image",
                    data: {
                        name: "image.png",
                        attachment_data_ref: { resourceName: "spaces/A/attachments/one" },
                    },
                },
            ]),
        ).toEqual({
            text: "hello <users/alice>👍",
            attachment: [
                {
                    contentName: "image.png",
                    attachmentDataRef: { resourceName: "spaces/A/attachments/one" },
                },
            ],
        });
    });

    it("拒绝伪造目标和未经 upload_file 的媒体", () => {
        expect(() =>
            compileGoogleChatMessage([{ type: "at", data: { user_id: "alice" } }]),
        ).toThrow(/resource name/u);
        expect(() =>
            compileGoogleChatMessage([
                { type: "image", data: { url: "https://example.com/a.png" } },
            ]),
        ).toThrow(/upload_file/u);
        expect(() => compileGoogleChatMessage([{ type: "reply", data: { id: "1" } }])).toThrow(
            /不支持消息段/u,
        );
    });

    it("投影附件与卡片并保留 Google 原生字段", () => {
        expect(
            projectGoogleChatMessage({
                name: "spaces/A/messages/one",
                attachment: [
                    {
                        name: "spaces/A/messages/one/attachments/file",
                        contentName: "photo.png",
                        contentType: "image/png",
                        downloadUri: "https://chat.google.com/api/get_attachment_url",
                    },
                ],
            }),
        ).toMatchObject([
            { type: "image", data: { name: "photo.png", content_type: "image/png" } },
        ]);
        expect(
            projectGoogleChatMessage({
                name: "spaces/A/messages/card",
                cardsV2: [{ cardId: "main" }],
            }),
        ).toEqual([{ type: "google_chat_card", data: { cards: [{ cardId: "main" }] } }]);
    });
});
