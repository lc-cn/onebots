import { describe, expect, it, vi } from "vitest";
import { ErrorCategory } from "onebots";
import { FeishuBot } from "./bot.js";

describe("FeishuBot 目录资源", () => {
    it("遍历群成员 page_token 直到 has_more 结束", async () => {
        const bot = createBot();
        const get = vi.spyOn(bot, "get");
        get.mockResolvedValueOnce({
            data: {
                code: 0,
                msg: "ok",
                data: {
                    items: [{ open_id: "ou_1", name: "Alice" }],
                    has_more: true,
                    page_token: "next",
                },
            },
        } as never);
        get.mockResolvedValueOnce({
            data: {
                code: 0,
                msg: "ok",
                data: { items: [{ open_id: "ou_2", name: "Bob" }], has_more: false },
            },
        } as never);

        await expect(bot.getChatMembers("oc_1")).resolves.toHaveLength(2);
        expect(get).toHaveBeenNthCalledWith(2, "/im/v1/chats/oc_1/members", {
            page_size: 100,
            page_token: "next",
        });
    });

    it("群成员详情验证真实成员身份", async () => {
        const bot = createBot();
        vi.spyOn(bot, "get").mockResolvedValue({
            data: {
                code: 0,
                msg: "ok",
                data: { items: [{ open_id: "ou_1", name: "Alice" }], has_more: false },
            },
        } as never);

        await expect(bot.getChatMember("oc_1", "ou_1")).resolves.toMatchObject({ name: "Alice" });
        await expect(bot.getChatMember("oc_1", "ou_missing")).rejects.toMatchObject({
            code: "FEISHU_GROUP_MEMBER_NOT_FOUND",
            category: ErrorCategory.RESOURCE,
        });
    });

    it("拒绝缺失或重复的后续页游标", async () => {
        const bot = createBot();
        const get = vi.spyOn(bot, "get").mockResolvedValue({
            data: {
                code: 0,
                msg: "ok",
                data: { items: [{ open_id: "ou_1", name: "Alice" }], has_more: true },
            },
        } as never);

        await expect(bot.getChatMembers("oc_1")).rejects.toMatchObject({
            code: "FEISHU_PAGINATION_INVALID",
        });
        expect(get).toHaveBeenCalledOnce();

        const repeated = createBot();
        const repeatedGet = vi.spyOn(repeated, "get").mockResolvedValue({
            data: {
                code: 0,
                msg: "ok",
                data: { items: [], has_more: true, page_token: "same" },
            },
        } as never);
        await expect(repeated.getChatMembers("oc_1")).rejects.toMatchObject({
            code: "FEISHU_PAGINATION_INVALID",
            category: ErrorCategory.PROTOCOL,
        });
        expect(repeatedGet).toHaveBeenCalledTimes(2);
    });

    it("资源 ID 进入路径前会被编码", async () => {
        const bot = createBot();
        const get = vi.spyOn(bot, "get").mockResolvedValue({
            data: { code: 0, msg: "ok", data: { chat_id: "oc/1" } },
        } as never);

        await bot.getChatInfo("oc/1");

        expect(get).toHaveBeenCalledWith("/im/v1/chats/oc%2F1");
    });
});

function createBot(): FeishuBot {
    return new FeishuBot({
        account_id: "A1",
        app_id: "cli_1",
        app_secret: "secret",
        receive_mode: "webhook",
    });
}
