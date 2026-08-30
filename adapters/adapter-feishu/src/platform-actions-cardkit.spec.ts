import { describe, expect, it, vi } from "vitest";
import { feishuCapabilities } from "./capabilities.js";
import { executeFeishuPlatformAction } from "./platform-actions.js";

describe("飞书 CardKit 平台动作", () => {
    it("从结构化卡片创建实体并发送实体消息", async () => {
        const callApi = vi.fn().mockResolvedValue({ code: 0 });
        const bot = { callApi } as never;
        const card = {
            schema: "2.0",
            config: { streaming_mode: true },
            body: { elements: [{ tag: "markdown", element_id: "answer", content: "准备中" }] },
        };
        await executeFeishuPlatformAction(bot, "create_card_entity", { card });
        expect(callApi).toHaveBeenNthCalledWith(1, "/cardkit/v1/cards", {
            method: "POST",
            body: { type: "card_json", data: JSON.stringify(card) },
        });

        await executeFeishuPlatformAction(bot, "send_card_entity", {
            card_id: "card_1",
            receive_id: "oc_1",
            receive_id_type: "chat_id",
            uuid: "send-1",
        });
        expect(callApi).toHaveBeenNthCalledWith(2, "/im/v1/messages", {
            method: "POST",
            params: { receive_id_type: "chat_id", uuid: "send-1" },
            body: {
                receive_id: "oc_1",
                msg_type: "interactive",
                content: JSON.stringify({ type: "card", data: { card_id: "card_1" } }),
            },
        });
    });

    it("按 sequence 和 uuid 更新卡片实体、配置与局部动作", async () => {
        const callApi = vi.fn().mockResolvedValue({ code: 0 });
        const bot = { callApi } as never;
        await executeFeishuPlatformAction(bot, "update_card_entity", {
            card_id: "card_1",
            card: { schema: "2.0", body: { elements: [] } },
            sequence: 2,
            uuid: "update-2",
        });
        expect(callApi).toHaveBeenNthCalledWith(1, "/cardkit/v1/cards/card_1", {
            method: "PUT",
            body: {
                card: {
                    type: "card_json",
                    data: JSON.stringify({ schema: "2.0", body: { elements: [] } }),
                },
                sequence: 2,
                uuid: "update-2",
            },
        });

        await executeFeishuPlatformAction(bot, "update_card_settings", {
            card_id: "card_1",
            settings: { config: { enable_forward: false } },
            sequence: 3,
        });
        expect(callApi).toHaveBeenNthCalledWith(2, "/cardkit/v1/cards/card_1/settings", {
            method: "PATCH",
            body: {
                settings: JSON.stringify({ config: { enable_forward: false } }),
                sequence: 3,
            },
        });

        const actions = [{ action: "update", element_id: "answer", content: "done" }];
        await executeFeishuPlatformAction(bot, "batch_update_card", {
            card_id: "card_1",
            actions,
            sequence: 4,
        });
        expect(callApi).toHaveBeenNthCalledWith(3, "/cardkit/v1/cards/card_1/batch_update", {
            method: "POST",
            body: { actions: JSON.stringify(actions), sequence: 4 },
        });
    });

    it("支持组件增改、属性 Patch、流式文本与删除", async () => {
        const callApi = vi.fn().mockResolvedValue({ code: 0 });
        const bot = { callApi } as never;
        const element = { tag: "markdown", element_id: "answer", content: "开始" };
        await executeFeishuPlatformAction(bot, "create_card_elements", {
            card_id: "card_1",
            type: "insert_after",
            target_element_id: "title",
            elements: [element],
            sequence: 5,
        });
        expect(callApi).toHaveBeenNthCalledWith(1, "/cardkit/v1/cards/card_1/elements", {
            method: "POST",
            body: {
                type: "insert_after",
                target_element_id: "title",
                elements: JSON.stringify([element]),
                sequence: 5,
            },
        });

        await executeFeishuPlatformAction(bot, "update_card_element", {
            card_id: "card_1",
            element_id: "answer",
            element: { ...element, content: "替换" },
            sequence: 6,
        });
        await executeFeishuPlatformAction(bot, "patch_card_element", {
            card_id: "card_1",
            element_id: "answer",
            partial_element: { content: "局部" },
            sequence: 7,
        });
        await executeFeishuPlatformAction(bot, "stream_card_element_content", {
            card_id: "card_1",
            element_id: "answer",
            content: "逐字输出完成",
            sequence: 8,
        });
        await executeFeishuPlatformAction(bot, "delete_card_element", {
            card_id: "card_1",
            element_id: "answer",
            sequence: 9,
        });
        expect(callApi.mock.calls.slice(1).map(call => [call[0], call[1].method])).toEqual([
            ["/cardkit/v1/cards/card_1/elements/answer", "PUT"],
            ["/cardkit/v1/cards/card_1/elements/answer", "PATCH"],
            ["/cardkit/v1/cards/card_1/elements/answer/content", "PUT"],
            ["/cardkit/v1/cards/card_1/elements/answer", "DELETE"],
        ]);
        expect(callApi).toHaveBeenNthCalledWith(
            4,
            "/cardkit/v1/cards/card_1/elements/answer/content",
            { method: "PUT", body: { content: "逐字输出完成", sequence: 8 } },
        );
    });

    it("拒绝失序、缺少锚点和非 JSON 卡片数据", async () => {
        const bot = { callApi: vi.fn() } as never;
        await expect(
            executeFeishuPlatformAction(bot, "update_card_entity", {
                card_id: "card_1",
                card: { schema: "2.0" },
                sequence: 1.5,
            }),
        ).rejects.toMatchObject({ code: "FEISHU_INVALID_PARAM" });
        await expect(
            executeFeishuPlatformAction(bot, "create_card_elements", {
                card_id: "card_1",
                type: "insert_before",
                elements: [{ tag: "markdown" }],
                sequence: 1,
            }),
        ).rejects.toMatchObject({ code: "FEISHU_INVALID_PARAM" });
        await expect(
            executeFeishuPlatformAction(bot, "create_card_entity", {
                card: { value: BigInt(1) },
            }),
        ).rejects.toMatchObject({ code: "FEISHU_INVALID_PARAM" });
    });

    it("从注册表自动声明 CardKit 权限", () => {
        expect(feishuCapabilities.actions.create_card_entity).toMatchObject({
            support: "native",
            permissions: ["cardkit:card:write"],
        });
        expect(feishuCapabilities.actions.send_card_entity).toMatchObject({
            support: "native",
            permissions: ["im:message"],
        });
    });
});
