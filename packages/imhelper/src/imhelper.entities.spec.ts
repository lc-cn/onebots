import { describe, expect, test, vi } from "vitest";
import { Adapter } from "./adapter.js";
import { GroupMember } from "./instances/groupMember.js";
import { User } from "./instances/user.js";
import { ImHelper } from "./imhelper.js";

class EntityAdapter extends Adapter<string> {
    readonly selfId = "bot";
    userName = "初始名称";
    readonly sendMessageMock = vi.fn(async (_options: Adapter.SendMessageOptions<string>) => ({
        message_id: "sent",
    }));
    readonly kickMock = vi.fn(async (_groupId: string, _userId: string) => undefined);
    readonly recallMock = vi.fn(async (_messageId: string) => true);
    readonly updateMock = vi.fn(async (_messageId: string, _content: string) => undefined);

    async getUserList(): Promise<User.Data<string>[]> {
        return [{ user_id: "user-1", user_name: this.userName, avatar: "avatar" }];
    }

    async getGroupList() {
        return [{ group_id: "group-1", group_name: "测试群", avatar: "" }];
    }

    async getGroupMemberList(groupId: string): Promise<GroupMember.Data<string>[]> {
        return [
            {
                group_id: groupId,
                user_id: "user-1",
                user_name: this.userName,
                avatar: "avatar",
                role: "admin",
            },
        ];
    }

    async getMessage() {
        return {
            timestamp: 1,
            bot_id: this.selfId,
            message_id: "message-1",
            user_id: "user-1",
            content: "hello",
            message_type: "private" as const,
        };
    }

    async sendMessage(options: Adapter.SendMessageOptions<string>) {
        return this.sendMessageMock(options);
    }

    async kickGroupMember(groupId: string, userId: string) {
        return this.kickMock(groupId, userId);
    }

    async recallMessage(messageId: string) {
        return this.recallMock(messageId);
    }

    async updateMessage(messageId: string, content: import("./message.js").Message.Content) {
        return this.updateMock(messageId, String(content));
    }
}

describe("ImHelper entity projection", () => {
    test("binds adapter DTOs to one stable, behavior-rich user instance", async () => {
        const adapter = new EntityAdapter();
        const helper = new ImHelper(adapter);

        const [first] = await helper.getUserList();
        adapter.userName = "更新名称";
        const [second] = await helper.getUserList({ fresh: true });

        expect(first).toBeInstanceOf(User);
        expect(second).toBe(first);
        expect(first.user_name).toBe("更新名称");
        await first.sendMessage("你好");
        expect(adapter.sendMessageMock).toHaveBeenCalledWith({
            scene_type: "private",
            scene_id: "user-1",
            message: "你好",
        });
    });

    test("projects group member lists to bound GroupMember instances", async () => {
        const adapter = new EntityAdapter();
        const helper = new ImHelper(adapter);
        const [group] = await helper.getGroupList();

        const [member] = await group.refreshMembers();

        expect(member).toBeInstanceOf(GroupMember);
        expect(member.role).toBe("admin");
        await member.kick();
        expect(adapter.kickMock).toHaveBeenCalledWith("group-1", "user-1");
    });

    test("binds message DTOs so behavior methods remain available", async () => {
        const adapter = new EntityAdapter();
        const helper = new ImHelper(adapter);

        const message = await helper.getMessage("message-1");
        await message.reply("world");
        await message.edit("updated");
        await message.recall();

        expect(message.message_id).toBe("message-1");
        expect(adapter.sendMessageMock).toHaveBeenCalledWith({
            scene_type: "private",
            scene_id: "user-1",
            message: "world",
        });
        expect(adapter.updateMock).toHaveBeenCalledWith("message-1", "updated");
        expect(adapter.recallMock).toHaveBeenCalledWith("message-1");
    });
});
