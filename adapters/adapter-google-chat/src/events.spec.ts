import { describe, expect, it } from "vitest";
import { projectGoogleChatEvent } from "./events.js";
import type { GoogleChatInteractionType } from "./event-types.js";
import type { GoogleChatEventEnvelope } from "./types.js";

const id = (value: string | number) => ({ string: String(value), source: value, number: 1 });
const context = { botId: id("users/app"), principalName: "users/app", createId: id };

describe("Google Chat canonical 事件投影", () => {
    it("按已闭合 Space 类型区分群聊与私聊并保留 raw_event", () => {
        const source = interactionEnvelope("MESSAGE");
        source.space = { name: "spaces/DM", spaceType: "DIRECT_MESSAGE" };
        const [event] = projectGoogleChatEvent(source, context);
        expect(event).toMatchObject({
            type: "message",
            message_type: "direct",
            message_id: { string: "spaces/DM/messages/one" },
            message: [{ type: "text", data: { text: "hello" } }],
            raw_event: { type: "MESSAGE" },
        });
    });

    it("投影 reaction、membership、space 与 read state", () => {
        expect(
            projectGoogleChatEvent(
                cloudEnvelope("google.workspace.chat.reaction.v1.created", {
                    reaction: {
                        name: "spaces/AAA/messages/one/reactions/r1",
                        user: { name: "users/alice" },
                        emoji: { unicode: "👍" },
                    },
                }),
                context,
            )[0],
        ).toMatchObject({
            notice_type: "reaction_added",
            message_id: { string: "spaces/AAA/messages/one" },
        });
        expect(
            projectGoogleChatEvent(
                cloudEnvelope("google.workspace.chat.membership.v1.deleted", {
                    membership: {
                        name: "spaces/AAA/members/alice",
                        member: { name: "users/alice" },
                    },
                }),
                context,
            )[0],
        ).toMatchObject({ notice_type: "member_left", user: { id: { string: "users/alice" } } });
        expect(
            projectGoogleChatEvent(
                cloudEnvelope("google.workspace.chat.space.v1.updated", {
                    space: { name: "spaces/AAA", displayName: "New" },
                }),
                context,
            )[0],
        ).toMatchObject({ notice_type: "channel_updated", group: { name: "New" } });
        expect(
            projectGoogleChatEvent(
                cloudEnvelope("google.workspace.chat.spaceReadState.v1.updated", {
                    spaceReadState: { name: "users/alice/spaces/AAA/spaceReadState" },
                }),
                context,
            )[0],
        ).toMatchObject({ notice_type: "message_status", sub_type: "space_read" });
    });

    it("卡片和命令交互投影 custom，而不是静默丢弃", () => {
        const [event] = projectGoogleChatEvent(interactionEnvelope("CARD_CLICKED"), context);
        expect(event).toMatchObject({
            type: "notice",
            notice_type: "custom",
            sub_type: "CARD_CLICKED",
            extensions: { google_chat: { interaction: { type: "CARD_CLICKED" } } },
        });
    });

    it("Google Group membership 使用 custom 保真，不伪装成普通成员", () => {
        const [event] = projectGoogleChatEvent(
            cloudEnvelope("google.workspace.chat.membership.v1.created", {
                membership: {
                    name: "spaces/AAA/members/group",
                    groupMember: { name: "groups/engineering" },
                    state: "JOINED",
                },
            }),
            context,
        );
        expect(event).toMatchObject({
            notice_type: "custom",
            sub_type: "google_group_membership_created",
        });
    });

    it("资源精简载荷不会伪造未知用户", () => {
        const projected = projectGoogleChatEvent(
            cloudEnvelope("google.workspace.chat.message.v1.created", {
                message: { name: "spaces/AAA/messages/one" },
            }),
            context,
        );
        expect(projected[0]).toMatchObject({
            type: "notice",
            notice_type: "custom",
            sub_type: "message_created_resource_only",
        });
        expect(JSON.stringify(projected)).not.toContain("users/unknown");
    });
});

function interactionEnvelope(type: GoogleChatInteractionType): GoogleChatEventEnvelope {
    const event = {
        type,
        eventTime: "2026-08-31T01:02:03Z",
        user: { name: "users/alice" },
        space: { name: "spaces/DM" },
        message: {
            name: "spaces/DM/messages/one",
            sender: { name: "users/alice" },
            text: "hello",
        },
    };
    return { source: "interaction", event, raw_event: event, delivery_id: `${type}:1` };
}

function cloudEnvelope(type: string, data: Record<string, unknown>): GoogleChatEventEnvelope {
    const event = { specversion: "1.0" as const, id: "cloud", source: "source", type, data };
    return { source: "workspace-event", event, raw_event: event, delivery_id: "cloud" };
}
