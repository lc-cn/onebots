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

    it("双向保留 AI 实体、反馈回路与建议操作", () => {
        const aiEntity = {
            type: "https://schema.org/Message",
            "@type": "Message",
            additionalType: ["AIGeneratedContent"],
            citation: [
                {
                    "@type": "Claim",
                    position: 1,
                    appearance: {
                        "@type": "DigitalDocument",
                        name: "规范",
                        abstract: "官方规范",
                    },
                },
            ],
        };
        const activity = compileTeamsActivity(
            [
                { type: "text", data: { text: "结论 [1]" } },
                { type: "at", data: { id: "u1", name: "Ada" } },
                {
                    type: "teams_activity",
                    data: {
                        entities: [aiEntity],
                        channel_data: { feedbackLoop: { type: "default" } },
                        suggested_actions: {
                            actions: [{ type: "imBack", title: "继续", value: "继续" }],
                        },
                        delivery_mode: "notification",
                        locale: "zh-CN",
                    },
                },
            ],
            { resolveUserId: String },
        );

        expect(activity.entities).toEqual([
            expect.objectContaining({ type: "mention" }),
            aiEntity,
        ]);
        expect(activity).toMatchObject({
            locale: "zh-CN",
            deliveryMode: "notification",
            channelData: { feedbackLoop: { type: "default" } },
            suggestedActions: {
                to: [],
                actions: [{ type: "imBack", title: "继续", value: "继续" }],
            },
        });

        expect(projectTeamsSegments(baseActivity(activity))).toContainEqual({
            type: "teams_activity",
            data: expect.objectContaining({
                entities: [aiEntity],
                channel_data: { feedbackLoop: { type: "default" } },
                suggested_actions: activity.suggestedActions,
                delivery_mode: "notification",
                locale: "zh-CN",
            }),
        });
    });

    it("校验建议操作数量、附件冲突和受限枚举", () => {
        expect(() =>
            compileTeamsActivity(
                [
                    { type: "text", data: { text: "选择" } },
                    {
                        type: "teams_activity",
                        data: { suggested_actions: { actions: [] } },
                    },
                ],
                { resolveUserId: String },
            ),
        ).toThrow("必须包含 1 到 3 个操作");
        expect(() =>
            compileTeamsActivity(
                [
                    { type: "image", data: { url: "https://example.com/a.png" } },
                    {
                        type: "teams_activity",
                        data: {
                            suggested_actions: {
                                actions: [{ type: "imBack", title: "继续" }],
                            },
                        },
                    },
                ],
                { resolveUserId: String },
            ),
        ).toThrow("不能与附件同时发送");
        expect(() =>
            compileTeamsActivity(
                [
                    { type: "text", data: { text: "消息" } },
                    { type: "teams_activity", data: { delivery_mode: "ephemeral" } },
                ],
                { resolveUserId: String },
            ),
        ).toThrow("delivery_mode 仅支持");
        expect(() =>
            compileTeamsActivity(
                [
                    { type: "text", data: { text: "AI" } },
                    {
                        type: "teams_activity",
                        data: {
                            entities: [
                                { type: "https://schema.org/Message" },
                                { type: "https://schema.org/Message" },
                            ],
                        },
                    },
                ],
                { resolveUserId: String },
            ),
        ).toThrow("只能包含一个根 Message entity");
        expect(() =>
            compileTeamsActivity(
                [
                    { type: "text", data: { text: "反馈" } },
                    {
                        type: "teams_activity",
                        data: { channel_data: { feedbackLoop: { type: "legacy" } } },
                    },
                ],
                { resolveUserId: String },
            ),
        ).toThrow("feedbackLoop.type 仅支持");
    });

    it("接收时投影回复，并生成标准 Teams 文件信息卡片", () => {
        expect(projectTeamsSegments(baseActivity({ replyToId: "parent" }))[0]).toEqual({
            type: "reply",
            data: { message_id: "parent" },
        });
        const activity = compileTeamsActivity(
            [
                {
                    type: "file",
                    data: {
                        url: "https://example.com/report.pdf",
                        name: "report.pdf",
                        unique_id: "drive-item",
                        file_type: "pdf",
                    },
                },
            ],
            { resolveUserId: String },
        );
        expect(activity.attachments?.[0]).toEqual({
            contentType: "application/vnd.microsoft.teams.card.file.info",
            contentUrl: "https://example.com/report.pdf",
            content: { uniqueId: "drive-item", fileType: "pdf" },
            name: "report.pdf",
        });
    });

    it("拒绝未知、无效和 Teams 无法拉取的媒体段", () => {
        expect(() =>
            compileTeamsActivity([{ type: "unknown", data: {} }], { resolveUserId: String }),
        ).toThrow("不支持消息段 unknown");
        expect(() =>
            compileTeamsActivity([{ type: "adaptive_card", data: {} }], {
                resolveUserId: String,
            }),
        ).toThrow("adaptive_card.content 必须是对象");
        expect(() =>
            compileTeamsActivity([{ type: "image", data: { file: "base64://aW1hZ2U=" } }], {
                resolveUserId: String,
            }),
        ).toThrow("必须是可公开访问的 HTTPS URL");
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
