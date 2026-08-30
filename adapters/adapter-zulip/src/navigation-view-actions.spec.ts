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

describe("Zulip Navigation View 动作", () => {
    it("覆盖列表、添加、更新和删除", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });

        await executeZulipPlatformAction(client, "list_navigation_views", {});
        await executeZulipPlatformAction(client, "add_navigation_view", {
            fragment: "narrow/is/alerted",
            is_pinned: true,
            name: "Alert Words",
        });
        await executeZulipPlatformAction(client, "update_navigation_view", {
            fragment: "narrow/is/alerted",
            is_pinned: false,
        });
        await executeZulipPlatformAction(client, "remove_navigation_view", {
            fragment: "narrow/is/alerted",
        });

        expect(call).toHaveBeenNthCalledWith(1, "navigation_views");
        expect(call).toHaveBeenNthCalledWith(2, "navigation_views", "POST", {
            fragment: "narrow/is/alerted",
            is_pinned: true,
            name: "Alert Words",
        });
        expect(call).toHaveBeenNthCalledWith(3, "navigation_views/narrow%2Fis%2Falerted", "PATCH", {
            is_pinned: false,
        });
        expect(call).toHaveBeenNthCalledWith(4, "navigation_views/narrow%2Fis%2Falerted", "DELETE");
    });

    it("添加内置视图覆盖时允许官方 nullable name", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });

        await executeZulipPlatformAction(client, "add_navigation_view", {
            fragment: "recent",
            is_pinned: true,
            name: null,
        });

        expect(call).toHaveBeenCalledWith("navigation_views", "POST", {
            fragment: "recent",
            is_pinned: true,
            name: null,
        });
    });

    it.each([
        ["list_navigation_views", { unexpected: true }],
        ["add_navigation_view", { fragment: "narrow/is/alerted" }],
        ["add_navigation_view", { fragment: "", is_pinned: true }],
        ["add_navigation_view", { fragment: "narrow/is/alerted", is_pinned: "true" }],
        ["update_navigation_view", { fragment: "narrow/is/alerted" }],
        ["update_navigation_view", { fragment: "narrow/is/alerted", name: null }],
        ["remove_navigation_view", { fragment: "" }],
    ])("%s 在请求前拒绝无效参数", async (action, params) => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call");

        await expect(executeZulipPlatformAction(client, action, params)).rejects.toMatchObject({
            code: "ZULIP_INVALID_ACTION_PARAM",
        });
        expect(call).not.toHaveBeenCalled();
    });
});
