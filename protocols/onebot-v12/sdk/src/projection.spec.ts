import { describe, expect, test, vi } from "vitest";
import { createOnebot12Client } from "./client.js";
import type { OneBotV12Event } from "./types.js";

describe("OneBot V12 canonical event projection", () => {
    test.each([
        [
            "notice.group_member_increase",
            {
                type: "notice",
                detail_type: "group_member_increase",
                group_id: "1",
                user_id: "2",
                operator_id: "3",
                sub_type: "invite",
            },
        ],
        [
            "notice.group_member_decrease",
            {
                type: "notice",
                detail_type: "group_member_decrease",
                group_id: "1",
                user_id: "2",
                operator_id: "3",
                sub_type: "kick",
            },
        ],
        [
            "notice.group_message_delete",
            {
                type: "notice",
                detail_type: "group_message_delete",
                group_id: "1",
                message_id: "4",
                operator_id: "3",
            },
        ],
        [
            "notice.private_message_delete",
            {
                type: "notice",
                detail_type: "private_message_delete",
                user_id: "2",
                message_id: "4",
            },
        ],
        [
            "notice.friend_increase",
            { type: "notice", detail_type: "friend_increase", user_id: "2" },
        ],
        [
            "notice.friend_decrease",
            { type: "notice", detail_type: "friend_decrease", user_id: "2" },
        ],
        [
            "request.friend",
            {
                type: "request",
                detail_type: "friend",
                request_id: "request-1",
                user_id: "2",
                message: "hello",
            },
        ],
        [
            "request.group",
            {
                type: "request",
                detail_type: "group",
                group_id: "1",
                user_id: "2",
                request_id: "request-2",
                sub_type: "add",
                message: "hello",
            },
        ],
        ["meta.lifecycle", { type: "meta", detail_type: "connect", sub_type: "" }],
        ["meta.heartbeat", { type: "meta", detail_type: "heartbeat", interval: 5000 }],
        [
            "meta.status_update",
            {
                type: "meta",
                detail_type: "status_update",
                status: {
                    good: true,
                    bots: [{ self: { platform: "test", user_id: "bot" }, online: true }],
                },
            },
        ],
    ] as const)("emits %s", (eventName, raw) => {
        const client = createOnebot12Client({
            baseUrl: "https://example.test",
            apiBaseUrl: "https://example.test",
            selfId: "bot",
            receiveMode: "manual",
        });
        const handler = vi.fn();
        client.on(eventName, handler);

        client.ingest({
            id: "event-1",
            time: 1,
            sub_type: "",
            self: { platform: "test", user_id: "bot" },
            ...raw,
        } as OneBotV12Event);

        expect(handler).toHaveBeenCalledOnce();
        expect(handler).toHaveBeenCalledWith(
            expect.objectContaining({ timestamp: 1, bot_id: "bot" }),
        );
    });

    test("uses protocol request_id, preserves its opaque flag, and projects bot status", async () => {
        const call = vi.fn(async () => ({ status: "ok" as const, retcode: 0, data: {} }));
        const client = createOnebot12Client({
            baseUrl: "https://example.test",
            selfId: "bot",
            receiveMode: "manual",
            call,
        });
        const requestHandler = vi.fn();
        const statusHandler = vi.fn();
        client.on("request.friend", requestHandler);
        client.on("meta.status_update", statusHandler);

        client.ingest({
            id: "event-1",
            request_id: "request-1",
            time: 1,
            type: "request",
            detail_type: "friend",
            sub_type: "",
            self: { platform: "test", user_id: "bot" },
            user_id: "2",
            message: "hello",
            flag: "opaque-request-flag",
        });
        client.ingest({
            id: "event-2",
            time: 1,
            type: "meta",
            detail_type: "status_update",
            sub_type: "",
            status: {
                good: true,
                bots: [{ self: { platform: "test", user_id: "bot" }, online: true }],
            },
        });

        expect(requestHandler).toHaveBeenCalledWith(
            expect.objectContaining({
                request_id: "request-1",
                comment: "hello",
                flag: "opaque-request-flag",
            }),
        );
        await client.approveFriendRequest("request-1", false, "no");
        expect(call).toHaveBeenCalledWith("handle_friend_request", {
            flag: "opaque-request-flag",
            approve: false,
            reason: "no",
        });
        expect(statusHandler).toHaveBeenCalledWith(
            expect.objectContaining({ status: { online: true, good: true } }),
        );
    });

    test("preserves group request flag and subtype for approval", async () => {
        const call = vi.fn(async () => ({ status: "ok" as const, retcode: 0, data: {} }));
        const client = createOnebot12Client({
            baseUrl: "https://example.test",
            selfId: "bot",
            receiveMode: "manual",
            call,
        });

        client.ingest({
            id: "event-1",
            request_id: "request-1",
            time: 1,
            type: "request",
            detail_type: "group",
            sub_type: "invite",
            self: { platform: "test", user_id: "bot" },
            user_id: "2",
            group_id: "1",
            flag: "opaque-group-flag",
        });
        await client.approveGroupRequest("request-1", true);

        expect(call).toHaveBeenCalledWith("handle_group_request", {
            flag: "opaque-group-flag",
            sub_type: "invite",
            approve: true,
            reason: undefined,
        });
    });
});
