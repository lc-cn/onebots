import { describe, expect, it, vi } from "vitest";
import { WeComKfClient } from "./client.js";
import { executeWeComKfPlatformAction } from "./platform-actions.js";
import type { WeComKfConfig } from "./types.js";

const config: WeComKfConfig = {
    account_id: "kf",
    corp_id: "ww-corp",
    corp_secret: "secret",
    receive_mode: "manual",
};

describe("微信客服知识库动作", () => {
    it("使用官方 POST 路径管理分组并校验分页", async () => {
        const client = new WeComKfClient(config);
        const call = vi.spyOn(client, "call").mockResolvedValue({ errcode: 0, errmsg: "ok" });

        await executeWeComKfPlatformAction(client, "update_knowledge_group", {
            group_id: "group-1",
            name: "售后",
        });
        await executeWeComKfPlatformAction(client, "list_knowledge_groups", {
            cursor: "next",
            limit: 1000,
        });

        expect(call).toHaveBeenNthCalledWith(1, {
            method: "POST",
            path: "/cgi-bin/kf/knowledge/mod_group",
            body: { group_id: "group-1", name: "售后" },
        });
        expect(call).toHaveBeenNthCalledWith(2, {
            method: "POST",
            path: "/cgi-bin/kf/knowledge/list_group",
            body: { cursor: "next", limit: 1000 },
        });
        await expect(
            executeWeComKfPlatformAction(client, "list_knowledge_groups", { limit: 1001 }),
        ).rejects.toMatchObject({ code: "WECOM_KF_INVALID_PARAMETER" });
        await expect(
            executeWeComKfPlatformAction(client, "add_knowledge_group", {
                name: "超过十二个字符的知识库分组名称",
            }),
        ).rejects.toMatchObject({ code: "WECOM_KF_INVALID_PARAMETER" });
    });

    it("完整传递官方问答结构但闭合关键 ID", async () => {
        const client = new WeComKfClient(config);
        const call = vi.spyOn(client, "call").mockResolvedValue({ errcode: 0, errmsg: "ok" });
        const request = {
            group_id: "group-1",
            question: { text: { content: "如何退款？" } },
            similar_questions: { items: [] },
            answers: [{ text: { content: "请联系售后。" }, attachments: [] }],
        };

        await executeWeComKfPlatformAction(client, "add_knowledge_intent", { request });

        expect(call).toHaveBeenCalledWith({
            method: "POST",
            path: "/cgi-bin/kf/knowledge/add_intent",
            body: request,
        });
        expect(call.mock.calls[0]?.[0].body).not.toBe(request);
        await expect(
            executeWeComKfPlatformAction(client, "add_knowledge_intent", {
                request: { answers: [] },
            }),
        ).rejects.toMatchObject({ code: "WECOM_KF_INVALID_PARAMETER" });
    });
});
