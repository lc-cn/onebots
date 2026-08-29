import { describe, expect, it } from "vitest";
import { compileDiscordMessage } from "./messages.js";

describe("Discord message compiler", () => {
    it("编译文本、提及、回复、Embed 与多种附件", () => {
        const result = compileDiscordMessage([
            { type: "text", data: { text: "你好 " } },
            { type: "at", data: { user_id: "42" } },
            { type: "reply", data: { message_id: "99" } },
            { type: "embed", data: { title: "状态" } },
            {
                type: "image",
                data: { file: "base64://aW1hZ2U=", name: "image.png", alt: "截图" },
            },
            {
                type: "audio",
                data: { url: "https://cdn.example.com/audio.ogg" },
            },
        ]);

        expect(result.body).toMatchObject({
            content: "你好 <@42>",
            message_reference: { message_id: "99", fail_if_not_exists: true },
            embeds: [{ title: "状态" }],
        });
        expect(result.files).toEqual([
            {
                source: "base64://aW1hZ2U=",
                filename: "image.png",
                contentType: undefined,
                description: "截图",
            },
            {
                source: "https://cdn.example.com/audio.ogg",
                filename: undefined,
                contentType: undefined,
                description: undefined,
            },
        ]);
    });

    it("支持原生 Create Message 字段并拒绝未知段", () => {
        expect(
            compileDiscordMessage([
                {
                    type: "discord_message",
                    data: { body: { content: "native", flags: 4096 } },
                },
            ]).body,
        ).toMatchObject({ content: "native", flags: 4096 });
        expect(() => compileDiscordMessage([{ type: "mystery", data: {} }])).toThrow(
            "不支持消息段 mystery",
        );
    });

    it("可直接回发事件投影得到的规范化提及、频道与回复 ID", () => {
        const id = (string: string) => ({ string, number: 1, source: string });
        const result = compileDiscordMessage([
            { type: "at", data: { user_id: id("42") } },
            { type: "at", data: { role_id: id("43") } },
            { type: "channel", data: { channel_id: id("44") } },
            { type: "reply", data: { message_id: id("45") } },
        ]);

        expect(result.body).toMatchObject({
            content: "<@42><@&43><#44>",
            message_reference: { message_id: "45" },
        });
    });
});
