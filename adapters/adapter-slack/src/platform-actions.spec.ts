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

    it("所有平台动作均隔离账号 token", async () => {
        const call = vi.fn().mockResolvedValue({ ok: true });
        await executeSlackPlatformAction({ call } as never, "add_reaction", {
            channel: "C1",
            name: "thumbsup",
            timestamp: "1.2",
            token: "must-not-escape",
        });
        await executeSlackPlatformAction({ call } as never, "call_slack_api", {
            method: "auth.test",
            params: { token: "must-not-escape", marker: true },
        });
        expect(call).toHaveBeenNthCalledWith(1, "reactions.add", {
            channel: "C1",
            name: "thumbsup",
            timestamp: "1.2",
        });
        expect(call).toHaveBeenNthCalledWith(2, "auth.test", { marker: true });
    });

    it.each([
        ["post_ephemeral", "chat.postEphemeral"],
        ["get_message_permalink", "chat.getPermalink"],
        ["open_view", "views.open"],
        ["publish_app_home", "views.publish"],
        ["list_files", "files.list"],
        ["update_user_group_users", "usergroups.users.update"],
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
        ["create_call", "calls.add"],
        ["get_call", "calls.info"],
        ["add_call_participants", "calls.participants.add"],
        ["add_remote_file", "files.remote.add"],
        ["list_remote_files", "files.remote.list"],
        ["share_remote_file", "files.remote.share"],
    ])("将 %s 固定映射到 %s", async (action, method) => {
        const call = vi.fn().mockResolvedValue({ ok: true });
        await executeSlackPlatformAction({ call } as never, action, { marker: "value" });
        expect(call).toHaveBeenCalledWith(method, { marker: "value" });
        expect(SLACK_PLATFORM_ACTIONS.has(action)).toBe(true);
    });

    it("完整投影 Slack 任务流参数并隔离 token", async () => {
        const call = vi.fn().mockResolvedValue({ ok: true, ts: "1782234987.693923" });
        const chunks = [
            { type: "plan_update", title: "发布计划" },
            { type: "task_update", id: "test", status: "in_progress", title: "运行测试" },
        ];
        await executeSlackPlatformAction({ call } as never, "start_message_stream", {
            channel: "C1",
            thread_ts: "1782234671.392669",
            recipient_team_id: "T1",
            recipient_user_id: "U1",
            task_display_mode: "plan",
            chunks,
            icon_emoji: ":robot_face:",
            icon_url: "https://example.com/bot.png",
            username: "OneBots",
            token: "must-not-escape",
            ignored: true,
        });
        expect(call).toHaveBeenCalledWith("chat.startStream", {
            channel: "C1",
            thread_ts: "1782234671.392669",
            recipient_team_id: "T1",
            recipient_user_id: "U1",
            task_display_mode: "plan",
            chunks,
            icon_emoji: ":robot_face:",
            icon_url: "https://example.com/bot.png",
            username: "OneBots",
        });
        expect(SLACK_PLATFORM_ACTIONS.has("start_message_stream")).toBe(true);
    });

    it("追加与停止流支持 chunks、Block Kit 和 Agent Session 状态", async () => {
        const call = vi.fn().mockResolvedValue({ ok: true });
        await executeSlackPlatformAction({ call } as never, "append_message_stream", {
            channel: "C1",
            ts: "1782234987.693923",
            chunks: [{ type: "markdown_text", text: "正在处理" }],
        });
        await executeSlackPlatformAction({ call } as never, "stop_message_stream", {
            channel: "C1",
            ts: "1782234987.693923",
            blocks: [{ type: "section", text: { type: "mrkdwn", text: "完成" } }],
            metadata: { event_type: "task_completed", event_payload: { id: "test" } },
            session_status: "active",
        });
        expect(call).toHaveBeenNthCalledWith(1, "chat.appendStream", {
            channel: "C1",
            ts: "1782234987.693923",
            chunks: [{ type: "markdown_text", text: "正在处理" }],
        });
        expect(call).toHaveBeenNthCalledWith(2, "chat.stopStream", {
            channel: "C1",
            ts: "1782234987.693923",
            blocks: [{ type: "section", text: { type: "mrkdwn", text: "完成" } }],
            metadata: { event_type: "task_completed", event_payload: { id: "test" } },
            session_status: "active",
        });
    });

    it("拒绝矛盾或不完整的流式消息内容", async () => {
        const bot = { call: vi.fn() } as never;
        await expect(
            executeSlackPlatformAction(bot, "append_message_stream", {
                channel: "C1",
                ts: "1.2",
            }),
        ).rejects.toMatchObject({ code: "SLACK_STREAM_CONTENT_REQUIRED" });
        await expect(
            executeSlackPlatformAction(bot, "start_message_stream", {
                channel: "C1",
                markdown_text: "text",
                chunks: [{ type: "markdown_text", text: "chunk" }],
            }),
        ).rejects.toMatchObject({ code: "SLACK_STREAM_CONTENT_CONFLICT" });
        await expect(
            executeSlackPlatformAction(bot, "start_message_stream", {
                channel: "C1",
                task_display_mode: "cards",
            }),
        ).rejects.toMatchObject({ code: "SLACK_TASK_DISPLAY_MODE_INVALID" });
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
