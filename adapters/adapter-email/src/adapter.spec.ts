import { describe, expect, it } from "vitest";
import { EmailAdapter } from "./adapter.js";

describe("EmailAdapter 账号身份", () => {
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
