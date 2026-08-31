import { describe, expect, it } from "vitest";
import { parseCloudEvent, parseInteractionEvent, parsePubSubEnvelope } from "./event-validation.js";

const message = {
    name: "spaces/AAA/messages/one",
    sender: { name: "users/alice", type: "HUMAN" },
    text: "hello",
};

describe("Google Chat 外部事件校验", () => {
    it("严格解析 Interaction MESSAGE", () => {
        expect(
            parseInteractionEvent({
                type: "MESSAGE",
                eventTime: "2026-08-31T01:02:03Z",
                user: { name: "users/alice", type: "HUMAN" },
                space: { name: "spaces/AAA", spaceType: "DIRECT_MESSAGE" },
                message,
            }),
        ).toMatchObject({ type: "MESSAGE", message: { name: message.name } });
        expect(() =>
            parseInteractionEvent({ type: "MESSAGE", eventTime: "invalid", message }),
        ).toThrow(/RFC 3339/u);
        expect(
            parseInteractionEvent({
                type: "APP_HOME",
                user: { name: "users/alice", type: "HUMAN" },
                space: { name: "spaces/AAA", spaceType: "DIRECT_MESSAGE" },
            }),
        ).toMatchObject({ type: "APP_HOME" });
        expect(() =>
            parseInteractionEvent({
                type: "FUTURE_PREVIEW_EVENT",
                eventTime: "2026-08-31T01:02:03Z",
            }),
        ).toThrow(/不支持的稳定/u);
        expect(() => parseInteractionEvent({ type: "APP_HOME" })).toThrow(/user 与 space/u);
    });

    it("严格校验 availability 与 read state resource name", () => {
        expect(() =>
            parseCloudEvent({
                specversion: "1.0",
                id: "bad-availability",
                source: "source",
                type: "google.workspace.chat.availability.v1.updated",
                data: { availability: { name: "availability/alice" } },
            }),
        ).toThrow(/availability.name 无效/u);
        expect(
            parseCloudEvent({
                specversion: "1.0",
                id: "read-state",
                source: "source",
                type: "google.workspace.chat.threadReadState.v1.updated",
                data: {
                    threadReadState: {
                        name: "users/alice/spaces/AAA/threads/T1/threadReadState",
                    },
                },
            }),
        ).toHaveLength(1);
    });

    it("展开官方 batch payload，并为每项生成稳定 delivery id", () => {
        const events = parseCloudEvent({
            specversion: "1.0",
            id: "batch-1",
            source: "//workspaceevents.googleapis.com/subscriptions/sub",
            type: "google.workspace.chat.message.v1.batchCreated",
            data: {
                messages: [
                    { message },
                    { message: { ...message, name: "spaces/AAA/messages/two" } },
                ],
            },
        });
        expect(events).toMatchObject([
            { id: "batch-1:0", type: "google.workspace.chat.message.v1.created" },
            { id: "batch-1:1", type: "google.workspace.chat.message.v1.created" },
        ]);
    });

    it("拒绝未声明的事件、畸形 resource 与错误 batch action", () => {
        expect(() =>
            parseCloudEvent({
                specversion: "1.0",
                id: "unknown",
                source: "source",
                type: "google.workspace.chat.message.v1.previewed",
                data: { message },
            }),
        ).toThrow(/不支持的稳定/u);
        expect(() =>
            parseCloudEvent({
                specversion: "1.0",
                id: "bad-name",
                source: "source",
                type: "google.workspace.chat.message.v1.created",
                data: { message: { ...message, name: "messages/invalid" } },
            }),
        ).toThrow(/resource name/u);
        expect(() =>
            parseCloudEvent({
                specversion: "1.0",
                id: "bad-time",
                source: "source",
                type: "google.workspace.chat.message.v1.created",
                data: { message: { ...message, createTime: "yesterday" } },
            }),
        ).toThrow(/RFC 3339/u);
        expect(() =>
            parseCloudEvent({
                specversion: "1.0",
                id: "bad-batch",
                source: "source",
                type: "google.workspace.chat.space.v1.batchCreated",
                data: { spaces: [{ space: { name: "spaces/AAA" } }] },
            }),
        ).toThrow(/batch action/u);
    });

    it("严格解析 Pub/Sub base64 JSON envelope", () => {
        const event = { specversion: "1.0" };
        expect(
            parsePubSubEnvelope({
                message: {
                    messageId: "1",
                    data: Buffer.from(JSON.stringify(event)).toString("base64"),
                },
                subscription: "projects/p/subscriptions/s",
            }),
        ).toMatchObject({ envelope: { message: { messageId: "1" } }, event });
        expect(() =>
            parsePubSubEnvelope({
                message: { messageId: "1", data: "%%%" },
                subscription: "projects/p/subscriptions/s",
            }),
        ).toThrow(/base64/u);
    });

    it("严格保留 Google Group membership，不把群组伪装成用户", () => {
        expect(
            parseCloudEvent({
                specversion: "1.0",
                id: "group-member",
                source: "source",
                type: "google.workspace.chat.membership.v1.created",
                data: {
                    membership: {
                        name: "spaces/AAA/members/group",
                        groupMember: { name: "groups/engineering", displayName: "Engineering" },
                        state: "JOINED",
                    },
                },
            })[0].data,
        ).toMatchObject({ membership: { groupMember: { name: "groups/engineering" } } });
    });
});
