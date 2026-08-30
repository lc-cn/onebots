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

describe("Zulip Data Export 动作", () => {
    it("覆盖列表、创建、删除和授权状态", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });
        await executeZulipPlatformAction(client, "list_data_exports", {});
        await executeZulipPlatformAction(client, "create_data_export", {
            export_type: "full_with_consent",
        });
        await executeZulipPlatformAction(client, "delete_data_export", { export_id: 7 });
        await executeZulipPlatformAction(client, "get_data_export_consents", {});
        expect(call).toHaveBeenNthCalledWith(1, "export/realm");
        expect(call).toHaveBeenNthCalledWith(2, "export/realm", "POST", {
            export_type: "full_with_consent",
        });
        expect(call).toHaveBeenNthCalledWith(3, "export/realm/7", "DELETE");
        expect(call).toHaveBeenNthCalledWith(4, "export/realm/consents");
    });

    it.each([
        ["list_data_exports", { unexpected: true }],
        ["create_data_export", { export_type: 2 }],
        ["create_data_export", { export_type: "private" }],
        ["delete_data_export", { export_id: 7, unexpected: true }],
        ["get_data_export_consents", { unexpected: true }],
    ])("%s 在请求前拒绝无效参数", async (action, params) => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call");
        await expect(executeZulipPlatformAction(client, action, params)).rejects.toBeInstanceOf(
            Error,
        );
        expect(call).not.toHaveBeenCalled();
    });
});
