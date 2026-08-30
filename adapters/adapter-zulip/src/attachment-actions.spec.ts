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

describe("Zulip 附件动作", () => {
    it("覆盖列表、删除、临时 URL 和缩略图状态", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });

        await executeZulipPlatformAction(client, "get_attachments", {});
        await executeZulipPlatformAction(client, "remove_attachment", { attachment_id: 17 });
        await executeZulipPlatformAction(client, "get_attachment_temporary_url", {
            realm_id_str: 2,
            filename: "ce/folder (name)/zulip.txt",
        });
        await executeZulipPlatformAction(client, "check_attachment_thumbnail", {
            realm_id_str: "2",
            filename: "ce/file.png",
        });

        expect(call).toHaveBeenNthCalledWith(1, "attachments");
        expect(call).toHaveBeenNthCalledWith(2, "attachments/17", "DELETE");
        expect(call).toHaveBeenNthCalledWith(
            3,
            "user_uploads/2/ce/folder%20%28name%29/zulip.txt",
        );
        expect(call).toHaveBeenNthCalledWith(4, "thumbnail/status/2/ce/file.png");
    });

    it.each([
        ["get_attachments", { unexpected: true }],
        ["remove_attachment", { attachment_id: -1 }],
        ["get_attachment_temporary_url", { realm_id_str: 2, filename: "../secret" }],
        ["get_attachment_temporary_url", { realm_id_str: 2, filename: "folder//file" }],
        ["check_attachment_thumbnail", { realm_id_str: 2 }],
    ])("%s 在请求前拒绝无效参数", async (action, params) => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call");

        await expect(executeZulipPlatformAction(client, action, params)).rejects.toMatchObject({
            code: "ZULIP_INVALID_ACTION_PARAM",
        });
        expect(call).not.toHaveBeenCalled();
    });
});
