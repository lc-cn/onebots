import { describe, expect, it } from "vitest";
import {
    accountControlItemKey,
    accountControlSceneType,
    emptyAccountControlList,
    filterAccountControlItems,
    manualAccountTargetLabel,
    recentAccountControlItem,
} from "./account-control-list.js";

describe("账号控制联系人列表", () => {
    it("按名称、ID 和备注检索，并忽略输入首尾空格", () => {
        const items = [
            { kind: "friend" as const, id: "user-1", name: "小明", subtitle: "项目负责人" },
            { kind: "friend" as const, id: "user-2", name: "小红" },
        ];
        expect(filterAccountControlItems(items, "  负责人  ")).toEqual([items[0]]);
        expect(filterAccountControlItems(items, "USER-2")).toEqual([items[1]]);
        expect(filterAccountControlItems(items, "小明")).toEqual([items[0]]);
        expect(filterAccountControlItems(items, "不存在")).toEqual([]);
    });

    it("空列表状态彼此独立，未加载不冒充平台不支持", () => {
        const first = emptyAccountControlList();
        first.items.push({ kind: "group", id: "group-1", name: "群" });
        expect(emptyAccountControlList()).toMatchObject({
            items: [],
            loaded: false,
            supported: true,
        });
    });

    it("频道目录能力变化时更新手动 ID 的含义", () => {
        expect(manualAccountTargetLabel("channel", false, false)).toBe("服务器 ID");
        expect(manualAccountTargetLabel("channel", false, true)).toBe("频道 ID");
        expect(manualAccountTargetLabel("channel", true, true)).toBe("目标 ID");
        expect(manualAccountTargetLabel("friend", false, false)).toBe("目标 ID");
    });

    it("私聊、群与频道使用稳定的历史场景", () => {
        expect(accountControlSceneType("friend")).toBe("private");
        expect(accountControlSceneType("group")).toBe("group");
        expect(accountControlSceneType("channel")).toBe("channel");
    });

    it("最近会话保留 direct 与频道服务器身份，不混同联系人目录", () => {
        const latest = {
            id: 1,
            platform: "mock",
            accountId: "bot",
            sceneType: "direct" as const,
            sceneId: "room-1",
            senderId: "member",
            senderName: "成员",
            direction: "inbound" as const,
            text: "你好",
            time: 1,
        };
        expect(
            recentAccountControlItem({ sceneType: "direct", sceneId: "room-1", latest }),
        ).toMatchObject({
            kind: "friend",
            sceneType: "direct",
            id: "room-1",
            latestText: "你好",
        });
        expect(
            recentAccountControlItem({
                sceneType: "channel",
                sceneId: "general",
                guildId: "guild-a",
                latest: { ...latest, sceneType: "channel", sceneId: "general", guildId: "guild-a" },
            }),
        ).toMatchObject({ kind: "channel", id: "general", parentId: "guild-a" });
    });

    it("列表键区分相同 ID 的普通私聊、多人直聊及不同服务器频道", () => {
        const item = { kind: "friend" as const, id: "same", name: "相同 ID" };
        expect(accountControlItemKey(item)).not.toBe(
            accountControlItemKey({ ...item, sceneType: "direct" }),
        );
        const channel = { kind: "channel" as const, id: "general", name: "公告" };
        expect(accountControlItemKey({ ...channel, parentId: "guild-a" })).not.toBe(
            accountControlItemKey({ ...channel, parentId: "guild-b" }),
        );
    });
});
