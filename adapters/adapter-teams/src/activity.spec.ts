import { describe, expect, it } from "vitest";
import { compileTeamsActivity, projectTeamsSegments } from "./activity.js";
import type { TeamsActivity } from "./types.js";

describe("Teams Activity 消息转换", () => {
    it("发送时生成真实 mention entity 与自适应卡片附件", () => {
        const activity = compileTeamsActivity(
            [
                { type: "text", data: { text: "你好 " } },
                { type: "at", data: { id: "mapped", name: "Ada" } },
                {
                    type: "adaptive_card",
                    data: { content: { type: "AdaptiveCard", version: "1.5", body: [] } },
                },
            ],
            { resolveUserId: id => `raw-${id}` },
        );

        expect(activity.text).toBe("你好 <at>Ada</at>");
        expect(activity.entities?.[0]).toMatchObject({
            type: "mention",
            text: "<at>Ada</at>",
            mentioned: { id: "raw-mapped", name: "Ada" },
        });
        expect(activity.attachments?.[0]).toMatchObject({
            contentType: "application/vnd.microsoft.card.adaptive",
        });
    });

    it("接收时恢复 mention 顺序并保留卡片结构", () => {
        const activity = baseActivity({
            text: "Hi <at>Ada</at>!",
            entities: [
                { type: "mention", text: "<at>Ada</at>", mentioned: { id: "u1", name: "Ada" } },
            ],
            attachments: [
                {
                    contentType: "application/vnd.microsoft.card.adaptive",
                    content: { type: "AdaptiveCard", body: [] },
                },
            ],
        });

        expect(projectTeamsSegments(activity)).toEqual([
            { type: "text", data: { text: "Hi " } },
            { type: "at", data: { id: "u1", name: "Ada", aad_object_id: undefined } },
            { type: "text", data: { text: "!" } },
            {
                type: "adaptive_card",
                data: { content: { type: "AdaptiveCard", body: [] }, name: undefined },
            },
        ]);
    });

    it("支持回复、媒体附件与 Teams Activity 扩展选项", () => {
        const activity = compileTeamsActivity(
            [
                { type: "reply", data: { message_id: "m1" } },
                { type: "image", data: { url: "https://example.com/a.png", mime: "image/png" } },
                {
                    type: "teams_activity",
                    data: {
                        summary: "摘要",
                        importance: "high",
                        channel_data: { notification: true },
                    },
                },
            ],
            { resolveUserId: String },
        );
        expect(activity).toMatchObject({
            replyToId: "m1",
            summary: "摘要",
            importance: "high",
            channelData: { notification: true },
            attachments: [{ contentType: "image/png", contentUrl: "https://example.com/a.png" }],
        });
    });
});

function baseActivity(overrides: Partial<TeamsActivity>): TeamsActivity {
    return {
        type: "message",
        id: "m1",
        timestamp: "2026-08-29T00:00:00.000Z",
        channelId: "msteams",
        from: { id: "u1", name: "Ada" },
        conversation: { id: "c1", conversationType: "personal" },
        ...overrides,
    };
}
