import { describe, expect, it, vi } from "vitest";
import { executeSlackPlatformAction, SLACK_PLATFORM_ACTIONS } from "./platform-actions.js";

describe("executeSlackPlatformAction", () => {
    it("将结构化频道动作映射到 Slack Web API", async () => {
        const call = vi.fn().mockResolvedValue({ ok: true });
        await executeSlackPlatformAction({ call } as never, "invite_channel_members", {
            channel: "C1",
            users: "U1,U2",
        });
        expect(call).toHaveBeenCalledWith("conversations.invite", {
            channel: "C1",
            users: "U1,U2",
        });
    });

    it("通用入口拒绝非法方法名", async () => {
        await expect(
            executeSlackPlatformAction({ call: vi.fn() } as never, "call_slack_api", {
                method: "../../auth.revoke",
            }),
        ).rejects.toThrow("合法的 Web API 方法名");
    });

    it.each([
        ["post_ephemeral", "chat.postEphemeral"],
        ["get_message_permalink", "chat.getPermalink"],
        ["open_view", "views.open"],
        ["publish_app_home", "views.publish"],
        ["list_files", "files.list"],
        ["update_user_group_users", "usergroups.users.update"],
        ["start_message_stream", "chat.startStream"],
        ["stop_message_stream", "chat.stopStream"],
        ["validate_blocks", "blocks.validate"],
        ["create_canvas", "canvases.create"],
        ["set_canvas_access", "canvases.access.set"],
        ["create_channel_canvas", "conversations.canvases.create"],
    ])("将 %s 固定映射到 %s", async (action, method) => {
        const call = vi.fn().mockResolvedValue({ ok: true });
        await executeSlackPlatformAction({ call } as never, action, { marker: "value" });
        expect(call).toHaveBeenCalledWith(method, { marker: "value" });
        expect(SLACK_PLATFORM_ACTIONS.has(action)).toBe(true);
    });
});
