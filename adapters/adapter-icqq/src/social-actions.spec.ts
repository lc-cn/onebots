import type { Client } from "@icqqjs/icqq";
import { describe, expect, it, vi } from "vitest";
import { ICQQSocialActions } from "./social-actions.js";

function createActions(client: Client): ICQQSocialActions {
    const actions = Object.create(ICQQSocialActions.prototype) as ICQQSocialActions;
    Object.defineProperty(actions, "requireNativeClient", { value: () => client });
    return actions;
}

describe("ICQQ 账号资料动作", () => {
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
