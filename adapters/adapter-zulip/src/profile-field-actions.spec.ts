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

describe("Zulip Custom Profile Field 动作", () => {
    it("覆盖字段查询、创建、更新、删除和排序", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });

        await executeZulipPlatformAction(client, "list_profile_fields", {});
        await executeZulipPlatformAction(client, "create_profile_field", {
            field_type: 3,
            name: "Language",
            field_data: { python: { text: "Python", order: "1" } },
            required: true,
        });
        await executeZulipPlatformAction(client, "update_profile_field", {
            field_id: 9,
            hint: "Favorite language",
            editable_by_user: true,
        });
        await executeZulipPlatformAction(client, "delete_profile_field", { field_id: 9 });
        await executeZulipPlatformAction(client, "reorder_profile_fields", { order: [9, 3] });

        expect(call).toHaveBeenNthCalledWith(1, "realm/profile_fields");
        expect(call).toHaveBeenNthCalledWith(2, "realm/profile_fields", "POST", {
            field_type: 3,
            name: "Language",
            field_data: { python: { text: "Python", order: "1" } },
            required: true,
        });
        expect(call).toHaveBeenNthCalledWith(3, "realm/profile_fields/9", "PATCH", {
            hint: "Favorite language",
            editable_by_user: true,
        });
        expect(call).toHaveBeenNthCalledWith(4, "realm/profile_fields/9", "DELETE");
        expect(call).toHaveBeenNthCalledWith(5, "realm/profile_fields", "PATCH", {
            order: [9, 3],
        });
    });

    it.each([
        ["list_profile_fields", { unexpected: true }],
        ["create_profile_field", { field_type: 9 }],
        ["create_profile_field", { field_type: 6, display_in_profile_summary: true }],
        ["create_profile_field", { field_type: 4, field_data: {} }],
        ["create_profile_field", { field_type: 3, use_for_user_matching: true }],
        ["update_profile_field", { field_id: 9 }],
        ["delete_profile_field", { field_id: 9, unexpected: true }],
        ["reorder_profile_fields", { order: [9, "3"] }],
    ])("%s 在请求前拒绝非官方参数", async (action, params) => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call");

        await expect(executeZulipPlatformAction(client, action, params)).rejects.toMatchObject({
            code: "ZULIP_INVALID_ACTION_PARAM",
        });
        expect(call).not.toHaveBeenCalled();
    });
});
