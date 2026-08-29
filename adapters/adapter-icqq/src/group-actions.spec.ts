import type { Client } from "@icqqjs/icqq";
import { describe, expect, it, vi } from "vitest";
import { ICQQGroupActions } from "./group-actions.js";

const id = (value: string | number) => ({
    string: String(value),
    source: value,
    number:
        typeof value === "number"
            ? value
            : value === "flag-1"
              ? 701
              : value === "flag-2"
                ? 702
                : Number(value) || 1,
});

function createActions(client: Client): ICQQGroupActions {
    const actions = Object.create(ICQQGroupActions.prototype) as ICQQGroupActions;
    Object.defineProperties(actions, {
        requireNativeClient: { value: () => client },
        numericId: { value: (value: string) => Number(value) },
    });
    return actions;
}

describe("ICQQ 群动作", () => {
    it("将系统消息投影为可翻页且可处理的 canonical 群通知", async () => {
        const requests = [
            {
                request_type: "group",
                sub_type: "add",
                flag: "flag-1",
                group_id: 20001,
                user_id: 10001,
                comment: "申请加入",
            },
            {
                request_type: "group",
                sub_type: "invite",
                flag: "flag-2",
                group_id: 20002,
                user_id: 10002,
            },
        ];
        const setGroupAddRequest = vi.fn().mockResolvedValue(true);
        const client = {
            uin: 99999,
            getSystemMsg: vi.fn().mockResolvedValue(requests),
            setGroupAddRequest,
        } as unknown as Client;
        const actions = createActions(client);
        Object.defineProperty(actions, "createId", { value: id });

        await expect(actions.getGroupNotifications("bot", { limit: 1 })).resolves.toEqual({
            notifications: [
                expect.objectContaining({
                    type: "join_request",
                    comment: "申请加入",
                    notification_id: expect.objectContaining({ number: 701 }),
                }),
            ],
            next_notification_id: expect.objectContaining({ number: 702 }),
        });
        await expect(actions.getGroupNotifications("bot", { is_filtered: true })).resolves.toEqual({
            notifications: [],
        });
        await actions.handleGroupRequest("bot", {
            request_id: id("flag-1"),
            group_id: id(20001),
            type: "request",
            sub_type: "add",
            approve: true,
            is_filtered: false,
        });
        expect(setGroupAddRequest).toHaveBeenCalledWith("flag-1", true, undefined);
    });

    it("保留群创建时间和完整成员资料", async () => {
        const bot = {
            getGroupList: vi.fn().mockResolvedValue([
                {
                    group_id: 20001,
                    group_name: "OneBots",
                    member_count: 20,
                    max_member_count: 500,
                    created_time: 100,
                },
            ]),
            getGroupMemberList: vi.fn().mockResolvedValue([
                {
                    group_id: 20001,
                    user_id: 10001,
                    nickname: "Alice",
                    card: "管理员",
                    sex: "female",
                    age: 20,
                    area: "广东",
                    level: 12,
                    role: "admin",
                    join_time: 100,
                    last_sent_time: 200,
                    title: "活跃成员",
                    title_expire_time: 300,
                    shut_up_end_time: 400,
                },
            ]),
        };
        const actions = Object.create(ICQQGroupActions.prototype) as ICQQGroupActions;
        Object.defineProperties(actions, {
            getAccount: { value: () => ({ client: bot }) },
            createId: { value: id },
            numericId: { value: (value: string) => Number(value) },
        });

        await expect(actions.getGroupList("bot", { no_cache: true })).resolves.toEqual([
            expect.objectContaining({ created_time: 100 }),
        ]);
        await expect(
            actions.getGroupMemberList("bot", {
                group_id: id(20001),
                no_cache: true,
            }),
        ).resolves.toEqual([
            expect.objectContaining({
                sex: "female",
                age: 20,
                area: "广东",
                level: 12,
                join_time: 100,
                last_sent_time: 200,
                title: "活跃成员",
                title_expire_time: 300,
                shut_up_end_time: 400,
            }),
        ]);
        expect(bot.getGroupList).toHaveBeenCalledWith(true);
        expect(bot.getGroupMemberList).toHaveBeenCalledWith(20001, true);
    });

    it("按表态类型添加和删除群消息回应", async () => {
        const setReaction = vi.fn().mockResolvedValue({});
        const delReaction = vi.fn().mockResolvedValue({});
        const client = {
            getMsg: vi.fn().mockResolvedValue({
                message_type: "group",
                group_id: 20001,
                seq: 9001,
            }),
            pickGroup: vi.fn(() => ({ setReaction, delReaction })),
        } as unknown as Client;
        const actions = createActions(client);

        await actions.sendGroupMessageReaction("bot", {
            group_id: id(20001),
            message_id: id("message-id"),
            reaction: "14",
            reaction_type: "face",
            is_add: true,
        });
        await actions.sendGroupMessageReaction("bot", {
            group_id: id(20001),
            message_id: id("message-id"),
            reaction: "128077",
            reaction_type: "emoji",
            is_add: false,
        });

        expect(setReaction).toHaveBeenCalledWith(9001, "14", 1);
        expect(delReaction).toHaveBeenCalledWith(9001, "128077", 2);
    });
});
