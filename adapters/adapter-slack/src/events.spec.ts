import { describe, expect, it } from "vitest";
import { projectSlackEvent } from "./events.js";
import type { SlackEvent, SlackWebhookBody } from "./types.js";

const context = {
    botId: { string: "B1" } as never,
    createId: (value: string | number) => ({ string: String(value) }) as never,
};

describe("projectSlackEvent", () => {
    it("投影线程、文件并保留完整 Events API envelope", () => {
        const event = {
            type: "message",
            event_ts: "1710000000.000001",
            ts: "1710000000.000001",
            thread_ts: "1709999999.000001",
            channel: "C1",
            user: "U1",
            text: "hello",
            files: [
                {
                    id: "F1",
                    name: "voice.ogg",
                    url_private: "https://files/1",
                    mimetype: "audio/ogg",
                },
            ],
        } satisfies SlackEvent;
        const envelope: SlackWebhookBody = {
            type: "event_callback",
            event_id: "Ev1",
            team_id: "T1",
            event,
        };

        const projected = projectSlackEvent(event, envelope, context);

        expect(projected).toMatchObject({
            type: "message",
            message_type: "channel",
            group: {
                guild_id: { string: "T1" },
                channel_id: { string: "C1" },
            },
            raw_event: envelope,
            message: [
                { type: "reply", data: { message_id: "1709999999.000001" } },
                { type: "text", data: { text: "hello" } },
                { type: "audio", data: { file: "F1", url: "https://files/1" } },
            ],
        });
    });

    it("按 channel_type 区分单人私信与多人私信", () => {
        const mpim: SlackEvent = {
            type: "message",
            event_ts: "1710000000.000002",
            ts: "1710000000.000002",
            channel: "G1",
            channel_type: "mpim",
            user: "U1",
            text: "hello team",
        };
        expect(projectSlackEvent(mpim, { event: mpim }, context)).toMatchObject({
            message_type: "direct",
            group: { channel_id: { string: "G1" } },
        });

        const im = { ...mpim, channel: "D1", channel_type: "im" } satisfies SlackEvent;
        expect(projectSlackEvent(im, { event: im }, context)).toMatchObject({
            message_type: "private",
            group: undefined,
        });
    });

    it("在消息上保留 Slack Agent 当前活跃上下文", () => {
        const event: SlackEvent = {
            type: "message",
            event_ts: "1782920000.000001",
            ts: "1782920000.000001",
            channel: "D1",
            channel_type: "im",
            user: "U1",
            text: "总结当前内容",
            app_context: {
                entities: [
                    {
                        type: "slack#/types/list_id",
                        value: "F123",
                        team_id: "T1",
                    },
                ],
            },
        };

        expect(projectSlackEvent(event, { team_id: "T1", event }, context)).toMatchObject({
            type: "message",
            extensions: {
                slack: {
                    app_context: {
                        entities: [{ type: "slack#/types/list_id", value: "F123" }],
                    },
                },
            },
        });
    });

    it("结构化投影 active context 与 App Home 入口", () => {
        const changed: SlackEvent = {
            type: "app_context_changed",
            event_ts: "1782920001.000001",
            user: "U1",
            channel: "D1",
            context: {
                entities: [
                    {
                        type: "slack#/types/message_context",
                        value: { channel_id: "C1", message_ts: "1782919931.619439" },
                    },
                ],
            },
        };
        expect(
            projectSlackEvent(changed, { team_id: "T1", event: changed }, context),
        ).toMatchObject({
            notice_type: "custom",
            user: { id: { string: "U1" } },
            group: { channel_id: { string: "D1" } },
            extensions: {
                slack: {
                    event_type: "app_context_changed",
                    context: {
                        entities: [
                            {
                                type: "slack#/types/message_context",
                                value: { channel_id: "C1" },
                            },
                        ],
                    },
                },
            },
        });

        const opened: SlackEvent = {
            type: "app_home_opened",
            event_ts: "1782920002.000001",
            user: "U1",
            channel: "D1",
            tab: "messages",
            context: { entities: [{ type: "slack#/types/canvas_id", value: "F456" }] },
        };
        expect(projectSlackEvent(opened, { event: opened }, context)).toMatchObject({
            extensions: {
                slack: {
                    event_type: "app_home_opened",
                    tab: "messages",
                    context: { entities: [{ type: "slack#/types/canvas_id", value: "F456" }] },
                },
            },
        });
    });

    it("没有原生 ID 时仍生成稳定摘要身份", () => {
        const event: SlackEvent = {
            type: "app_rate_limited",
            event_ts: "1710000000",
        };
        const first = projectSlackEvent(event, { event }, context);
        const second = projectSlackEvent(event, { event }, context);

        expect(first?.id).toEqual(second?.id);
        expect(first?.id.string).toMatch(/^sha256:/u);
    });

    it("投影消息删除与未知原生事件", () => {
        const deleted: SlackEvent = {
            type: "message",
            subtype: "message_deleted",
            event_ts: "1710000001.000001",
            deleted_ts: "1710000000.000001",
            channel: "C1",
        };
        expect(projectSlackEvent(deleted, { event: deleted }, context)).toMatchObject({
            type: "notice",
            notice_type: "message_deleted",
            message_id: { string: "1710000000.000001" },
        });

        const unknown: SlackEvent = { type: "canvas_updated", event_ts: "1710000002" };
        expect(projectSlackEvent(unknown, { event: unknown }, context)).toMatchObject({
            type: "notice",
            notice_type: "custom",
            extensions: { slack: { event_type: "canvas_updated" } },
        });
    });

    it("消息编辑保留操作者、频道和旧消息上下文", () => {
        const event: SlackEvent = {
            type: "message",
            subtype: "message_changed",
            event_ts: "1710000002.000001",
            channel: "C1",
            message: { type: "message", ts: "1710000001.000001", user: "U1", text: "new" },
            previous_message: { ts: "1710000001.000001", text: "old" },
        };

        expect(projectSlackEvent(event, { team_id: "T1", event }, context)).toMatchObject({
            notice_type: "message_updated",
            user: { id: { string: "U1" } },
            group: {
                guild_id: { string: "T1" },
                channel_id: { string: "C1" },
            },
            extensions: {
                slack: { previous_message: { text: "old" } },
            },
        });
    });

    it("缺少发送者的消息降级为无损 custom notice", () => {
        const event: SlackEvent = {
            type: "message",
            event_ts: "1710000003",
            channel: "C1",
            text: "sender missing",
        };
        const envelope: SlackWebhookBody = { event_id: "Ev2", event };

        expect(projectSlackEvent(event, envelope, context)).toMatchObject({
            type: "notice",
            notice_type: "custom",
            raw_event: envelope,
            extensions: { slack: { event_type: "message" } },
        });
    });

    it("投影 Bot 消息、工作区用户与原生交互", () => {
        const botMessage: SlackEvent = {
            type: "message",
            subtype: "bot_message",
            event_ts: "1710000004",
            ts: "1710000004",
            channel: "C1",
            bot_id: "B2",
            text: "automation",
        };
        expect(projectSlackEvent(botMessage, { event: botMessage }, context)).toMatchObject({
            type: "message",
            sender: { id: { string: "B2" } },
        });

        const teamJoin: SlackEvent = {
            type: "team_join",
            event_ts: "1710000005",
            user: { id: "U2", name: "Ada" },
        };
        expect(projectSlackEvent(teamJoin, { event: teamJoin }, context)).toMatchObject({
            type: "notice",
            notice_type: "user_added",
            user: { id: { string: "U2" }, name: "Ada" },
        });

        const interaction: SlackEvent = {
            type: "block_actions",
            event_ts: "1710000006",
            user: { id: "U3", name: "Lin" },
            channel: { id: "C2" },
            trigger_id: "trigger",
        };
        expect(projectSlackEvent(interaction, interaction, context)).toMatchObject({
            type: "notice",
            notice_type: "interaction",
            user: { id: { string: "U3" } },
            group: { channel_id: { string: "C2" } },
            extensions: { slack: { trigger_id: "trigger" } },
        });
    });

    it("保留 Agent Session 停止与标题变更的可操作上下文", () => {
        const stopped: SlackEvent = {
            type: "agent_session_stopped",
            event_ts: "1783536983.783769",
            user: "U1",
            channel: "C1",
            thread_ts: "1782234671.392669",
            streaming_message_ts: ["1782234987.693923"],
        };
        expect(
            projectSlackEvent(stopped, { team_id: "T1", event: stopped }, context),
        ).toMatchObject({
            type: "notice",
            notice_type: "custom",
            user: { id: { string: "U1" } },
            group: { channel_id: { string: "C1" }, guild_id: { string: "T1" } },
            message_id: { string: "1782234671.392669" },
            extensions: {
                slack: {
                    event_type: "agent_session_stopped",
                    streaming_message_ts: ["1782234987.693923"],
                },
            },
        });

        const renamed: SlackEvent = {
            type: "agent_session_title_changed",
            event_ts: "1783536983.783770",
            user: "U1",
            channel: "C1",
            thread_ts: "1782234671.392669",
            previous_title: "Old",
            title: "New",
        };
        expect(projectSlackEvent(renamed, { event: renamed }, context)).toMatchObject({
            extensions: {
                slack: {
                    event_type: "agent_session_title_changed",
                    previous_title: "Old",
                    title: "New",
                },
            },
        });
    });
});
