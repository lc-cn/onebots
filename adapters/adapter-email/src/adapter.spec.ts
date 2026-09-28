import { describe, expect, it, vi } from "vitest";
import { EmailAdapter } from "./adapter.js";

describe("EmailAdapter 账号身份", () => {
    it("多人邮件发送返回与入站一致的规范化会话身份", async () => {
        const adapter = Object.create(EmailAdapter.prototype) as EmailAdapter;
        Object.defineProperties(adapter, {
            platformSource: { value: () => "Bob@example.com,alice@example.com" },
            requireClient: {
                value: () => ({
                    config: { default_subject: "测试" },
                    sendEmail: vi.fn().mockResolvedValue({ message_id: "mail-1" }),
                }),
            },
            resolveReplyIds: { value: (segments: unknown) => segments },
            createId: { value: (value: string) => ({ string: value, source: value, number: 1 }) },
        });
        await expect(
            adapter.sendMessage("bot", {
                scene_type: "direct",
                scene_id: { string: "Bob@example.com,alice@example.com", source: "", number: 1 },
                message: [{ type: "text", data: { text: "你好" } }],
            }),
        ).resolves.toMatchObject({
            scene: {
                scene_type: "direct",
                scene_id: { string: "alice@example.com,bob@example.com" },
            },
        });
    });

    it("状态使用邮箱地址作为平台机器人身份", async () => {
        const createId = (value: string) => ({ string: value });
        const status = await EmailAdapter.prototype.getStatus.call(
            {
                getAccount: () => ({
                    status: "online",
                    client: {
                        config: { address: "bot@example.com" },
                        status: {
                            started: true,
                            receive_connected: true,
                            receive_mode: "imap",
                        },
                    },
                }),
                createId,
            } as never,
            "local-alias",
        );

        expect(status.bots).toEqual([{ self: { string: "bot@example.com" }, online: true }]);
    });
});
