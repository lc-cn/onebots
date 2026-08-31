import { describe, expect, test, vi } from "vitest";
import { createOnebot11Client } from "./client.js";
import type { OneBotV11Event } from "./types.js";

describe("OneBot V11 canonical event projection", () => {
    test.each([
        [
            "notice.group_member_increase",
            {
                post_type: "notice",
                notice_type: "group_increase",
                group_id: 1,
                user_id: 2,
                operator_id: 3,
                sub_type: "invite",
            },
        ],
        [
            "notice.group_member_decrease",
            {
                post_type: "notice",
                notice_type: "group_decrease",
                group_id: 1,
                user_id: 2,
                operator_id: 3,
                sub_type: "kick",
            },
        ],
        [
            "notice.group_message_delete",
            {
                post_type: "notice",
                notice_type: "group_recall",
                group_id: 1,
                user_id: 2,
                operator_id: 3,
                message_id: 4,
            },
        ],
        [
            "notice.private_message_delete",
            { post_type: "notice", notice_type: "friend_recall", user_id: 2, message_id: 4 },
        ],
        ["notice.friend_increase", { post_type: "notice", notice_type: "friend_add", user_id: 2 }],
        [
            "notice.friend_decrease",
            { post_type: "notice", notice_type: "friend_delete", user_id: 2 },
        ],
        [
            "request.friend",
            {
                post_type: "request",
                request_type: "friend",
                user_id: 2,
                flag: "123",
                comment: "hello",
            },
        ],
        [
            "request.group",
            {
                post_type: "request",
                request_type: "group",
                group_id: 1,
                user_id: 2,
                flag: "456",
                sub_type: "add",
                comment: "hello",
            },
        ],
        [
            "meta.lifecycle",
            { post_type: "meta_event", meta_event_type: "lifecycle", sub_type: "connect" },
        ],
        [
            "meta.heartbeat",
            { post_type: "meta_event", meta_event_type: "heartbeat", interval: 5000 },
        ],
        [
            "meta.status_update",
            {
                post_type: "meta_event",
                meta_event_type: "status_update",
                status: { online: true, good: true },
            },
        ],
    ] as const)("emits %s", (eventName, raw) => {
        const client = createOnebot11Client({
            baseUrl: "https://example.test",
            apiBaseUrl: "https://example.test",
            selfId: "10001",
            receiveMode: "manual",
        });
        const handler = vi.fn();
        client.on(eventName, handler);

        client.ingest({ time: 1, self_id: 10001, ...raw } as OneBotV11Event);

        expect(handler).toHaveBeenCalledOnce();
        expect(handler).toHaveBeenCalledWith(
            expect.objectContaining({ timestamp: 1, bot_id: 10001 }),
        );
    });

    test("preserves an opaque request flag for approval", async () => {
        const call = vi.fn(async () => ({ status: "ok" as const, retcode: 0 }));
        const client = createOnebot11Client({
            baseUrl: "https://example.test",
            selfId: "10001",
            receiveMode: "manual",
            call,
        });
        const handler = vi.fn();
        client.on("request.friend", handler);
        client.ingest({
            time: 1,
            self_id: 10001,
            post_type: "request",
            request_type: "friend",
            user_id: 2,
            flag: "opaque-request-id",
        });

        const requestId = handler.mock.calls[0][0].request_id as number;
        await client.adapter.approveFriendRequest(requestId, true);

        expect(call).toHaveBeenCalledWith("set_friend_add_request", {
            flag: "opaque-request-id",
            approve: true,
            remark: undefined,
        });
    });
});
