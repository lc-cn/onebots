import { describe, expect, it, vi } from "vitest";
import type { LineBot } from "./bot.js";
import { LineApiError } from "./errors.js";
import { executeLinePlatformAction, LINE_PLATFORM_ACTIONS } from "./platform-actions.js";

describe("LINE 平台动作注册表", () => {
    it("完整注册全部消息、Rich Menu 与统计动作", () => {
        expect(LINE_PLATFORM_ACTIONS.size).toBe(72);
        expect(LINE_PLATFORM_ACTIONS).toEqual(
            expect.objectContaining({
                has: expect.any(Function),
            }),
        );
        expect(LINE_PLATFORM_ACTIONS.has("push_message")).toBe(true);
        expect(LINE_PLATFORM_ACTIONS.has("create_rich_menu")).toBe(true);
        expect(LINE_PLATFORM_ACTIONS.has("get_rich_menu_insight_daily")).toBe(true);
    });

    it("按领域分派到 Bot 语义入口与官方客户端", async () => {
        const pushMessage = vi.fn(async () => ({ sent: true }));
        const getRichMenu = vi.fn(async () => ({ richMenuId: "rich-1" }));
        const getMembershipList = vi.fn(async () => ({ memberships: [] }));
        const client = { getRichMenu, getMembershipList };
        const bot = {
            pushMessage,
            getClient: () => client,
        } as unknown as LineBot;

        await expect(
            executeLinePlatformAction(bot, "push_message", {
                to: "U1",
                messages: [{ type: "text", text: "hello" }],
            }),
        ).resolves.toEqual({ sent: true });
        await expect(
            executeLinePlatformAction(bot, "get_rich_menu", { rich_menu_id: "rich-1" }),
        ).resolves.toEqual({ richMenuId: "rich-1" });
        await expect(executeLinePlatformAction(bot, "get_membership_list", {})).resolves.toEqual({
            memberships: [],
        });

        expect(pushMessage).toHaveBeenCalledWith("U1", [{ type: "text", text: "hello" }], {
            retryKey: undefined,
            notificationDisabled: undefined,
            customAggregationUnits: undefined,
        });
        expect(getRichMenu).toHaveBeenCalledWith("rich-1");
        expect(getMembershipList).toHaveBeenCalledOnce();
    });

    it("未知动作返回稳定的结构化错误", async () => {
        const bot = { getClient: () => ({}) } as unknown as LineBot;
        const promise = executeLinePlatformAction(bot, "missing_action", {});
        await expect(promise).rejects.toBeInstanceOf(LineApiError);
        await expect(promise).rejects.toMatchObject({ code: "LINE_ACTION_NOT_IMPLEMENTED" });
    });
});
