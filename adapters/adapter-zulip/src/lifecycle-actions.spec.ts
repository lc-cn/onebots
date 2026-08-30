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

describe("Zulip 破坏性生命周期动作", () => {
    it("严格映射本人和组织停用端点", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });

        await executeZulipPlatformAction(client, "regenerate_own_api_key", {});
        await executeZulipPlatformAction(client, "deactivate_own_account", {});
        await executeZulipPlatformAction(client, "deactivate_organization", {
            deletion_delay_days: null,
        });
        await executeZulipPlatformAction(client, "deactivate_organization", {
            deletion_delay_days: 30,
        });

        expect(call).toHaveBeenNthCalledWith(1, "users/me/api_key/regenerate", "POST");
        expect(call).toHaveBeenNthCalledWith(2, "users/me", "DELETE");
        expect(call).toHaveBeenNthCalledWith(3, "realm/deactivate", "POST", {
            deletion_delay_days: null,
        });
        expect(call).toHaveBeenNthCalledWith(4, "realm/deactivate", "POST", {
            deletion_delay_days: 30,
        });
    });

    it.each([
        ["regenerate_own_api_key", { current: true }],
        ["deactivate_own_account", { confirm: true }],
        ["deactivate_organization", { deletion_delay_days: -1 }],
        ["deactivate_organization", { deletion_delay_days: "tomorrow" }],
        ["deactivate_organization", { extra: true }],
    ])("%s 在请求前拒绝无效参数", async (action, params) => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call");

        await expect(executeZulipPlatformAction(client, action, params)).rejects.toMatchObject({
            code: "ZULIP_INVALID_ACTION_PARAM",
        });
        expect(call).not.toHaveBeenCalled();
    });
});
