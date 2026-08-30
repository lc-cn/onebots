import { describe, expect, it, vi } from "vitest";
import { ZulipClient } from "./client.js";
import { executeZulipPlatformAction } from "./platform-actions.js";
import type { ZulipConfig } from "./types.js";

const config: ZulipConfig = {
    account_id: "bot",
    server_url: "https://example.zulipchat.com",
    email: "bot@example.com",
    api_key: "secret",
};

describe("Zulip Bot 动作", () => {
    it("使用官方凭证与 Bot 存储路径", async () => {
        const { client, call } = mockClient();

        await executeZulipPlatformAction(client, "get_bot_api_key", { bot_id: 17 });
        await executeZulipPlatformAction(client, "regenerate_bot_api_key", { bot_id: 17 });
        await executeZulipPlatformAction(client, "get_bot_storage", { keys: ["cursor"] });
        await executeZulipPlatformAction(client, "update_bot_storage", {
            storage: { cursor: "42", generation: "3" },
        });
        await executeZulipPlatformAction(client, "remove_bot_storage", {});

        expect(call).toHaveBeenNthCalledWith(1, "bots/17/api_key", "GET");
        expect(call).toHaveBeenNthCalledWith(2, "bots/17/api_key/regenerate", "POST");
        expect(call).toHaveBeenNthCalledWith(3, "bot_storage", "GET", { keys: ["cursor"] });
        expect(call).toHaveBeenNthCalledWith(4, "bot_storage", "PUT", {
            storage: { cursor: "42", generation: "3" },
        });
        expect(call).toHaveBeenNthCalledWith(5, "bot_storage", "DELETE", {});
    });

    it.each([
        ["get_bot_api_key", { bot_id: 17, unexpected: true }],
        ["get_bot_storage", { keys: ["cursor", 3] }],
        ["update_bot_storage", {}],
        ["update_bot_storage", { storage: { cursor: 42 } }],
        ["remove_bot_storage", { unknown: true }],
    ])("%s 在请求前拒绝非官方参数", async (action, params) => {
        const { client, call } = mockClient();

        await expect(executeZulipPlatformAction(client, action, params)).rejects.toMatchObject({
            code: "ZULIP_INVALID_ACTION_PARAM",
        });
        expect(call).not.toHaveBeenCalled();
    });
});

function mockClient(): { client: ZulipClient; call: ReturnType<typeof vi.spyOn> } {
    const client = new ZulipClient(config, { transport: async () => ({}) });
    const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });
    return { client, call };
}
