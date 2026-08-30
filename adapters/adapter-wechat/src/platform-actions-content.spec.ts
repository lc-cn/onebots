import { describe, expect, it, vi } from "vitest";
import type { WechatClient } from "./client.js";
import { executeWechatPlatformAction, WECHAT_PLATFORM_ACTIONS } from "./platform-actions.js";

function mockClient() {
    const call = vi.fn().mockResolvedValue({ errcode: 0 });
    return { client: { call } as unknown as WechatClient, call };
}

describe("微信公众号发布与留言动作", () => {
    it("查询单篇已发布文章使用 article_id", async () => {
        const { client, call } = mockClient();
        await executeWechatPlatformAction(client, "get_published_article", {
            article_id: "article-1",
        });
        expect(call).toHaveBeenCalledWith({
            method: "POST",
            path: "/cgi-bin/freepublish/getarticle",
            body: { article_id: "article-1" },
        });
    });

    it("完整映射留言查询与回复字段", async () => {
        const { client, call } = mockClient();
        await executeWechatPlatformAction(client, "list_article_comments", {
            message_data_id: 42,
            index: 1,
            begin: 0,
            count: 20,
            type: 1,
        });
        await executeWechatPlatformAction(client, "reply_article_comment", {
            message_data_id: 42,
            index: 1,
            comment_id: 7,
            content: "感谢留言",
        });
        expect(call.mock.calls).toEqual([
            [
                {
                    method: "POST",
                    path: "/cgi-bin/comment/list",
                    body: { msg_data_id: 42, index: 1, begin: 0, count: 20, type: 1 },
                },
            ],
            [
                {
                    method: "POST",
                    path: "/cgi-bin/comment/reply/add",
                    body: {
                        msg_data_id: 42,
                        index: 1,
                        user_comment_id: 7,
                        content: "感谢留言",
                    },
                },
            ],
        ]);
    });

    it("公开完整留言生命周期并闭合参数范围", async () => {
        const { client } = mockClient();
        for (const action of [
            "open_article_comments",
            "close_article_comments",
            "mark_article_comment_selected",
            "unmark_article_comment_selected",
            "delete_article_comment",
            "reply_article_comment",
            "delete_article_comment_reply",
        ]) {
            expect(WECHAT_PLATFORM_ACTIONS.has(action)).toBe(true);
        }
        await expect(
            executeWechatPlatformAction(client, "list_article_comments", {
                message_data_id: 42,
                count: 51,
            }),
        ).rejects.toMatchObject({ code: "WECHAT_INVALID_PARAMETER" });
        await expect(
            executeWechatPlatformAction(client, "open_article_comments", {
                message_data_id: 42,
                typo: true,
            }),
        ).rejects.toMatchObject({ code: "WECHAT_ACTION_PARAM_UNKNOWN" });
    });
});
