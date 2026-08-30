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
const draft = {
    type: "stream",
    to: [7],
    topic: "release",
    content: "Ship it",
    timestamp: 2_000_000_000,
};

describe("Zulip 草稿动作", () => {
    it("查询、批量创建、完整编辑和删除使用官方契约", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });
        await executeZulipPlatformAction(client, "get_drafts", {});
        await executeZulipPlatformAction(client, "create_drafts", { drafts: [draft] });
        await executeZulipPlatformAction(client, "edit_draft", { draft_id: 17, draft });
        await executeZulipPlatformAction(client, "delete_draft", { draft_id: 17 });
        expect(call).toHaveBeenNthCalledWith(1, "drafts");
        expect(call).toHaveBeenNthCalledWith(2, "drafts", "POST", { drafts: [draft] });
        expect(call).toHaveBeenNthCalledWith(3, "drafts/17", "PATCH", { draft });
        expect(call).toHaveBeenNthCalledWith(4, "drafts/17", "DELETE");
    });

    it.each([
        ["create_drafts", { drafts: [] }],
        ["create_drafts", { drafts: [{ ...draft, id: 1 }] }],
        ["create_drafts", { drafts: [{ ...draft, to: [7, 8] }] }],
        ["create_drafts", { drafts: [{ ...draft, type: "private", topic: "release" }] }],
        ["edit_draft", { draft_id: 17, content: "partial" }],
        ["delete_draft", { draft_id: 17, extra: true }],
    ])("%s 拒绝无效参数", async (action, params) => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call");
        await expect(executeZulipPlatformAction(client, action, params)).rejects.toMatchObject({
            code: "ZULIP_INVALID_ACTION_PARAM",
        });
        expect(call).not.toHaveBeenCalled();
    });
});
