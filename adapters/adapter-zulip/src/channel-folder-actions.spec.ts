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

describe("Zulip Channel Folder 动作", () => {
    it("覆盖列表、创建、排序、更新和归档", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });

        await executeZulipPlatformAction(client, "list_channel_folders", {
            include_archived: true,
        });
        await executeZulipPlatformAction(client, "create_channel_folder", {
            name: "Backend",
            description: "Backend channels",
        });
        await executeZulipPlatformAction(client, "reorder_channel_folders", { order: [2, 1] });
        await executeZulipPlatformAction(client, "update_channel_folder", {
            channel_folder_id: 2,
            name: "Platform",
            description: "",
            is_archived: true,
        });

        expect(call).toHaveBeenNthCalledWith(1, "channel_folders", "GET", {
            include_archived: true,
        });
        expect(call).toHaveBeenNthCalledWith(2, "channel_folders/create", "POST", {
            name: "Backend",
            description: "Backend channels",
        });
        expect(call).toHaveBeenNthCalledWith(3, "channel_folders", "PATCH", { order: [2, 1] });
        expect(call).toHaveBeenNthCalledWith(4, "channel_folders/2", "PATCH", {
            name: "Platform",
            description: "",
            is_archived: true,
        });
    });

    it.each([
        ["list_channel_folders", { include_archived: "true" }],
        ["create_channel_folder", { name: "" }],
        ["create_channel_folder", { name: "Backend", description: 1 }],
        ["reorder_channel_folders", { order: [1, 1] }],
        ["reorder_channel_folders", { order: [1, "2"] }],
        ["update_channel_folder", { channel_folder_id: 2 }],
        ["update_channel_folder", { channel_folder_id: 2, is_archived: "true" }],
    ])("%s 在请求前拒绝无效参数", async (action, params) => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call");

        await expect(executeZulipPlatformAction(client, action, params)).rejects.toMatchObject({
            code: "ZULIP_INVALID_ACTION_PARAM",
        });
        expect(call).not.toHaveBeenCalled();
    });
});
