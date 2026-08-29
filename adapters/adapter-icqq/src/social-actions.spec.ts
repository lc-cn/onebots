import type { Client } from "@icqqjs/icqq";
import { describe, expect, it, vi } from "vitest";
import { ICQQSocialActions } from "./social-actions.js";

function createActions(client: Client): ICQQSocialActions {
    const actions = Object.create(ICQQSocialActions.prototype) as ICQQSocialActions;
    Object.defineProperty(actions, "requireNativeClient", { value: () => client });
    return actions;
}

describe("ICQQ 账号资料动作", () => {
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
            approve: true,
        });
        expect(handleFriendRequest).toHaveBeenCalledWith("opaque-flag", true, undefined);
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
