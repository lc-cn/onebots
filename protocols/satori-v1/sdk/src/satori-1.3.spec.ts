import { describe, expect, expectTypeOf, test, vi } from "vitest";
import type { ChannelMessageEvent } from "imhelper";
import { createSatoriClient } from "./client.js";
import { ProtocolError } from "./index.js";
import type { SatoriCall, SatoriFriend, SatoriGuildRole, SatoriV1Event } from "./types.js";

function createClient(call: SatoriCall) {
    return createSatoriClient({
        baseUrl: "https://api.example/v1",
        platform: "test",
        selfId: "bot",
        receiveMode: "manual",
        call,
    });
}

describe("Satori 1.3 resources", () => {
    test("parses friend.list as Friend and keeps legacy user rows usable", async () => {
        const call = vi.fn(async (_resource: string, _method: string, params = {}) =>
            "next" in params
                ? { data: [{ id: "user-2", username: "bob", avatar: "https://example/bob" }] }
                : {
                      data: [
                          {
                              user: {
                                  id: "user-1",
                                  name: "Alice",
                                  nick: "小爱",
                                  avatar: "https://example/alice",
                                  is_bot: false,
                              },
                              nick: "备注",
                          },
                      ],
                      next: "page-2",
                  },
        );
        const client = createClient(call);

        const friends = await client.listFriends();
        const friend = await client.getFriendInfo("user-1");
        const legacy = await client.getFriendInfo("user-2");

        expectTypeOf(friends).toEqualTypeOf<SatoriFriend[]>();
        expect(friends[0]).toEqual({
            user: {
                id: "user-1",
                name: "Alice",
                nick: "小爱",
                avatar: "https://example/alice",
                is_bot: false,
            },
            nick: "备注",
        });
        expect(friend.user_id).toBe("user-1");
        expect(friend.user_name).toBe("小爱");
        expect(friend.remark).toBe("备注");
        expect(legacy.user_name).toBe("bob");
        expect(legacy.avatar).toBe("https://example/bob");
        expect(call).toHaveBeenNthCalledWith(1, "friend", "list", {});
        expect(call).toHaveBeenNthCalledWith(2, "friend", "list", { next: "page-2" });
    });

    test("rejects a friend row that is neither Friend nor User", async () => {
        const client = createClient(async () => ({ data: [{ nick: 1 }] }));

        await expect(client.listFriends()).rejects.toMatchObject({
            name: "ProtocolError",
            operation: "friend.list",
            kind: "protocol",
        } satisfies Partial<ProtocolError>);
    });

    test("projects guild member roles as GuildRole and accepts legacy role ids", async () => {
        const call = vi.fn(async (resource: string) =>
            resource === "guild"
                ? {
                      user: { id: "user-1", name: "Alice" },
                      nick: "群名片",
                      roles: [{ id: "role-1", name: "管理员" }, "role-2"],
                  }
                : { data: [] },
        );
        const client = createClient(call);

        const member = await client.adapter.getGroupMemberInfo("guild-1", "user-1");

        expectTypeOf(member.roles).toEqualTypeOf<SatoriGuildRole[] | undefined>();
        expect(member.roles).toEqual([{ id: "role-1", name: "管理员" }, { id: "role-2" }]);
        expect(member.user_name).toBe("群名片");
    });

    test("rejects a guild member whose user name is not a string", async () => {
        const client = createClient(async () => ({
            user: { id: "user-1", name: 1 },
        }));

        await expect(client.adapter.getGroupMemberInfo("guild-1", "user-1")).rejects.toMatchObject({
            name: "ProtocolError",
            operation: "guild.member.get",
        } satisfies Partial<ProtocolError>);
    });

    test("rejects guild member roles that are not GuildRole or role ids", async () => {
        const client = createClient(async () => ({
            data: [{ user: { id: "user-1" }, roles: [{ name: "missing-id" }] }],
        }));

        await expect(client.adapter.getGroupMemberList("guild-1")).rejects.toMatchObject({
            name: "ProtocolError",
            operation: "guild.member.list",
        } satisfies Partial<ProtocolError>);
    });

    test("passes event.referrer through to message.create unchanged", async () => {
        const referrer = {
            type: "im.message.receive_v1",
            event: { message: { message_id: "message-1", thread_id: "thread-1" } },
        };
        const call = vi.fn(
            async (_resource: string, _method: string, _params?: Record<string, unknown>) => [
                { id: "reply-1" },
            ],
        );
        const client = createClient(call);
        let message: ChannelMessageEvent<string> | undefined;
        client.on("message.channel", event => {
            message = event;
        });
        client.ingest({
            id: "event-1",
            type: "message-created",
            platform: "test",
            timestamp: 1_700_000_000_000,
            channel: { id: "channel-1" },
            guild: { id: "guild-1" },
            user: { id: "user-1" },
            message: { id: "message-1", content: "hello", created_at: 1_700_000_000_000 },
            referrer,
        });

        await message?.reply("reply");
        const override = { source: "manual" };
        await client.adapter.sendMessage({
            scene_type: "channel",
            scene_id: "channel-1",
            message: "active",
            referrer: override,
        });

        expect(call).toHaveBeenNthCalledWith(1, "message", "create", {
            channel_id: "channel-1",
            content: "reply",
            referrer,
        });
        expect(call.mock.calls[0]?.[2]?.referrer).toBe(referrer);
        expect(call).toHaveBeenNthCalledWith(2, "message", "create", {
            channel_id: "channel-1",
            content: "active",
            referrer: override,
        });
    });

    test("omits referrer when the source event did not provide one", async () => {
        const call = vi.fn(
            async (_resource: string, _method: string, _params?: Record<string, unknown>) =>
                undefined,
        );
        const client = createClient(call);
        let message: ChannelMessageEvent<string> | undefined;
        client.on("message.channel", event => {
            message = event;
        });
        client.ingest({
            id: "event-1",
            type: "message-created",
            platform: "test",
            timestamp: 1_700_000_000_000,
            channel: { id: "channel-1" },
            guild: { id: "guild-1" },
            user: { id: "user-1" },
            message: { id: "message-1", content: "hello", created_at: 1_700_000_000_000 },
        });

        await message?.reply("reply");

        expect(call.mock.calls[0]?.[2]).toStrictEqual({
            channel_id: "channel-1",
            content: "reply",
        });
    });

    test("keeps referrers for the same message id in different channels", async () => {
        const referrerA = { source: "a" };
        const referrerB = { source: "b" };
        const call = vi.fn(
            async (_resource: string, _method: string, _params?: Record<string, unknown>) =>
                undefined,
        );
        const client = createClient(call);
        const messages: ChannelMessageEvent<string>[] = [];
        client.on("message.channel", event => {
            messages.push(event);
        });
        const base = {
            platform: "test",
            timestamp: 1_700_000_000_000,
            guild: { id: "guild-1" },
            user: { id: "user-1" },
            message: { id: "message-1", content: "hello", created_at: 1_700_000_000_000 },
        };
        client.ingest({
            ...base,
            id: "event-a",
            type: "message-created",
            channel: { id: "channel-a" },
            referrer: referrerA,
        });
        client.ingest({
            ...base,
            id: "event-b",
            type: "message-created",
            channel: { id: "channel-b" },
            referrer: referrerB,
        });

        await messages[0]?.reply("from-a");

        expect(call.mock.calls[0]?.[2]).toMatchObject({
            channel_id: "channel-a",
            referrer: referrerA,
        });
        expect(call.mock.calls[0]?.[2]?.referrer).toBe(referrerA);
    });

    test("normalizes legacy member role ids on inbound events", () => {
        const client = createClient(async () => undefined);
        const raw = vi.fn();
        client.on("event", raw);
        client.ingest({
            id: "event-1",
            type: "guild-member-updated",
            platform: "test",
            timestamp: 1_700_000_000_000,
            guild: { id: "guild-1" },
            user: { id: "user-1" },
            member: { roles: ["role-1"] },
        } as unknown as SatoriV1Event);

        expect(raw.mock.calls[0]?.[0]).toMatchObject({
            member: { roles: [{ id: "role-1" }] },
        });
    });

    test("treats null optional friend fields as absent", async () => {
        const client = createClient(async () => ({
            data: [{ user: { id: "user-1", name: null }, nick: null }],
        }));

        await expect(client.listFriends()).resolves.toEqual([{ user: { id: "user-1" } }]);
    });

    test("uses emoji_id for reaction clear, delete and list", async () => {
        const call = vi.fn(async (resource: string, method: string) =>
            resource === "reaction" && method === "list"
                ? { data: [{ id: "user-1", name: "Alice" }], next: "page-2" }
                : undefined,
        );
        const client = createClient(call);

        await client.clearReaction("channel-1", "message-1");
        await client.clearReaction("channel-1", "message-1", "emoji-1");
        await client.deleteReaction("channel-1", "message-1", "emoji-1", "user-2");
        const page = await client.listReactions("channel-1", "message-1", "emoji-1");

        expect(call).toHaveBeenNthCalledWith(1, "reaction", "clear", {
            channel_id: "channel-1",
            message_id: "message-1",
        });
        expect(call).toHaveBeenNthCalledWith(2, "reaction", "clear", {
            channel_id: "channel-1",
            message_id: "message-1",
            emoji_id: "emoji-1",
        });
        expect(call).toHaveBeenNthCalledWith(3, "reaction", "delete", {
            channel_id: "channel-1",
            message_id: "message-1",
            emoji_id: "emoji-1",
            user_id: "user-2",
        });
        expect(page).toEqual({ data: [{ id: "user-1", name: "Alice" }], next: "page-2" });
    });

    test("projects guild-emoji events and keeps the raw event", () => {
        const client = createClient(async () => undefined);
        const notices = vi.fn();
        const raw = vi.fn();
        client.on("guild-emoji", notices);
        client.on("event", raw);
        const added: SatoriV1Event = {
            id: "event-1",
            type: "guild-emoji-added",
            platform: "test",
            timestamp: 1_700_000_000_000,
            guild: { id: "guild-1" },
            operator: { id: "admin-1" },
            emoji: { id: "emoji-1", name: "smile" },
        };

        client.ingest(added);
        client.ingest({ ...added, id: "event-2", type: "guild-emoji-updated" });
        client.ingest({
            ...added,
            id: "event-3",
            type: "guild-emoji-deleted",
            emoji: { id: "emoji-1" },
        });
        client.ingest({ ...added, id: "event-4", type: "guild-emoji-removed" });
        client.ingest({ ...added, id: "event-5", type: "guild-emoji-added", emoji: undefined });

        expect(notices).toHaveBeenNthCalledWith(1, {
            type: "guild-emoji-added",
            timestamp: 1_700_000_000_000,
            emoji: { id: "emoji-1", name: "smile" },
            guild_id: "guild-1",
            operator_id: "admin-1",
            raw: added,
        });
        expect(notices).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ type: "guild-emoji-updated" }),
        );
        expect(notices).toHaveBeenNthCalledWith(
            3,
            expect.objectContaining({ type: "guild-emoji-deleted", emoji: { id: "emoji-1" } }),
        );
        expect(notices).toHaveBeenNthCalledWith(
            4,
            expect.objectContaining({ type: "guild-emoji-removed" }),
        );
        expect(notices).toHaveBeenCalledTimes(4);
        expect(raw).toHaveBeenCalledTimes(5);
    });
});
