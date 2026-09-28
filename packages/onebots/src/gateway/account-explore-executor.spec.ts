import { describe, expect, it, vi } from "vitest";
import type { Adapter, BaseApp } from "@onebots/core";
import { isControlAccountExploreResult, type ControlSendContext } from "@onebots/core/control";
import { GatewayAccountExploreExecutor } from "./account-explore-executor.js";

const expected: ControlSendContext = {
    gatewayInstanceId: "00000000-0000-4000-8000-000000000001",
    configVersion: "a".repeat(64),
};
const identity = (string: string) => ({ string, source: string, number: 1 });

function setup(
    actions: Record<
        string,
        {
            support: "native" | "unsupported";
            scenes?: readonly ("private" | "direct" | "group" | "channel")[];
        }
    >,
) {
    const getFriendList = vi
        .fn()
        .mockResolvedValue([{ user_id: identity("friend-1"), user_name: "好友", remark: "备注" }]);
    const getChannelList = vi
        .fn()
        .mockResolvedValue([{ channel_id: identity("channel-1"), channel_name: "频道" }]);
    const adapter = {
        accounts: new Map([["bot", { status: "online" }]]),
        describeCapabilities: () => ({ actions }),
        resolveId: identity,
        getFriendList,
        getChannelList,
    } as unknown as Adapter;
    const app = { adapters: new Map([["mock", adapter]]) } as unknown as Pick<BaseApp, "adapters">;
    return {
        executor: new GatewayAccountExploreExecutor(app, expected),
        getFriendList,
        getChannelList,
    };
}

describe("账号控制页平台能力查询", () => {
    it("仅查询已声明能力，并只返回可展示的标准字段", async () => {
        const { executor, getFriendList } = setup({
            get_friend_list: { support: "native" },
            send_message: { support: "native", scenes: ["direct", "channel"] },
        });
        const result = await executor.explore({
            expected,
            account: "mock/bot",
            action: "friends",
            kind: "friend",
        });
        expect(getFriendList).toHaveBeenCalledWith("bot");
        expect(result).toMatchObject({
            supported: true,
            sendScenes: { private: false, direct: true, group: false, channel: true },
            items: [{ kind: "friend", id: "friend-1", name: "好友", subtitle: "备注" }],
        });
        expect(
            await executor.explore({
                expected,
                account: "mock/bot",
                action: "groups",
                kind: "group",
            }),
        ).toMatchObject({ supported: false, items: [] });
    });

    it("direct-only 不能冒充按用户 ID 发送的私聊能力", async () => {
        const { executor } = setup({
            send_message: { support: "native", scenes: ["group", "direct"] },
        });
        expect(
            await executor.explore({
                expected,
                account: "mock/bot",
                action: "friends",
                kind: "friend",
            }),
        ).toMatchObject({
            supported: false,
            sendScenes: { private: false, direct: true, group: true, channel: false },
        });
    });

    it("频道查询传入服务器 ID，拒绝过期网关上下文", async () => {
        const { executor, getChannelList } = setup({ get_channel_list: { support: "native" } });
        const request = {
            expected,
            account: "mock/bot",
            action: "channels" as const,
            kind: "channel" as const,
            guildId: "guild-1",
        };
        expect(await executor.explore(request)).toMatchObject({
            items: [{ id: "channel-1", parentId: "guild-1" }],
        });
        expect(getChannelList).toHaveBeenCalledWith("bot", { guild_id: identity("guild-1") });
        expect(await executor.explore({ ...request, guildId: undefined })).toMatchObject({
            items: [{ id: "channel-1" }],
            truncated: false,
        });
        expect(getChannelList).toHaveBeenLastCalledWith("bot", undefined);
        expect(
            await executor.explore({
                ...request,
                expected: { ...expected, configVersion: "b".repeat(64) },
            }),
        ).toBeUndefined();
    });

    it("平台返回空名称时以 ID 兜底，避免联系人卡片没有可读标题", async () => {
        const { executor, getFriendList } = setup({ get_friend_list: { support: "native" } });
        getFriendList.mockResolvedValueOnce([
            { user_id: identity("friend-1"), user_name: "  ", remark: "  " },
        ]);
        expect(
            await executor.explore({
                expected,
                account: "mock/bot",
                action: "friends",
                kind: "friend",
            }),
        ).toMatchObject({ items: [{ id: "friend-1", name: "friend-1" }] });
    });

    it("多行备注不会让整张列表失效，非法或超长 ID 不被截断成错误目标", async () => {
        const { executor, getFriendList } = setup({ get_friend_list: { support: "native" } });
        const longId = "x".repeat(300);
        getFriendList.mockResolvedValueOnce([
            { user_id: identity("bad\nid"), user_name: "无效" },
            { user_id: identity("x".repeat(513)), user_name: "超长" },
            { user_id: identity("friend-1"), user_name: "好友\n一", remark: "第一行\n第二行" },
            { user_id: identity(longId), user_name: "" },
        ]);
        const result = await executor.explore({
            expected,
            account: "mock/bot",
            action: "friends",
            kind: "friend",
        });
        expect(result?.items).toEqual([
            { kind: "friend", id: "friend-1", name: "好友 一", subtitle: "第一行 第二行" },
            { kind: "friend", id: longId, name: "x".repeat(256) },
        ]);
        expect(result?.truncated).toBe(false);
        expect(isControlAccountExploreResult(result)).toBe(true);
    });

    it("大量长资料按控制响应预算截断，保留可用的前部列表", async () => {
        const { executor, getFriendList } = setup({ get_friend_list: { support: "native" } });
        getFriendList.mockResolvedValueOnce(
            Array.from({ length: 500 }, (_, index) => ({
                user_id: identity(`${index}-${"x".repeat(490)}`),
                user_name: "名称".repeat(120),
                remark: "备注".repeat(120),
                role: "角色".repeat(120),
            })),
        );
        const result = await executor.explore({
            expected,
            account: "mock/bot",
            action: "friends",
            kind: "friend",
        });
        expect(result?.items.length).toBeGreaterThan(0);
        expect(result?.items.length).toBeLessThan(500);
        expect(result?.truncated).toBe(true);
        expect(isControlAccountExploreResult(result)).toBe(true);
    });
});
