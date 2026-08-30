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
        ["create_list", "slackLists.create"],
        ["set_list_access", "slackLists.access.set"],
        ["start_list_download", "slackLists.download.start"],
        ["create_list_item", "slackLists.items.create"],
        ["delete_list_items", "slackLists.items.deleteMultiple"],
        ["get_list_items", "slackLists.items.list"],
    ])("将 %s 固定映射到 %s", async (action, method) => {
        const call = vi.fn().mockResolvedValue({ ok: true });
        await executeSlackPlatformAction({ call } as never, action, { marker: "value" });
        expect(call).toHaveBeenCalledWith(method, { marker: "value" });
        expect(SLACK_PLATFORM_ACTIONS.has(action)).toBe(true);
    });

    it("按 Agent Sessions 新标准校验状态和标题", async () => {
        const call = vi.fn().mockResolvedValue({ ok: true });
        await executeSlackPlatformAction({ call } as never, "set_agent_session_status", {
            channel_id: "C1",
            thread_ts: "1782234671.392669",
            status: "processing",
            title: "Research",
        });
        expect(call).toHaveBeenCalledWith("agents.sessions.setStatus", {
            channel_id: "C1",
            thread_ts: "1782234671.392669",
            status: "processing",
            title: "Research",
        });
        await executeSlackPlatformAction({ call } as never, "rename_agent_session", {
            channel_id: "C1",
            thread_ts: "1782234671.392669",
            title: "Renamed",
        });
        expect(call).toHaveBeenLastCalledWith("agents.sessions.rename", {
            channel_id: "C1",
            thread_ts: "1782234671.392669",
            title: "Renamed",
        });
        await expect(
            executeSlackPlatformAction({ call } as never, "set_agent_session_status", {
                channel_id: "C1",
                status: "thinking",
            }),
        ).rejects.toMatchObject({ code: "SLACK_AGENT_STATUS_INVALID" });
    });
});
