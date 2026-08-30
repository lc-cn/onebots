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

describe("Zulip 保存片段动作", () => {
    it("查询、创建、编辑和删除使用官方资源契约", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });

        await executeZulipPlatformAction(client, "get_saved_snippets", {});
        await executeZulipPlatformAction(client, "create_saved_snippet", {
            title: "Welcome",
            content: "Hello **team**",
        });
        await executeZulipPlatformAction(client, "edit_saved_snippet", {
            saved_snippet_id: 17,
            content: "Hello **everyone**",
        });
        await executeZulipPlatformAction(client, "delete_saved_snippet", {
            saved_snippet_id: 17,
        });

        expect(call).toHaveBeenNthCalledWith(1, "saved_snippets");
        expect(call).toHaveBeenNthCalledWith(2, "saved_snippets", "POST", {
            title: "Welcome",
            content: "Hello **team**",
        });
        expect(call).toHaveBeenNthCalledWith(3, "saved_snippets/17", "PATCH", {
            content: "Hello **everyone**",
        });
        expect(call).toHaveBeenNthCalledWith(4, "saved_snippets/17", "DELETE");
    });

    it.each([
        ["create_saved_snippet", { title: "Welcome" }],
        ["create_saved_snippet", { title: "", content: "body" }],
        ["create_saved_snippet", { title: "Welcome", content: "body", extra: true }],
        ["edit_saved_snippet", { saved_snippet_id: 17 }],
        ["edit_saved_snippet", { saved_snippet_id: 17, content: "" }],
        ["delete_saved_snippet", { saved_snippet_id: 17, title: "x" }],
    ])("%s 在请求前拒绝无效参数", async (action, params) => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call");

        await expect(executeZulipPlatformAction(client, action, params)).rejects.toMatchObject({
            code: "ZULIP_INVALID_ACTION_PARAM",
        });
        expect(call).not.toHaveBeenCalled();
    });
});
