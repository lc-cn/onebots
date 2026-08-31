import type { Adapter } from "onebots";
import { describe, expect, it, vi } from "vitest";
import { projectMilkyIncomingMessage } from "./message-entities.js";

const id = (value: number) => ({ string: String(value), number: value, source: value });

describe("Milky 入站消息实体投影", () => {
    it("私聊消息携带 canonical 好友实体", async () => {
        const adapter = {
            getFriendInfo: vi.fn().mockResolvedValue({
                user_id: id(10001),
                user_name: "Alice",
                sex: "female",
                remark: "A",
                category_id: 2,
                category_name: "朋友",
            }),
        } as unknown as Adapter;

        await expect(
            projectMilkyIncomingMessage(adapter, "bot", {
                message_id: id(9001),
                time: 100,
                sender: {
                    scene_type: "private",
                    scene_id: id(10001),
                    sender_id: id(10001),
                    sender_name: "Alice",
                    scene_name: "",
                },
                message: [{ type: "text", data: { text: "hello" } }],
            }),
        ).resolves.toMatchObject({
            message_scene: "friend",
            peer_id: 10001,
            message_seq: 9001,
            friend: { user_id: 10001, category: { category_id: 2 } },
        });
    });

    it("群聊消息并行获取群与成员实体", async () => {
        const adapter = {
            getGroupInfo: vi.fn().mockResolvedValue({
                group_id: id(20001),
                group_name: "OneBots",
                member_count: 20,
                max_member_count: 500,
            }),
            getGroupMemberInfo: vi.fn().mockResolvedValue({
                group_id: id(20001),
                user_id: id(10001),
                user_name: "Alice",
                sex: "female",
                level: 12,
                role: "member",
                join_time: 100,
                last_sent_time: 200,
            }),
        } as unknown as Adapter;

        await expect(
            projectMilkyIncomingMessage(adapter, "bot", {
                message_id: id(9001),
                time: 200,
                sender: {
                    scene_type: "group",
                    scene_id: id(20001),
                    sender_id: id(10001),
                    sender_name: "Alice",
                    scene_name: "OneBots",
                },
                message: [{ type: "text", data: { text: "hello" } }],
            }),
        ).resolves.toMatchObject({
            message_scene: "group",
            peer_id: 20001,
            group: { group_id: 20001 },
            group_member: { group_id: 20001, user_id: 10001 },
        });
        expect(adapter.getGroupInfo).toHaveBeenCalledOnce();
        expect(adapter.getGroupMemberInfo).toHaveBeenCalledOnce();
    });
});
