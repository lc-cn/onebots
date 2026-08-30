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

describe("Zulip Custom Emoji 动作", () => {
    it("覆盖查询、上传和停用资源", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });
        const upload = vi
            .spyOn(client, "uploadCustomEmoji")
            .mockResolvedValue({ result: "success", msg: "" });

        await executeZulipPlatformAction(client, "get_custom_emoji", {});
        await executeZulipPlatformAction(client, "upload_custom_emoji", {
            emoji_name: "release ready",
            file: "data:image/png;base64,iVBORw0KGgo=",
            filename: "ready.png",
        });
        await executeZulipPlatformAction(client, "deactivate_custom_emoji", {
            emoji_name: "release ready",
        });

        expect(call).toHaveBeenNthCalledWith(1, "realm/emoji");
        expect(upload).toHaveBeenCalledWith(
            "release ready",
            expect.any(Uint8Array),
            "ready.png",
            "image/png",
        );
        expect(call).toHaveBeenNthCalledWith(2, "realm/emoji/release%20ready", "DELETE");
    });

    it.each([
        ["get_custom_emoji", { unexpected: true }],
        ["upload_custom_emoji", { emoji_name: "wave" }],
        ["upload_custom_emoji", { emoji_name: "bad:name", file: "base64://YQ==" }],
        [
            "upload_custom_emoji",
            {
                emoji_name: "wave",
                file: "data:image/webp;base64,YQ==",
                filename: "wave.webp",
            },
        ],
        ["deactivate_custom_emoji", { emoji_name: "wave", unexpected: true }],
    ])("%s 在请求前拒绝无效参数", async (action, params) => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call");
        const upload = vi.spyOn(client, "uploadCustomEmoji");

        await expect(executeZulipPlatformAction(client, action, params)).rejects.toBeInstanceOf(
            Error,
        );
        expect(call).not.toHaveBeenCalled();
        expect(upload).not.toHaveBeenCalled();
    });
});
