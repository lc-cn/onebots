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

describe("Zulip 组织成员动作", () => {
    it("使用官方路径创建、更新、停用和恢复用户", async () => {
        const { client, call } = mockClient();

        await executeZulipPlatformAction(client, "create_user", {
            email: "alice@example.com",
            password: "temporary-secret",
            full_name: "Alice",
        });
        await executeZulipPlatformAction(client, "update_user", {
            user_id: 12,
            role: 300,
            profile_data: [
                { id: 4, value: "maintainer" },
                { id: 5, value: [13, 14] },
                { id: 6, value: null },
            ],
        });
        await executeZulipPlatformAction(client, "deactivate_user", {
            user_id: 12,
            actions: {
                delete_profile: true,
                delete_direct_messages: false,
            },
            deactivation_notification_comment: "账号已停用",
        });
        await executeZulipPlatformAction(client, "reactivate_user", { user_id: 12 });

        expect(call).toHaveBeenNthCalledWith(1, "users", "POST", {
            email: "alice@example.com",
            password: "temporary-secret",
            full_name: "Alice",
        });
        expect(call).toHaveBeenNthCalledWith(2, "users/12", "PATCH", {
            role: 300,
            profile_data: [
                { id: 4, value: "maintainer" },
                { id: 5, value: [13, 14] },
                { id: 6, value: null },
            ],
        });
        expect(call).toHaveBeenNthCalledWith(3, "users/12", "DELETE", {
            actions: { delete_profile: true, delete_direct_messages: false },
            deactivation_notification_comment: "账号已停用",
        });
        expect(call).toHaveBeenNthCalledWith(4, "users/12/reactivate", "POST");
    });

    it.each([
        ["create_user", { email: "alice@example.com", password: "secret" }],
        ["update_user", { user_id: 12 }],
        ["update_user", { user_id: 12, role: 500 }],
        ["update_user", { user_id: 12, profile_data: [{ id: 4 }] }],
        ["deactivate_user", { user_id: 12, actions: {} }],
        ["reactivate_user", { user_id: 12, unexpected: true }],
    ])("%s 拒绝不完整或非官方参数结构", async (action, params) => {
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
