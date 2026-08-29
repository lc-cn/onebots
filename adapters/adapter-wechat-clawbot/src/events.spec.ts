import { describe, expect, it } from "vitest";
import { projectWechatClawbotEvent } from "./events.js";
import { ItemKind, type InboundWirePacket } from "./sdk/protocol/wire-models.js";

function id(value: string | number) {
    const string = String(value);
    return { string, source: value, number: Number(value) || 0 };
}

describe("微信 ClawBot 事件投影", () => {
    it("保留复合消息顺序、语音语义与原始事件", () => {
        const raw: InboundWirePacket = {
            message_id: 42,
            from_user_id: "wx-user",
            create_time_ms: 1_700_000_000_000,
            context_token: "ctx",
            item_list: [
                { type: ItemKind.Text, text_item: { text: "说明" } },
                {
                    type: ItemKind.Image,
                    image_item: { media: { encrypt_query_param: "image-handle", aes_key: "key" } },
                },
                {
                    type: ItemKind.Voice,
                    voice_item: {
                        text: "转写",
                        media: { encrypt_query_param: "voice-handle" },
                        sample_rate: 16_000,
                    },
                },
            ],
        };

        const event = projectWechatClawbotEvent(
            {
                id: 42,
                seq: undefined,
                type: "photo",
                chat: { id: "wx-user", type: "private" },
                from: { id: "wx-user" },
                date: raw.create_time_ms,
                text: "说明",
                contextToken: "ctx",
                raw,
            },
            { accountId: id("bot"), createId: id },
        );

        expect(event.raw_event).toBe(raw);
        expect(event.raw_message).toBe("说明转写");
        expect(event.message.map(segment => segment.type)).toEqual([
            "text",
            "image",
            "text",
            "audio",
        ]);
        expect(event.message[1]?.data).toMatchObject({ file_id: "image-handle", aes_key: "key" });
        expect(event.extensions?.wechat_clawbot).toMatchObject({ context_token: "ctx" });
    });

    it("未知消息项使用平台原生段保真，不伪造文本", () => {
        const raw: InboundWirePacket = {
            message_id: 43,
            from_user_id: "wx-user",
            item_list: [{ type: 11 }],
        };
        const event = projectWechatClawbotEvent(
            {
                id: 43,
                seq: undefined,
                type: "unknown",
                chat: { id: "wx-user", type: "private" },
                from: { id: "wx-user" },
                date: undefined,
                raw,
            },
            { accountId: id("bot"), createId: id },
        );
        expect(event.message).toEqual([
            { type: "wechat_clawbot_raw", data: { item: { type: 11 } } },
        ]);
    });

    it("拒绝缺少稳定标识或发送者的非 canonical 消息", () => {
        const base = {
            id: undefined,
            seq: undefined,
            type: "unknown" as const,
            chat: { id: "peer", type: "private" as const },
            from: { id: "peer" },
            date: undefined,
            raw: { from_user_id: "peer", item_list: [] },
        };
        expect(() =>
            projectWechatClawbotEvent(base, { accountId: id("bot"), createId: id }),
        ).toThrow("稳定标识");
        expect(() =>
            projectWechatClawbotEvent(
                { ...base, id: "client", from: { id: "" } },
                { accountId: id("bot"), createId: id },
            ),
        ).toThrow("发送者");
    });
});
