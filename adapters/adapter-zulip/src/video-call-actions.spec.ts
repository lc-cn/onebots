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

describe("Zulip 视频会议动作", () => {
    it("覆盖四种官方视频会议集成", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });

        await executeZulipPlatformAction(client, "create_bigbluebutton_call", {
            meeting_name: "Team sync",
            voice_only: true,
        });
        await executeZulipPlatformAction(client, "create_nextcloud_talk_call", {
            room_name: "#engineering > sync",
        });
        await executeZulipPlatformAction(client, "create_webex_call", {});
        await executeZulipPlatformAction(client, "create_constructor_groups_call", {});

        expect(call).toHaveBeenNthCalledWith(1, "calls/bigbluebutton/create", "GET", {
            meeting_name: "Team sync",
            voice_only: true,
        });
        expect(call).toHaveBeenNthCalledWith(2, "calls/nextcloud_talk/create", "POST", {
            room_name: "#engineering > sync",
        });
        expect(call).toHaveBeenNthCalledWith(3, "calls/webex/create", "POST");
        expect(call).toHaveBeenNthCalledWith(4, "calls/constructorgroups/create", "POST");
    });

    it.each([
        ["create_bigbluebutton_call", {}],
        ["create_bigbluebutton_call", { meeting_name: "x", voice_only: 1 }],
        ["create_nextcloud_talk_call", { room_name: "" }],
        ["create_webex_call", { room_name: "x" }],
        ["create_constructor_groups_call", { extra: true }],
    ])("%s 在请求前拒绝无效参数", async (action, params) => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call");

        await expect(executeZulipPlatformAction(client, action, params)).rejects.toMatchObject({
            code: "ZULIP_INVALID_ACTION_PARAM",
        });
        expect(call).not.toHaveBeenCalled();
    });
});
