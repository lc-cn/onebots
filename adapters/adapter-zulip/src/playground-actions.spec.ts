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

describe("Zulip Code Playground 动作", () => {
    it("按现代 URL Template 新增并按 ID 删除", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });

        await executeZulipPlatformAction(client, "add_code_playground", {
            name: "Rust Playground",
            pygments_language: "Rust",
            url_template: "https://play.rust-lang.org/?code={code}",
        });
        await executeZulipPlatformAction(client, "remove_code_playground", {
            playground_id: 3,
        });

        expect(call).toHaveBeenNthCalledWith(1, "realm/playgrounds", "POST", {
            name: "Rust Playground",
            pygments_language: "Rust",
            url_template: "https://play.rust-lang.org/?code={code}",
        });
        expect(call).toHaveBeenNthCalledWith(2, "realm/playgrounds/3", "DELETE");
    });

    it.each([
        ["add_code_playground", { name: "Rust", pygments_language: "Rust" }],
        [
            "add_code_playground",
            { name: "Rust", pygments_language: "Rust", url_template: "https://x/{code}/{code}" },
        ],
        [
            "add_code_playground",
            { name: "Rust", pygments_language: "Rust", url_template: "file:///tmp/{code}" },
        ],
        ["remove_code_playground", { playground_id: 3, unexpected: true }],
    ])("%s 在请求前拒绝无效参数", async (action, params) => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call");
        await expect(executeZulipPlatformAction(client, action, params)).rejects.toMatchObject({
            code: "ZULIP_INVALID_ACTION_PARAM",
        });
        expect(call).not.toHaveBeenCalled();
    });
});
