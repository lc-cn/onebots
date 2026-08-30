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

describe("Zulip Linkifier 动作", () => {
    it("覆盖现代 Linkifier 查询、创建、更新、删除和排序", async () => {
        const { client, call } = mockClient();
        const fields = {
            pattern: "#(?P<id>[0-9]+)",
            url_template: "https://example.com/issues/{id}",
            example_input: "#42",
            reverse_template: "#{id}",
            alternative_url_templates: ["https://example.com/pull/{id}"],
        };

        await executeZulipPlatformAction(client, "list_linkifiers", {});
        await executeZulipPlatformAction(client, "create_linkifier", fields);
        await executeZulipPlatformAction(client, "update_linkifier", {
            filter_id: 7,
            ...fields,
        });
        await executeZulipPlatformAction(client, "delete_linkifier", { filter_id: 7 });
        await executeZulipPlatformAction(client, "reorder_linkifiers", {
            ordered_linkifier_ids: [7, 3],
        });

        expect(call).toHaveBeenNthCalledWith(1, "realm/linkifiers");
        expect(call).toHaveBeenNthCalledWith(2, "realm/filters", "POST", fields);
        expect(call).toHaveBeenNthCalledWith(3, "realm/filters/7", "PATCH", fields);
        expect(call).toHaveBeenNthCalledWith(4, "realm/filters/7", "DELETE");
        expect(call).toHaveBeenNthCalledWith(5, "realm/linkifiers", "PATCH", {
            ordered_linkifier_ids: [7, 3],
        });
    });

    it.each([
        ["list_linkifiers", { unexpected: true }],
        ["create_linkifier", { pattern: "#(?P<id>[0-9]+)" }],
        ["update_linkifier", { filter_id: 7, pattern: "x", url_template: "" }],
        ["delete_linkifier", { filter_id: 7, unexpected: true }],
        ["reorder_linkifiers", { ordered_linkifier_ids: [7, "3"] }],
    ])("%s 在请求前拒绝非官方参数", async (action, params) => {
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
