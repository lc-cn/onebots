import { nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
    ControlAccountExploreResult,
    ControlChatConversation,
    ControlChatMessage,
    ControlSendContext,
} from "@onebots/core/control";
import {
    expected,
    friend,
    group,
    message,
    mountControl,
    result,
    status,
} from "./account-control-test-fixture.js";

afterEach(() => vi.unstubAllGlobals());

describe("账号控制会话状态", () => {
    it("最近的多人直聊按独立会话读取历史，不请求好友详情", async () => {
        const direct = { ...message(1), sceneType: "direct" as const, sceneId: "room-1" };
        const fixture = mountControl({
            conversations: async () => ({
                conversations: [{ sceneType: "direct", sceneId: "room-1", latest: direct }],
                hasMore: false,
            }),
            history: async () => ({ messages: [direct] }),
        });
        try {
            await vi.waitFor(() => expect(fixture.control.visibleList.value.items).toHaveLength(1));
            const item = fixture.control.visibleList.value.items[0];
            await fixture.control.choose(item);
            await vi.waitFor(() => expect(fixture.control.messages.value).toHaveLength(1));
            expect(fixture.chatHistory).toHaveBeenCalledWith(
                expect.objectContaining({ sceneType: "direct", sceneId: "room-1" }),
            );
            expect(fixture.explore).not.toHaveBeenCalledWith(
                expect.objectContaining({ action: "detail", id: "room-1" }),
            );
            expect(fixture.control.canChat.value).toBe(true);
        } finally {
            fixture.close();
        }
    });

    it("平台未声明 direct 发送能力时仍可读历史，但禁用发送", async () => {
        const direct = { ...message(1), sceneType: "direct" as const, sceneId: "room-1" };
        const fixture = mountControl({
            conversations: async () => ({
                conversations: [{ sceneType: "direct", sceneId: "room-1", latest: direct }],
                hasMore: false,
            }),
            explore: async request =>
                result(request, {
                    sendScenes: { private: true, direct: false, group: false, channel: false },
                }),
        });
        try {
            await vi.waitFor(() => expect(fixture.control.visibleList.value.items).toHaveLength(1));
            await fixture.control.choose(fixture.control.visibleList.value.items[0]);
            await vi.waitFor(() => expect(fixture.control.sendUnsupported.value).toBe(true));
            expect(fixture.control.canChat.value).toBe(false);
        } finally {
            fixture.close();
        }
    });

    it("最近会话刷新同时重试发送能力读取", async () => {
        let friendReads = 0;
        const direct = { ...message(1), sceneType: "direct" as const, sceneId: "room-1" };
        const fixture = mountControl({
            conversations: async () => ({
                conversations: [{ sceneType: "direct", sceneId: "room-1", latest: direct }],
                hasMore: false,
            }),
            explore: async request => {
                if (request.action === "friends" && ++friendReads === 1)
                    throw new Error("temporary");
                return result(request);
            },
        });
        try {
            await vi.waitFor(() => expect(fixture.control.visibleList.value.items).toHaveLength(1));
            await vi.waitFor(() => expect(friendReads).toBe(1));
            await fixture.control.choose(fixture.control.visibleList.value.items[0]);
            expect(fixture.control.sendCapabilityPending.value).toBe(true);
            await fixture.control.refreshVisibleList();
            expect(friendReads).toBe(2);
            expect(fixture.control.canChat.value).toBe(true);
        } finally {
            fixture.close();
        }
    });

    it("最近会话刷新未完成时忽略重复操作", async () => {
        let finishRefresh!: (value: {
            conversations: ControlChatConversation[];
            hasMore: boolean;
        }) => void;
        const waiting = new Promise<{ conversations: ControlChatConversation[]; hasMore: boolean }>(
            resolve => {
                finishRefresh = resolve;
            },
        );
        let reads = 0;
        const fixture = mountControl({
            conversations: async () => {
                reads++;
                return reads === 1 ? { conversations: [], hasMore: false } : waiting;
            },
        });
        try {
            await vi.waitFor(() => expect(fixture.control.visibleList.value.loaded).toBe(true));
            const refreshing = fixture.control.refreshVisibleList();
            await fixture.control.refreshVisibleList();
            expect(reads).toBe(2);
            finishRefresh({ conversations: [], hasMore: false });
            await refreshing;
        } finally {
            fixture.close();
        }
    });

    it("详情读取失败后可在原会话重试，不重置聊天记录", async () => {
        let detailReads = 0;
        const fixture = mountControl({
            history: async () => ({ messages: [message(1)] }),
            explore: async request => {
                if (request.action === "detail" && ++detailReads === 1)
                    throw new Error("temporary");
                return result(request, { items: request.action === "detail" ? [friend] : [] });
            },
        });
        try {
            await fixture.control.choose(friend);
            await vi.waitFor(() => expect(fixture.control.detailError.value).toContain("重试"));
            await vi.waitFor(() => expect(fixture.control.messages.value).toHaveLength(1));
            await fixture.control.loadDetail(friend);
            expect(fixture.control.detailError.value).toBe("");
            expect(fixture.control.activeItem.value).toEqual(friend);
            expect(fixture.control.messages.value).toHaveLength(1);
            expect(fixture.chatHistory).toHaveBeenCalledOnce();
        } finally {
            fixture.close();
        }
    });

    it("详情连续重试时较早失败不能覆盖较晚成功", async () => {
        let rejectEarlier!: (error: Error) => void;
        const earlier = new Promise<ControlAccountExploreResult>((_resolve, reject) => {
            rejectEarlier = reject;
        });
        let detailReads = 0;
        const fixture = mountControl({
            explore: async request => {
                if (request.action !== "detail") return result(request);
                detailReads++;
                if (detailReads === 1) throw new Error("initial failure");
                if (detailReads === 2) return earlier;
                return result(request, { items: [{ ...friend, name: "更新后的好友" }] });
            },
        });
        try {
            await fixture.control.choose(friend);
            expect(fixture.control.detailError.value).toContain("重试");
            const slowRetry = fixture.control.loadDetail(friend);
            await vi.waitFor(() => expect(detailReads).toBe(2));
            await fixture.control.loadDetail(friend);
            expect(fixture.control.activeItem.value?.name).toBe("更新后的好友");
            rejectEarlier(new Error("old failure"));
            await slowRetry;
            expect(fixture.control.detailError.value).toBe("");
            expect(fixture.control.activeItem.value?.name).toBe("更新后的好友");
        } finally {
            fixture.close();
        }
    });

    it("状态读取失败时保留聊天记录但阻止基于旧在线状态发送，恢复后可继续", async () => {
        const fixture = mountControl({ history: async () => ({ messages: [message(1)] }) });
        try {
            await fixture.control.choose(friend);
            await vi.waitFor(() => expect(fixture.control.canChat.value).toBe(true));
            await vi.waitFor(() => expect(fixture.control.messages.value).toHaveLength(1));
            fixture.control.text.value = "待发送内容";
            const sending = fixture.control.sendMessage();
            fixture.props.statusError = "管理状态读取失败";
            await sending;
            expect(fixture.sendMessage).not.toHaveBeenCalled();
            expect(fixture.control.selected.value?.id).toBe(friend.id);
            expect(fixture.control.messages.value).toHaveLength(1);
            expect(fixture.control.canChat.value).toBe(false);
            expect(fixture.control.sendUnsupported.value).toBe(false);
            expect(fixture.control.text.value).toBe("待发送内容");

            fixture.props.statusError = "";
            expect(fixture.control.canChat.value).toBe(true);
            expect(fixture.control.selected.value?.id).toBe(friend.id);
        } finally {
            fixture.close();
        }
    });

    it("聊天历史重试期间保留错误入口，成功后再清除错误", async () => {
        let finishRetry!: (value: { messages: ControlChatMessage[] }) => void;
        const waiting = new Promise<{ messages: ControlChatMessage[] }>(resolve => {
            finishRetry = resolve;
        });
        let historyReads = 0;
        const fixture = mountControl({
            history: async () => {
                if (++historyReads === 1) throw new Error("temporary");
                return waiting;
            },
        });
        try {
            await fixture.control.choose(friend);
            await vi.waitFor(() => expect(fixture.control.historyError.value).toContain("失败"));
            const retry = fixture.control.loadHistory();
            expect(fixture.control.historyLoading.value).toBe(true);
            expect(fixture.control.historyError.value).toContain("失败");
            finishRetry({ messages: [message(1)] });
            await retry;
            expect(fixture.control.historyError.value).toBe("");
            expect(fixture.control.messages.value).toHaveLength(1);
        } finally {
            fixture.close();
        }
    });

    it("最近会话加载更早页时保留现有条目，失败可原位置重试", async () => {
        let fail = true;
        const latest = { ...message(10), sceneType: "direct" as const, sceneId: "room-10" };
        const older = { ...message(9), sceneType: "direct" as const, sceneId: "room-9" };
        const fixture = mountControl({
            conversations: async (_platform, _accountId, before) => {
                if (!before)
                    return {
                        conversations: [{ sceneType: "direct", sceneId: "room-10", latest }],
                        hasMore: true,
                    };
                if (fail) throw new Error("temporary");
                return {
                    conversations: [{ sceneType: "direct", sceneId: "room-9", latest: older }],
                    hasMore: false,
                };
            },
        });
        try {
            await vi.waitFor(() => expect(fixture.control.recentHasMore.value).toBe(true));
            await fixture.control.loadOlderRecent();
            expect(fixture.control.visibleList.value.items).toHaveLength(1);
            expect(fixture.control.recentOlderError.value).toContain("重试");
            fail = false;
            await fixture.control.loadOlderRecent();
            expect(fixture.chatConversations).toHaveBeenCalledWith("mock", "bot", 10);
            expect(fixture.control.visibleList.value.items.map(item => item.id)).toEqual([
                "room-10",
                "room-9",
            ]);
            expect(fixture.control.recentHasMore.value).toBe(false);
        } finally {
            fixture.close();
        }
    });

    it("更早会话加载期间不并发刷新第一页，避免分页结果与刷新交叉", async () => {
        let finishOlder!: (value: {
            conversations: ControlChatConversation[];
            hasMore: boolean;
        }) => void;
        const older = new Promise<{ conversations: ControlChatConversation[]; hasMore: boolean }>(
            resolve => {
                finishOlder = resolve;
            },
        );
        const latest = { ...message(10), sceneType: "direct" as const, sceneId: "room-10" };
        const fixture = mountControl({
            conversations: async (_platform, _accountId, before) =>
                before
                    ? older
                    : {
                          conversations: [{ sceneType: "direct", sceneId: "room-10", latest }],
                          hasMore: true,
                      },
        });
        try {
            await vi.waitFor(() => expect(fixture.control.recentHasMore.value).toBe(true));
            const pending = fixture.control.loadOlderRecent();
            await fixture.control.loadRecent(true);
            expect(fixture.chatConversations).toHaveBeenCalledTimes(2);
            finishOlder({ conversations: [], hasMore: false });
            await pending;
        } finally {
            fixture.close();
        }
    });
    it("网关上下文暂不可用时仍读取已保存的聊天记录", async () => {
        const fixture = mountControl({
            context: async () => {
                throw new Error("offline");
            },
            history: async () => ({ messages: [message(1)] }),
        });
        try {
            await fixture.control.choose(friend);
            await vi.waitFor(() => expect(fixture.control.messages.value).toHaveLength(1));
            expect(fixture.chatHistory).toHaveBeenCalledOnce();
            expect(fixture.control.detailError.value).toContain("仍可查看");
        } finally {
            fixture.close();
        }
    });

    it("切换会话后不再为旧群加载成员", async () => {
        let finishGroup!: (value: ControlAccountExploreResult) => void;
        const groupDetail = new Promise<ControlAccountExploreResult>(resolve => {
            finishGroup = resolve;
        });
        const fixture = mountControl({
            explore: async request =>
                request.action === "detail" && request.kind === "group"
                    ? groupDetail
                    : result(request, { items: request.action === "detail" ? [friend] : [] }),
        });
        try {
            const oldChoice = fixture.control.choose(group);
            await vi.waitFor(() =>
                expect(fixture.explore).toHaveBeenCalledWith(
                    expect.objectContaining({ action: "detail", kind: "group" }),
                ),
            );
            await fixture.control.choose(friend);
            finishGroup(
                result({
                    expected,
                    account: "mock/bot",
                    action: "detail",
                    kind: "group",
                    id: group.id,
                }),
            );
            await oldChoice;
            expect(fixture.explore).not.toHaveBeenCalledWith(
                expect.objectContaining({ action: "members", kind: "group" }),
            );
            expect(fixture.control.memberLoading.value).toBe(false);
        } finally {
            fixture.close();
        }
    });

    it("手机端打开群聊只读历史和详情，查看浮层时才读取成员且不重复请求", async () => {
        let finishMembers!: (value: ControlAccountExploreResult) => void;
        const waiting = new Promise<ControlAccountExploreResult>(resolve => {
            finishMembers = resolve;
        });
        const fixture = mountControl({
            mobile: true,
            history: async () => ({ messages: [message(1)] }),
            explore: async request =>
                request.action === "members"
                    ? waiting
                    : result(request, { items: request.action === "detail" ? [group] : [] }),
        });
        try {
            await fixture.control.choose(group);
            await vi.waitFor(() => expect(fixture.control.messages.value).toHaveLength(1));
            expect(fixture.explore).not.toHaveBeenCalledWith(
                expect.objectContaining({ action: "members" }),
            );

            fixture.control.ensureMembersForSelection();
            fixture.control.ensureMembersForSelection();
            await vi.waitFor(() =>
                expect(fixture.explore).toHaveBeenCalledWith(
                    expect.objectContaining({ action: "members", id: group.id }),
                ),
            );
            expect(
                fixture.explore.mock.calls.filter(([request]) => request.action === "members"),
            ).toHaveLength(1);
            finishMembers(
                result(
                    {
                        expected,
                        account: "mock/bot",
                        action: "members",
                        kind: "group",
                        id: group.id,
                    },
                    { items: [{ kind: "member", id: "member-1", name: "成员" }] },
                ),
            );
            await vi.waitFor(() => expect(fixture.control.members.value).toHaveLength(1));
            fixture.control.ensureMembersForSelection();
            expect(
                fixture.explore.mock.calls.filter(([request]) => request.action === "members"),
            ).toHaveLength(1);
        } finally {
            fixture.close();
        }
    });

    it("刷新最新消息不重新开启已读到底的更早分页", async () => {
        const chatHistory = vi
            .fn()
            .mockResolvedValueOnce({
                messages: Array.from({ length: 50 }, (_, index) => message(index + 51)),
            })
            .mockResolvedValueOnce({
                messages: Array.from({ length: 10 }, (_, index) => message(index + 41)),
            })
            .mockResolvedValue({
                messages: Array.from({ length: 50 }, (_, index) => message(index + 51)),
            });
        const fixture = mountControl({ history: chatHistory });
        try {
            await fixture.control.choose(friend);
            await vi.waitFor(() => expect(fixture.control.messages.value).toHaveLength(50));
            expect(fixture.control.moreHistory.value).toBe(true);
            await fixture.control.loadHistory(true);
            expect(fixture.control.moreHistory.value).toBe(false);
            await fixture.control.loadHistory();
            expect(fixture.control.moreHistory.value).toBe(false);
        } finally {
            fixture.close();
        }
    });

    it("服务器历史缩短或清空后不继续展示已删除的消息", async () => {
        let current = [message(1), message(2)];
        const fixture = mountControl({ history: async () => ({ messages: current }) });
        try {
            await fixture.control.choose(friend);
            await vi.waitFor(() =>
                expect(fixture.control.messages.value.map(item => item.id)).toEqual([1, 2]),
            );
            current = [message(2)];
            await fixture.control.loadHistory();
            expect(fixture.control.messages.value.map(item => item.id)).toEqual([2]);
            expect(fixture.control.moreHistory.value).toBe(false);

            current = [];
            await fixture.control.loadHistory();
            expect(fixture.control.messages.value).toEqual([]);
            expect(fixture.control.moreHistory.value).toBe(false);
        } finally {
            fixture.close();
        }
    });

    it("最新页满 50 条时保留已翻阅的旧页，但移除重叠范围内已删除的消息", async () => {
        const range = (from: number, to: number) =>
            Array.from({ length: to - from + 1 }, (_, index) => message(from + index));
        const history = vi
            .fn()
            .mockResolvedValueOnce({ messages: range(51, 100) })
            .mockResolvedValueOnce({ messages: range(1, 50) })
            .mockResolvedValueOnce({ messages: range(52, 102).filter(item => item.id !== 75) });
        const fixture = mountControl({ history });
        try {
            await fixture.control.choose(friend);
            await vi.waitFor(() => expect(fixture.control.messages.value).toHaveLength(50));
            await fixture.control.loadHistory(true);
            await fixture.control.loadHistory();
            const ids = fixture.control.messages.value.map(item => item.id);
            expect(ids).toHaveLength(101);
            expect(ids).toContain(1);
            expect(ids).toContain(51);
            expect(ids).toContain(102);
            expect(ids).not.toContain(75);
        } finally {
            fixture.close();
        }
    });

    it("历史修订号变化时丢弃已翻阅的旧页，即使新历史也满 50 条", async () => {
        const range = (from: number) =>
            Array.from({ length: 50 }, (_, index) => message(from + index));
        const history = vi
            .fn()
            .mockResolvedValueOnce({ messages: range(51), revision: "before-clear" })
            .mockResolvedValueOnce({ messages: range(1), revision: "before-clear" })
            .mockResolvedValueOnce({ messages: range(101), revision: "after-clear" });
        const fixture = mountControl({ history });
        try {
            await fixture.control.choose(friend);
            await vi.waitFor(() => expect(fixture.control.messages.value).toHaveLength(50));
            await fixture.control.loadHistory(true);
            expect(fixture.control.messages.value).toHaveLength(100);
            await fixture.control.loadHistory();
            expect(fixture.control.messages.value.map(item => item.id)).toEqual(
                range(101).map(item => item.id),
            );
        } finally {
            fixture.close();
        }
    });

    it("历史清理后同时刷新最近会话，不继续展示已删除的会话卡片", async () => {
        let cleared = false;
        const latest = message(1);
        const fixture = mountControl({
            conversations: async () => ({
                conversations: cleared
                    ? []
                    : [{ sceneType: "private", sceneId: friend.id, latest }],
                hasMore: false,
            }),
            history: async () => ({
                messages: cleared ? [] : [latest],
                revision: cleared ? "after-clear" : "before-clear",
            }),
        });
        try {
            await vi.waitFor(() => expect(fixture.control.visibleList.value.items).toHaveLength(1));
            await fixture.control.choose(fixture.control.visibleList.value.items[0]);
            await vi.waitFor(() => expect(fixture.control.messages.value).toHaveLength(1));

            cleared = true;
            await fixture.control.loadHistory();
            await vi.waitFor(() => expect(fixture.control.visibleList.value.items).toEqual([]));
            expect(fixture.chatConversations).toHaveBeenCalledTimes(2);
            expect(fixture.control.messages.value).toEqual([]);
        } finally {
            fixture.close();
        }
    });

    it("历史清理使旧最近会话请求失效，迟到的旧目录不能覆盖清理结果", async () => {
        let finishOldList!: (value: {
            conversations: ControlChatConversation[];
            hasMore: boolean;
        }) => void;
        const oldList = new Promise<{ conversations: ControlChatConversation[]; hasMore: boolean }>(
            resolve => {
                finishOldList = resolve;
            },
        );
        let cleared = false;
        let reads = 0;
        const fixture = mountControl({
            conversations: async () =>
                ++reads === 1 ? oldList : { conversations: [], hasMore: false },
            history: async () => ({
                messages: cleared ? [] : [message(1)],
                revision: cleared ? "after-clear" : "before-clear",
            }),
        });
        try {
            await fixture.control.choose(friend);
            await vi.waitFor(() => expect(fixture.control.messages.value).toHaveLength(1));
            cleared = true;
            await fixture.control.loadHistory();
            await vi.waitFor(() => expect(reads).toBe(2));
            finishOldList({
                conversations: [{ sceneType: "private", sceneId: friend.id, latest: message(1) }],
                hasMore: false,
            });
            await vi.waitFor(() => expect(fixture.control.visibleList.value.loaded).toBe(true));
            expect(fixture.control.visibleList.value.items).toEqual([]);
        } finally {
            fixture.close();
        }
    });

    it("加载旧页期间发生历史清理时，废弃旧游标并自动读取最新页", async () => {
        const latest = Array.from({ length: 50 }, (_, index) => message(index + 51));
        const history = vi
            .fn()
            .mockResolvedValueOnce({ messages: latest, revision: "before-clear" })
            .mockResolvedValueOnce({ messages: [], revision: "after-clear" })
            .mockResolvedValueOnce({ messages: [message(101)], revision: "after-clear" });
        const fixture = mountControl({ history });
        try {
            await fixture.control.choose(friend);
            await vi.waitFor(() => expect(fixture.control.messages.value).toHaveLength(50));
            expect(await fixture.control.loadHistory(true)).toBe("reset");
            await vi.waitFor(() =>
                expect(fixture.control.messages.value.map(item => item.id)).toEqual([101]),
            );
            expect(history.mock.calls[1][0]).toMatchObject({ before: 51 });
            expect(history.mock.calls[2][0]).not.toHaveProperty("before");
        } finally {
            fixture.close();
        }
    });

    it("频道目录从不支持恢复为支持时，手动目标从频道切回服务器", async () => {
        let guildReads = 0;
        const fixture = mountControl({
            explore: async request => {
                if (request.action === "guilds")
                    return result(request, { supported: ++guildReads > 1 });
                return result(request, { items: request.action === "friends" ? [friend] : [] });
            },
        });
        try {
            fixture.control.category.value = "channel";
            await vi.waitFor(() => expect(fixture.control.manualTargetLabel.value).toBe("频道 ID"));
            await fixture.control.loadList("channel", true);
            expect(fixture.control.manualTargetLabel.value).toBe("服务器 ID");
            expect(guildReads).toBe(2);
        } finally {
            fixture.close();
        }
    });

    it("刷新当前服务器的频道列表保留已选会话、聊天记录和上次成功的列表", async () => {
        let channelReads = 0;
        const guild = { kind: "guild" as const, id: "guild-1", name: "服务器" };
        const channel = {
            kind: "channel" as const,
            id: "channel-1",
            name: "频道一",
            parentId: guild.id,
        };
        const fixture = mountControl({
            history: async () => ({
                messages: [{ ...message(1), sceneType: "channel", sceneId: channel.id }],
            }),
            explore: async request => {
                if (request.action === "guilds") return result(request, { items: [guild] });
                if (request.action === "channels") {
                    channelReads++;
                    if (channelReads === 2) throw new Error("temporary");
                    return result(request, {
                        items:
                            channelReads === 1
                                ? [channel]
                                : [channel, { ...channel, id: "channel-2" }],
                    });
                }
                return result(request, { items: request.action === "friends" ? [friend] : [] });
            },
        });
        try {
            fixture.control.category.value = "channel";
            await vi.waitFor(() =>
                expect(fixture.control.visibleList.value.items).toEqual([guild]),
            );
            await fixture.control.choose(guild);
            expect(fixture.control.visibleList.value.items).toEqual([channel]);
            await fixture.control.choose(channel);
            await vi.waitFor(() => expect(fixture.control.messages.value).toHaveLength(1));

            await fixture.control.refreshVisibleList();
            expect(fixture.control.selected.value).toEqual(channel);
            expect(fixture.control.messages.value).toHaveLength(1);
            expect(fixture.control.visibleList.value.items).toEqual([channel]);
            expect(fixture.control.visibleList.value.error).toContain("重试");

            await fixture.control.refreshVisibleList();
            expect(fixture.control.selected.value).toEqual(channel);
            expect(fixture.control.visibleList.value.items).toHaveLength(2);
            expect(fixture.control.visibleList.value.error).toBe("");
        } finally {
            fixture.close();
        }
    });

    it("频道列表刷新期间打开频道，列表响应仍完成且不会卡在加载中", async () => {
        let finishRefresh!: (value: ControlAccountExploreResult) => void;
        const waiting = new Promise<ControlAccountExploreResult>(resolve => {
            finishRefresh = resolve;
        });
        let channelReads = 0;
        const guild = { kind: "guild" as const, id: "guild-1", name: "服务器" };
        const channel = {
            kind: "channel" as const,
            id: "channel-1",
            name: "频道一",
            parentId: guild.id,
        };
        const fixture = mountControl({
            explore: async request => {
                if (request.action === "guilds") return result(request, { items: [guild] });
                if (request.action === "channels")
                    return ++channelReads === 1 ? result(request, { items: [channel] }) : waiting;
                return result(request);
            },
        });
        try {
            fixture.control.category.value = "channel";
            await vi.waitFor(() =>
                expect(fixture.control.visibleList.value.items).toEqual([guild]),
            );
            await fixture.control.choose(guild);
            const refreshing = fixture.control.refreshVisibleList();
            await vi.waitFor(() => expect(fixture.control.visibleList.value.loading).toBe(true));
            await fixture.control.choose(channel);
            finishRefresh(
                result(
                    {
                        expected,
                        account: "mock/bot",
                        action: "channels",
                        kind: "channel",
                        guildId: guild.id,
                    },
                    { items: [channel, { ...channel, id: "channel-2" }] },
                ),
            );
            await refreshing;
            expect(fixture.control.selected.value).toEqual(channel);
            expect(fixture.control.visibleList.value.items).toHaveLength(2);
            expect(fixture.control.visibleList.value.loading).toBe(false);
        } finally {
            fixture.close();
        }
    });

    it("等待上下文时只发起一次同类列表读取", async () => {
        let finishContext!: (value: ControlSendContext) => void;
        const waiting = new Promise<ControlSendContext>(resolve => {
            finishContext = resolve;
        });
        const fixture = mountControl({ context: () => waiting });
        try {
            const duplicate = fixture.control.loadList("friend", true);
            finishContext(expected);
            await duplicate;
            await vi.waitFor(() =>
                expect(fixture.explore).toHaveBeenCalledWith(
                    expect.objectContaining({ action: "friends" }),
                ),
            );
            expect(fixture.explore).toHaveBeenCalledTimes(1);
        } finally {
            fixture.close();
        }
    });

    it("切换账号后清除手填目标和旧消息，丢弃迟到的历史响应", async () => {
        let finishHistory!: (value: { messages: ControlChatMessage[] }) => void;
        const waiting = new Promise<{ messages: ControlChatMessage[] }>(resolve => {
            finishHistory = resolve;
        });
        const fixture = mountControl({ history: () => waiting });
        try {
            fixture.control.manualId.value = "old-target";
            await fixture.control.choose(friend);
            fixture.props.status = {
                ...status,
                accounts: {
                    available: true,
                    items: [{ platform: "mock", accountId: "other", status: "online" }],
                },
            };
            fixture.props.accountId = "other";
            await nextTick();
            finishHistory({ messages: [message(1)] });
            await nextTick();
            expect(fixture.control.selected.value).toBeUndefined();
            expect(fixture.control.messages.value).toEqual([]);
            expect(fixture.control.manualId.value).toBe("");
        } finally {
            fixture.close();
        }
    });

    it("好友历史始终按 private 读取，不与独立 direct 会话混合", async () => {
        const fixture = mountControl({
            history: async () => ({ messages: [message(1)] }),
            explore: async request =>
                result(request, {
                    items: request.action === "friends" ? [friend] : [],
                }),
        });
        try {
            await fixture.control.choose(friend);
            await vi.waitFor(() => expect(fixture.control.messages.value).toHaveLength(1));
            expect(fixture.chatHistory).toHaveBeenCalledWith(
                expect.objectContaining({ sceneType: "private", sceneId: friend.id }),
            );
        } finally {
            fixture.close();
        }
    });

    it("返回会话列表后丢弃已关闭会话的迟到历史和成员响应", async () => {
        let finishHistory!: (value: { messages: ControlChatMessage[] }) => void;
        let finishMembers!: (value: ControlAccountExploreResult) => void;
        const history = new Promise<{ messages: ControlChatMessage[] }>(resolve => {
            finishHistory = resolve;
        });
        const members = new Promise<ControlAccountExploreResult>(resolve => {
            finishMembers = resolve;
        });
        const fixture = mountControl({
            history: () => history,
            explore: async request =>
                request.action === "members" ? members : result(request, { items: [group] }),
        });
        try {
            await fixture.control.choose(group);
            await vi.waitFor(() =>
                expect(fixture.explore).toHaveBeenCalledWith(
                    expect.objectContaining({ action: "members" }),
                ),
            );
            fixture.control.clearSelection();
            finishHistory({ messages: [message(1)] });
            finishMembers(
                result(
                    { expected, account: "mock/bot", action: "members", kind: "group" },
                    {
                        items: [{ kind: "member", id: "member-1", name: "群成员" }],
                    },
                ),
            );
            await nextTick();
            expect(fixture.control.selected.value).toBeUndefined();
            expect(fixture.control.messages.value).toEqual([]);
            expect(fixture.control.members.value).toEqual([]);
            expect(fixture.control.historyLoading.value).toBe(false);
            expect(fixture.control.memberLoading.value).toBe(false);
        } finally {
            fixture.close();
        }
    });

    it("成员请求故障与平台不支持区分，并允许原会话重试", async () => {
        let fail = true;
        const member = { kind: "member" as const, id: "member-1", name: "群成员" };
        const fixture = mountControl({
            explore: async request => {
                if (request.action === "members") {
                    if (fail) throw new Error("network lost");
                    return result(request, { items: [member] });
                }
                return result(request, { items: request.action === "detail" ? [group] : [] });
            },
        });
        try {
            await fixture.control.choose(group);
            await vi.waitFor(() => expect(fixture.control.memberError.value).toContain("失败"));
            expect(fixture.control.membersSupported.value).toBe(true);
            fail = false;
            await fixture.control.loadMembers(group);
            expect(fixture.control.memberError.value).toBe("");
            expect(fixture.control.members.value).toEqual([member]);
        } finally {
            fixture.close();
        }
    });

    it("详情能力变为不支持时，清除旧详情并退回会话基本资料", async () => {
        let supported = true;
        const fixture = mountControl({
            explore: async request =>
                result(request, {
                    supported: request.action === "detail" ? supported : true,
                    items:
                        request.action === "detail" && supported
                            ? [{ ...group, name: "平台详情名称" }]
                            : [],
                }),
        });
        try {
            await fixture.control.choose(group);
            expect(fixture.control.activeItem.value?.name).toBe("平台详情名称");
            supported = false;
            await fixture.control.loadDetail(group);
            expect(fixture.control.activeItem.value?.name).toBe(group.name);
            expect(fixture.control.detailSupported.value).toBe(false);
            expect(fixture.control.detailError.value).toBe("");
        } finally {
            fixture.close();
        }
    });

    it("更早历史读取失败后保留分页意图，重试不会误刷最新页", async () => {
        const history = vi
            .fn()
            .mockResolvedValueOnce({
                messages: Array.from({ length: 50 }, (_, index) => message(index + 51)),
            })
            .mockRejectedValueOnce(new Error("temporary failure"))
            .mockResolvedValueOnce({
                messages: Array.from({ length: 10 }, (_, index) => message(index + 41)),
            });
        const fixture = mountControl({ history });
        try {
            await fixture.control.choose(friend);
            await vi.waitFor(() => expect(fixture.control.messages.value).toHaveLength(50));
            await fixture.control.loadHistory(true);
            expect(fixture.control.historyRetryOlder.value).toBe(true);
            expect(fixture.control.historyError.value).toContain("失败");
            await fixture.control.loadHistory(true);
            expect(fixture.control.messages.value).toHaveLength(60);
            expect(fixture.chatHistory.mock.calls[2][0]).toMatchObject({ before: 51 });
        } finally {
            fixture.close();
        }
    });

    it("历史读取失败后暂停自动轮询，等待用户按原分页意图重试", async () => {
        vi.useFakeTimers();
        const history = vi.fn().mockRejectedValue(new Error("temporary failure"));
        const fixture = mountControl({ history });
        try {
            await fixture.control.choose(friend);
            await vi.waitFor(() => expect(fixture.control.historyError.value).toContain("失败"));
            await vi.advanceTimersByTimeAsync(5000);
            expect(history).toHaveBeenCalledOnce();
        } finally {
            vi.useRealTimers();
            fixture.close();
        }
    });
});
