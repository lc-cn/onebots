import { describe, expect, test, vi } from "vitest";
import { createMilkyClient } from "./client.js";
import type { MilkyV1Event } from "./types.js";

describe("Milky V1 canonical event projection", () => {
    test.each([
        [
            "notice.group_member_increase",
            "group_member_increase",
            { group_id: 1, user_id: 2, operator_id: 3, sub_type: "invite" },
        ],
        [
            "notice.group_member_decrease",
            "group_member_decrease",
            { group_id: 1, user_id: 2, operator_id: 3, sub_type: "kick" },
        ],
        [
            "notice.group_message_delete",
            "message_recall",
            {
                message_scene: "group",
                peer_id: 1,
                message_seq: 4,
                sender_id: 2,
                operator_id: 3,
                display_suffix: "",
            },
        ],
        [
            "notice.private_message_delete",
            "message_recall",
            {
                message_scene: "friend",
                peer_id: 2,
                message_seq: 4,
                sender_id: 2,
                operator_id: 2,
                display_suffix: "",
            },
        ],
        [
            "request.friend",
            "friend_request",
            { initiator_id: 2, initiator_uid: "uid-2", comment: "hello" },
        ],
        [
            "request.group",
            "group_join_request",
            {
                notification_seq: 2,
                group_id: 1,
                initiator_id: 2,
                is_filtered: true,
                comment: "hello",
            },
        ],
        ["request.group", "group_invitation", { invitation_seq: 3, group_id: 1, initiator_id: 2 }],
        ["meta.lifecycle", "bot_offline", { reason: "network" }],
    ] as const)("emits %s", (eventName, eventType, data) => {
        const client = createMilkyClient({
            baseUrl: "https://example.test",
            apiBaseUrl: "https://example.test",
            selfId: "10001",
            receiveMode: "manual",
        });
        const handler = vi.fn();
        client.on(eventName, handler);

        client.ingest({
            time: 1,
            self_id: 10001,
            event_type: eventType,
            data,
        } as MilkyV1Event);

        expect(handler).toHaveBeenCalledOnce();
        expect(handler).toHaveBeenCalledWith(
            expect.objectContaining({ timestamp: 1, bot_id: "10001" }),
        );
    });

    test("keeps native Milky request approval context", async () => {
        const call = vi.fn(async () => ({ status: "ok" as const, retcode: 0, data: {} }));
        const client = createMilkyClient({
            baseUrl: "https://example.test",
            selfId: "10001",
            receiveMode: "manual",
            call,
        });
        let friendRequestId = "";
        let groupRequestId = "";
        client.on("request.friend", event => (friendRequestId = event.request_id));
        client.on("request.group", event => (groupRequestId = event.request_id));

        client.ingest({
            time: 1,
            self_id: 10001,
            event_type: "friend_request",
            data: {
                initiator_id: 2,
                initiator_uid: "uid-2",
                comment: "hello",
                is_filtered: true,
            },
        });
        await client.adapter.approveFriendRequest(friendRequestId, true);
        client.ingest({
            time: 1,
            self_id: 10001,
            event_type: "group_join_request",
            data: {
                group_id: 1,
                notification_seq: 7,
                is_filtered: true,
                initiator_id: 2,
                comment: "hello",
            },
        });
        await client.adapter.approveGroupRequest(groupRequestId, false, "no");

        expect(call).toHaveBeenNthCalledWith(1, "accept_friend_request", {
            initiator_uid: "uid-2",
            is_filtered: true,
        });
        expect(call).toHaveBeenNthCalledWith(2, "reject_group_request", {
            notification_seq: 7,
            notification_type: "join_request",
            group_id: 1,
            is_filtered: true,
            reason: "no",
        });
    });
});
