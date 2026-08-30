import type { Client } from "@icqqjs/icqq";
import { describe, expect, it, vi } from "vitest";
import { ICQQSocialActions } from "./social-actions.js";

const id = (value: string | number) => ({
    string: String(value),
    source: value,
    number: typeof value === "number" ? value : Number(value) || 0,
});

function createActions(client: Client): ICQQSocialActions {
    const actions = Object.create(ICQQSocialActions.prototype) as ICQQSocialActions;
    Object.defineProperty(actions, "requireNativeClient", { value: () => client });
    return actions;
}

describe("ICQQ 账号资料动作", () => {
    it("好友资料使用好友缓存并保留分组，不降级为陌生人", async () => {
        const bot = {
            getFriendList: vi.fn().mockResolvedValue([
                {
                    user_id: 10001,
                    nickname: "Alice",
                    sex: "female",
                    remark: "A",
                    class_id: 2,
                    class_name: "朋友",
                },
            ]),
            getFriendInfo: vi.fn().mockResolvedValue({
                user_id: 10001,
                nickname: "Alice",
                sex: "female",
                remark: "A",
                class_id: 2,
                class_name: "朋友",
            }),
        };
        const actions = Object.create(ICQQSocialActions.prototype) as ICQQSocialActions;
        Object.defineProperties(actions, {
            getAccount: { value: () => ({ client: bot }) },
            numericId: { value: (value: string) => Number(value) },
            createId: {
                value: (value: string | number) => ({
                    string: String(value),
                    number: Number(value),
                    source: value,
                }),
            },
        });

        await expect(actions.getFriendList("bot", { no_cache: true })).resolves.toEqual([
            expect.objectContaining({
                sex: "female",
                remark: "A",
                category_id: 2,
                category_name: "朋友",
            }),
        ]);
        await expect(
            actions.getFriendInfo("bot", {
                user_id: { string: "10001", number: 10001, source: 10001 },
                no_cache: true,
            }),
        ).resolves.toEqual(expect.objectContaining({ category_id: 2, category_name: "朋友" }));
        expect(bot.getFriendList).toHaveBeenCalledWith(true);
        expect(bot.getFriendInfo).toHaveBeenCalledWith(10001, true);
    });

    it("以真实 QQ UID 列出并处理好友请求", async () => {
        const request = {
            request_type: "friend",
            sub_type: "add",
            flag: "opaque-flag",
            user_id: 10001,
            nickname: "Alice",
            comment: "申请好友",
            source: "search",
            time: 100,
        };
        const client = {
            uin: 99999,
            getSystemMsg: vi.fn().mockResolvedValue([request]),
            uin2uids: vi.fn().mockResolvedValue(["u_requester"]),
            uin2uid: vi.fn().mockResolvedValue("u_bot"),
        } as unknown as Client;
        const handleFriendRequest = vi.fn().mockResolvedValue(true);
        const actions = createActions(client);
        Object.defineProperties(actions, {
            getAccount: { value: () => ({ client: { handleFriendRequest } }) },
            createId: {
                value: (value: string | number) => ({
                    string: String(value),
                    number: typeof value === "number" ? value : 701,
                    source: value,
                }),
            },
        });

        await expect(actions.getFriendRequests("bot", { limit: 20 })).resolves.toEqual([
            expect.objectContaining({
                initiator_uid: "u_requester",
                target_user_uid: "u_bot",
                state: "pending",
                via: "search",
                is_filtered: false,
            }),
        ]);
        await actions.handleFriendRequest("bot", {
            initiator_uid: "u_requester",
            is_filtered: false,
            approve: false,
            block: true,
        });
        expect(handleFriendRequest).toHaveBeenCalledWith("opaque-flag", false, undefined, true);

        await expect(
            actions.handleFriendRequest("bot", {
                flag: "opaque-flag",
                approve: true,
                block: true,
            }),
        ).rejects.toMatchObject({ code: "ICQQ_INVALID_PARAM" });
    });

    it("删除好友时透传 ICQQ 原生黑名单语义", async () => {
        const deleteFriend = vi.fn().mockResolvedValue(true);
        const actions = createActions({ deleteFriend } as unknown as Client);
        Object.defineProperty(actions, "numericId", {
            value: (value: string) => Number(value),
        });

        await actions.deleteFriend("bot", { user_id: id(10001), block: true });

        expect(deleteFriend).toHaveBeenCalledWith(10001, true);
    });

    it("设置昵称与个性签名时校验原生结果", async () => {
        const client = {
            setNickname: vi.fn().mockResolvedValue(true),
            setSignature: vi.fn().mockResolvedValue(true),
        } as unknown as Client;
        const actions = createActions(client);

        await actions.setNickname("bot", { nickname: "OneBots" });
        await actions.setBio("bot", { bio: "统一 IM 网关" });

        expect(client.setNickname).toHaveBeenCalledWith("OneBots");
        expect(client.setSignature).toHaveBeenCalledWith("统一 IM 网关");
    });

    it("返回 ICQQ 漫游表情 URL", async () => {
        const client = {
            getRoamingStamp: vi.fn().mockResolvedValue(["https://example.com/face.png"]),
        } as unknown as Client;

        await expect(createActions(client).getCustomFaceUrlList("bot")).resolves.toEqual([
            "https://example.com/face.png",
        ]);
    });

    it("物化标准媒体 URI 后设置头像", async () => {
        const setAvatar = vi.fn().mockResolvedValue(undefined);
        const actions = createActions({ setAvatar } as unknown as Client);

        await actions.setAvatar("bot", { source: "base64://aGVsbG8=" });

        expect(setAvatar).toHaveBeenCalledOnce();
        expect(setAvatar.mock.calls[0]?.[0]).toEqual(Buffer.from("hello"));
    });
});

describe("ICQQ 消息资源与历史游标", () => {
    it("频道发送使用独立 guild/channel，并可由结构化消息 ID 撤回", async () => {
        const recallMsg = vi.fn().mockResolvedValue(true);
        const sendGuildMsg = vi.fn().mockResolvedValue({ seq: 12, rand: 34, time: 56 });
        const client = {
            sendGuildMsg,
            pickGuild: vi.fn(() => ({ channels: new Map([["channel", { recallMsg }]]) })),
        } as unknown as Client;
        const actions = createActions(client);
        Object.defineProperties(actions, {
            coerceId: { value: (value: unknown) => value },
            createId: { value: (value: string) => id(value) },
        });

        const sent = await actions.sendMessage("bot", {
            scene_type: "channel",
            scene_id: id("channel"),
            guild_id: id("guild"),
            message: [{ type: "text", data: { text: "hello" } }],
        });
        await actions.deleteMessage("bot", { message_id: sent.message_id });

        expect(sendGuildMsg).toHaveBeenCalledWith("guild", "channel", ["hello"]);
        expect(recallMsg).toHaveBeenCalledWith(12);
    });

    it("频道发送不再接受复合 scene_id 代替 guild_id", async () => {
        const actions = createActions({} as Client);
        Object.defineProperty(actions, "coerceId", { value: (value: unknown) => value });

        await expect(
            actions.sendMessage("bot", {
                scene_type: "channel",
                scene_id: id("guild:channel"),
                message: [{ type: "text", data: { text: "hello" } }],
            }),
        ).rejects.toThrow("需要显式 guild_id");
    });

    it("拒绝损坏的保留频道消息 ID，不降级调用普通撤回", async () => {
        const recallMessage = vi.fn();
        const actions = Object.create(ICQQSocialActions.prototype) as ICQQSocialActions;
        Object.defineProperties(actions, {
            getAccount: { value: () => ({ client: { recallMessage } }) },
            coerceId: { value: (value: unknown) => value },
        });

        await expect(
            actions.deleteMessage("bot", { message_id: id("icqq-guild.broken") }),
        ).rejects.toThrow("无效的 ICQQ 频道 message_id");
        expect(recallMessage).not.toHaveBeenCalled();
    });

    it("原生撤回拒绝和空消息 ID 不会被伪装成成功", async () => {
        const bot = {
            recallMessage: vi.fn().mockResolvedValue(false),
            sendPrivateMessage: vi.fn().mockResolvedValue({ message_id: "" }),
        };
        const actions = Object.create(ICQQSocialActions.prototype) as ICQQSocialActions;
        Object.defineProperties(actions, {
            getAccount: { value: () => ({ client: bot }) },
            coerceId: { value: (value: unknown) => value },
            numericId: { value: (value: string) => Number(value) },
        });

        await expect(
            actions.deleteMessage("bot", { message_id: { string: "m1", number: 1, source: "m1" } }),
        ).rejects.toMatchObject({ code: "ICQQ_OPERATION_REJECTED", operation: "撤回消息" });
        await expect(
            actions.sendMessage("bot", {
                scene_type: "private",
                scene_id: { string: "10001", number: 10001, source: 10001 },
                message: [{ type: "text", data: { text: "hello" } }],
            }),
        ).rejects.toMatchObject({ code: "ICQQ_INVALID_RESPONSE", operation: "sendMessage" });
    });

    it("从投影过的媒体消息解析临时链接", async () => {
        const bot = {
            getMessage: vi.fn().mockResolvedValue({
                message_id: "message-id",
                time: 100,
                user_id: 10001,
                nickname: "Alice",
                message: [
                    {
                        type: "image",
                        file: "resource-id",
                        url: "https://example.com/image.jpg",
                    },
                ],
            }),
        };
        const actions = Object.create(ICQQSocialActions.prototype) as ICQQSocialActions;
        Object.defineProperties(actions, {
            getAccount: { value: () => ({ client: bot }) },
            createId: {
                value: (value: string | number) => ({
                    string: String(value),
                    number: typeof value === "number" ? value : 9001,
                    source: value,
                }),
            },
            coerceId: {
                value: (value: { string: string }) => value,
            },
        });

        await actions.getMessage("bot", {
            message_id: { string: "message-id", number: 9001, source: "message-id" },
        });

        await expect(
            actions.getResourceTempUrl("bot", { resource_id: "resource-id" }),
        ).resolves.toBe("https://example.com/image.jpg");
        await expect(
            actions.getResourceTempUrl("bot", { resource_id: "unknown" }),
        ).rejects.toMatchObject({ code: "ICQQ_RESOURCE_NOT_FOUND" });
    });

    it("按排他性 start_message_id 向历史方向分页", async () => {
        const startMessage = {
            message_id: "start-message",
            time: 101,
            user_id: 10001,
            nickname: "Alice",
            message: [{ type: "text", text: "start" }],
        };
        const olderMessage = {
            ...startMessage,
            message_id: "older-message",
            time: 100,
            message: [{ type: "text", text: "older" }],
        };
        const client = {
            getChatHistory: vi.fn().mockResolvedValue([olderMessage, startMessage]),
        } as unknown as Client;
        const actions = createActions(client);
        Object.defineProperties(actions, {
            numericId: { value: (value: string) => Number(value) },
            createId: {
                value: (value: string | number) => ({
                    string: String(value),
                    number: value === "older-message" ? 9000 : 9001,
                    source: value,
                }),
            },
        });

        await expect(
            actions.getMessageHistory("bot", {
                scene_type: "private",
                scene_id: { string: "10001", number: 10001, source: 10001 },
                limit: 1,
                start_message_id: {
                    string: "start-message",
                    number: 9001,
                    source: "start-message",
                },
            }),
        ).resolves.toEqual([
            expect.objectContaining({ message_id: expect.objectContaining({ number: 9000 }) }),
        ]);
        expect(client.getChatHistory).toHaveBeenCalledWith("start-message", 2);
    });
});
