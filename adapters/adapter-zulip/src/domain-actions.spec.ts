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

describe("Zulip Allowed Domain 动作", () => {
    it("覆盖查询、新增、更新和删除", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });
        await executeZulipPlatformAction(client, "list_allowed_domains", {});
        await executeZulipPlatformAction(client, "add_allowed_domain", {
            domain: "Example.COM",
            allow_subdomains: false,
        });
        await executeZulipPlatformAction(client, "update_allowed_domain", {
            domain: "example.com",
            allow_subdomains: true,
        });
        await executeZulipPlatformAction(client, "remove_allowed_domain", {
            domain: "example.com",
        });
        expect(call).toHaveBeenNthCalledWith(1, "realm/domains");
        expect(call).toHaveBeenNthCalledWith(2, "realm/domains", "POST", {
            domain: "example.com",
            allow_subdomains: false,
        });
        expect(call).toHaveBeenNthCalledWith(3, "realm/domains/example.com", "PATCH", {
            allow_subdomains: true,
        });
        expect(call).toHaveBeenNthCalledWith(4, "realm/domains/example.com", "DELETE");
    });

    it.each([
        ["list_allowed_domains", { unexpected: true }],
        ["add_allowed_domain", { domain: "example.com" }],
        ["update_allowed_domain", { domain: "https://example.com", allow_subdomains: true }],
        ["remove_allowed_domain", { domain: "user@example.com" }],
    ])("%s 在请求前拒绝无效参数", async (action, params) => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call");
        await expect(executeZulipPlatformAction(client, action, params)).rejects.toBeInstanceOf(
            Error,
        );
        expect(call).not.toHaveBeenCalled();
    });
});
