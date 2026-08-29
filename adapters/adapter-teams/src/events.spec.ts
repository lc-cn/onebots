import { describe, expect, it } from "vitest";
import { Activity, ActivityTypes } from "@microsoft/agents-activity";
import type { CommonTypes } from "onebots";
import { projectTeamsEvent, resolveTeamsProjectionKind } from "./events.js";
import type { TeamsEvent } from "./types.js";

const createId = (value: string | number): CommonTypes.Id => ({
    string: String(value),
    source: value,
    number: Number(value) || 1,
});

function createEvent(): TeamsEvent {
    const rawActivity = new Activity(ActivityTypes.Message);
    return {
        type: "message",
        raw_activity: rawActivity,
        activity: {
            type: "message",
            id: "message-1",
            timestamp: "2026-08-28T10:00:00.000Z",
            from: { id: "sender", name: "Sender" },
            conversation: { id: "group", name: "Group", isGroup: true },
            channelId: "msteams",
            text: "hello",
            attachments: [{ contentType: "image/png", contentUrl: "https://example.com/a.png" }],
        },
    };
}

describe("projectTeamsEvent", () => {
    it("投影群消息并保留原始事件", () => {
        const raw = createEvent();
        const event = projectTeamsEvent("group_message", raw, { botId: "bot", createId });
        expect(event).toMatchObject({
            type: "message",
            message_type: "group",
            raw_event: raw,
            group: { id: { string: "group" } },
        });
        expect(event.type === "message" && event.message.map(segment => segment.type)).toEqual([
            "text",
            "image",
        ]);
        expect(event.raw_event.raw_activity).toBe(raw.raw_activity);
    });

    it("Teams channel 不被压扁为普通群聊场景", () => {
        const raw = createEvent();
        raw.activity.conversation.conversationType = "channel";
        raw.activity.channelData = {
            team: { id: "team-1" },
            channel: { id: "native-channel-1" },
        };
        const event = projectTeamsEvent("group_message", raw, { botId: "bot", createId });
        expect(event).toMatchObject({
            type: "message",
            message_type: "channel",
            group: {
                id: { string: "group" },
                guild_id: { string: "team-1" },
                channel_id: { string: "group" },
                native_channel_id: "native-channel-1",
            },
        });
    });

    it("成员事件使用 membersAdded 中的真实成员", () => {
        const raw = createEvent();
        raw.activity.membersAdded = [{ id: "joined", name: "Joined" }];
        const event = projectTeamsEvent("member_joined", raw, { botId: "bot", createId });
        expect(event).toMatchObject({
            id: { string: "message-1:member_joined:joined" },
            type: "notice",
            notice_type: "member_joined",
            user: { id: { string: "joined" } },
        });
    });

    it("编辑事件投影为携带新内容的 notice", () => {
        const raw = createEvent();
        const event = projectTeamsEvent("message_updated", raw, { botId: "bot", createId });
        expect(event).toMatchObject({
            id: { string: "message-1:message_updated:message-1" },
            type: "notice",
            notice_type: "message_updated",
            message_id: { string: "message-1" },
        });
    });

    it("反应事件使用 replyToId 指向被操作消息", () => {
        const raw = createEvent();
        raw.activity.type = "messageReaction";
        raw.activity.replyToId = "target-message";
        raw.activity.reactionsAdded = [{ type: "like" }];
        const event = projectTeamsEvent("reaction_added", raw, { botId: "bot", createId });
        expect(event).toMatchObject({
            id: { string: "message-1:reaction_added:like" },
            type: "notice",
            notice_type: "reaction_added",
            message_id: { string: "target-message" },
            extensions: { teams: { reactions: [{ type: "like" }] } },
        });
    });

    it("未知 Activity 作为 custom notice 无损交付", () => {
        const raw = createEvent();
        raw.type = "installationUpdate";
        raw.activity.type = "installationUpdate";
        raw.activity.name = "add";
        const event = projectTeamsEvent("custom", raw, { botId: "bot", createId });
        expect(event).toMatchObject({
            type: "notice",
            notice_type: "custom",
            raw_event: raw,
            extensions: { teams: { activity_type: "installationUpdate", activity_name: "add" } },
        });
    });

    it("将群会话中的机器人安装投影为自身加入生命周期", () => {
        const raw = createEvent();
        raw.type = "installationUpdate";
        raw.activity.type = "installationUpdate";
        raw.activity.action = "add";
        raw.activity.recipient = { id: "bot-native", name: "Agent" };
        raw.activity.conversation.conversationType = "channel";
        const kind = resolveTeamsProjectionKind(raw);
        const event = projectTeamsEvent(kind, raw, { botId: "bot-native", createId });
        expect(kind).toBe("group_increase");
        expect(event).toMatchObject({
            type: "notice",
            notice_type: "group_increase",
            user: { id: { string: "bot-native" } },
            group: { id: { string: "group" } },
        });
    });
});
