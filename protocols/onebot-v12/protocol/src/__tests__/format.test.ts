import { describe, expect, test, vi } from "vitest";
import type { CommonEvent } from "onebots";

vi.mock("onebots", () => {
    class Protocol {
        public logger = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            trace: vi.fn(),
        };

        constructor(
            public adapter: unknown,
            public account: unknown,
            public config: unknown,
        ) {}
    }

    return {
        Protocol,
        ProtocolRegistry: {
            registerSchema: vi.fn(),
            register: vi.fn(),
        },
        App: {
            registerGeneral: vi.fn(),
        },
        Account: class {},
        Adapter: class {},
        CommonEvent: {},
        CommonTypes: {},
        requirePositiveIntegerParam: (params: Record<string, unknown>, key: string) => {
            const value = Number(params[key]);
            if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError("invalid id");
            return value;
        },
        requireNonEmptyStringParam: (params: Record<string, unknown>, key: string) => {
            const value = params[key];
            if (typeof value !== "string" || value.trim() === "") {
                throw new TypeError("invalid string");
            }
            return value;
        },
    };
});

const { OneBotV12Protocol } = await import("../index.js");

function createProtocol() {
    const resolvedId = {
        string: "openid-123",
        number: 12345678,
        source: "openid-123",
    };

    const adapter = {
        app: {
            getLogger: vi.fn().mockReturnValue({
                debug: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
            }),
        },
        resolveId: vi.fn((id: string | number) =>
            id === "bot"
                ? resolvedId
                : {
                      string: String(id),
                      source: id,
                      number: typeof id === "number" ? id : resolvedId.number,
                  },
        ),
        sendMessage: vi.fn().mockResolvedValue({
            message_id: { string: "sent", source: "sent", number: 1 },
        }),
        inviteGroupMember: vi.fn(),
        handleFriendRequest: vi.fn(),
        getGuildMemberList: vi.fn(),
        updateChannel: vi.fn(),
        getChannelMemberInfo: vi.fn(),
        getChannelMemberList: vi.fn(),
        describeCapabilities: vi.fn((): { actions: Record<string, { support: string }> } => ({
            actions: {
                send_message: { support: "native" },
                invite_group_member: { support: "native" },
                handle_friend_request: { support: "native" },
                update_channel: { support: "native" },
                get_channel_member_info: { support: "native" },
                get_channel_member_list: { support: "native" },
                send_poll: { support: "native" },
                upload_file: { support: "native" },
            },
        })),
        callAction: vi.fn().mockResolvedValue({ message_id: 42 }),
    };

    const protocol = new OneBotV12Protocol(
        adapter as never,
        { account_id: "bot", platform: "qq" } as never,
        { protocol: "onebot", version: "v12" } as never,
    );

    return { adapter, protocol, resolvedId };
}

// Helper to build realistic CommonEvent.Message objects
function textMsgEvent(overrides: Record<string, unknown> = {}) {
    return {
        id: { number: 1, string: "e1", source: "e1" },
        timestamp: 1700000000000,
        type: "message",
        platform: "qq",
        bot_id: { number: 12345678, string: "bot", source: "bot" },
        message_type: "private",
        sender: {
            id: { number: 10001, string: "u10001", source: "u10001" },
            name: "Alice",
        },
        message: [{ type: "text", data: { text: "Hello, world!" } }],
        raw_message: "Hello, world!",
        message_id: { number: 50001, string: "m50001", source: "m50001" },
        ...overrides,
    };
}

describe("OneBot V12 protocol", () => {
    test("converts a private text message", () => {
        const { protocol } = createProtocol();
        const event = textMsgEvent();
        const result = protocol["convertToV12Format"](event as unknown as CommonEvent.Event)!;

        expect(result).not.toBeNull();
        expect(result).toMatchObject({
            id: "e1",
            time: 1700000000,
            type: "message",
            detail_type: "private",
            sub_type: "",
            message_id: "m50001",
            user_id: "u10001",
            alt_message: "Hello, world!",
            self: {
                platform: "qq",
                user_id: "openid-123",
            },
        });
        if (result.type !== "message") {
            throw new Error("期望转换为消息事件");
        }
        expect(result.message).toEqual([{ type: "text", data: { text: "Hello, world!" } }]);
    });

    test("converts a group text message with group_id as string", () => {
        const { protocol } = createProtocol();
        const event = textMsgEvent({
            message_type: "group",
            group: {
                id: { number: 20001, string: "g20001", source: "g20001" },
                name: "Test Group",
            },
        });
        const result = protocol["convertToV12Format"](event as unknown as CommonEvent.Event)!;

        expect(result).toMatchObject({
            type: "message",
            detail_type: "group",
            sub_type: "",
            message_id: "m50001",
            user_id: "u10001",
            group_id: "g20001",
        });
    });

    test("converts a channel message with detail_type channel", () => {
        const { protocol } = createProtocol();
        const event = textMsgEvent({
            message_type: "channel",
            group: {
                id: { number: 30001, string: "c30001", source: "c30001" },
                name: "Channel",
                guild_id: { number: 30000, string: "g30000", source: "g30000" },
                channel_id: { number: 30001, string: "c30001", source: "c30001" },
            },
        });
        const result = protocol["convertToV12Format"](event as unknown as CommonEvent.Event)!;

        expect(result.type).toBe("message");
        expect(result.detail_type).toBe("channel");
        expect(result.sub_type).toBe("");
        expect(result).toMatchObject({ guild_id: "g30000", channel_id: "c30001" });
    });

    test("sends a channel message with separate guild and channel addresses", async () => {
        const { adapter, protocol } = createProtocol();

        await expect(
            protocol.apply("send_message", {
                detail_type: "channel",
                guild_id: "g30000",
                channel_id: "c30001",
                message: [{ type: "text", data: { text: "hello" } }],
            }),
        ).resolves.toMatchObject({ status: "ok", retcode: 0 });

        expect(adapter.sendMessage).toHaveBeenCalledWith("bot", {
            scene_type: "channel",
            scene_id: expect.objectContaining({ string: "c30001" }),
            guild_id: expect.objectContaining({ string: "g30000" }),
            message: [{ type: "text", data: { text: "hello" } }],
        });
    });

    test("converts at segment to mention with user_id", () => {
        const { protocol } = createProtocol();
        const segments = [
            { type: "at", data: { qq: "12345" } },
            { type: "text", data: { text: " hello" } },
        ];
        const result = protocol["convertToV12Segments"](segments);

        expect(result).toEqual([
            { type: "mention", data: { user_id: "12345" } },
            { type: "text", data: { text: " hello" } },
        ]);
    });

    test("converts mention segment back to at with qq", () => {
        const { protocol } = createProtocol();
        const segments = [
            { type: "mention", data: { user_id: "12345" } },
            { type: "text", data: { text: " hello" } },
        ];
        const result = protocol["convertToCommonSegments"](segments);

        expect(result).toEqual([
            { type: "at", data: { qq: "12345" } },
            { type: "text", data: { text: " hello" } },
        ]);
    });

    test("converts at segment in full message event", () => {
        const { protocol } = createProtocol();
        const event = textMsgEvent({
            message_type: "group",
            group: { id: { number: 20001, string: "g20001", source: "g20001" } },
            message: [
                { type: "at", data: { qq: "10001" } },
                { type: "text", data: { text: " check this" } },
            ],
            raw_message: "[CQ:at,qq=10001] check this",
        });
        const result = protocol["convertToV12Format"](event as unknown as CommonEvent.Event)!;

        if (result.type !== "message") {
            throw new Error("期望转换为消息事件");
        }
        expect(result.message).toEqual([
            { type: "mention", data: { user_id: "10001" } },
            { type: "text", data: { text: " check this" } },
        ]);
    });

    test("notice event uses string IDs for user_id, operator_id, group_id", () => {
        const { protocol } = createProtocol();
        const event = {
            id: { number: 2, string: "e2", source: "e2" },
            timestamp: 1700000000000,
            type: "notice",
            platform: "qq",
            bot_id: { number: 12345678, string: "bot", source: "bot" },
            notice_type: "group_member_increase",
            user: { id: { number: 10005, string: "u10005", source: "u10005" } },
            operator: { id: { number: 10001, string: "op10001", source: "op10001" } },
            group: { id: { number: 20001, string: "g20001", source: "g20001" } },
        };
        const result = protocol["convertToV12Format"](event as unknown as CommonEvent.Event)!;

        expect(result).toMatchObject({
            id: "e2",
            time: 1700000000,
            type: "notice",
            detail_type: "group_member_increase",
            sub_type: "",
            user_id: "u10005",
            operator_id: "op10001",
            group_id: "g20001",
        });
    });

    test("request event uses string user_id and includes comment and flag", () => {
        const { protocol } = createProtocol();
        const event = {
            id: { number: 3, string: "e3", source: "e3" },
            timestamp: 1700000000000,
            type: "request",
            platform: "qq",
            bot_id: { number: 12345678, string: "bot", source: "bot" },
            request_type: "friend",
            user: { id: { number: 20002, string: "u20002", source: "u20002" } },
            comment: "hello",
            flag: "req-flag-001",
        };
        const result = protocol["convertToV12Format"](event as unknown as CommonEvent.Event)!;

        expect(result).toMatchObject({
            id: "e3",
            time: 1700000000,
            type: "request",
            detail_type: "friend",
            sub_type: "",
            user_id: "u20002",
            comment: "hello",
            flag: "req-flag-001",
        });
    });

    test("meta event has detail_type and sub_type", () => {
        const { protocol } = createProtocol();
        const event = {
            id: { number: 4, string: "e4", source: "e4" },
            timestamp: 1700000000000,
            type: "meta",
            platform: "qq",
            bot_id: { number: 12345678, string: "bot", source: "bot" },
            meta_type: "heartbeat",
            sub_type: "dummy",
        };
        const result = protocol["convertToV12Format"](event as unknown as CommonEvent.Event)!;

        expect(result).toMatchObject({
            id: "e4",
            time: 1700000000,
            type: "meta",
            detail_type: "heartbeat",
            sub_type: "dummy",
        });
    });

    test("returns null for unknown event type", () => {
        const { protocol } = createProtocol();
        const event = {
            id: { number: 99, string: "e99", source: "e99" },
            timestamp: 1700000000000,
            type: "unknown_type",
            platform: "qq",
            bot_id: { number: 12345678, string: "bot", source: "bot" },
        };
        const result = protocol["convertToV12Format"](event as unknown as CommonEvent.Event);

        expect(result).toBeNull();
    });

    test("format() wraps payload with id, time, type, and self", () => {
        const { protocol } = createProtocol();
        const payload = { detail_type: "heartbeat", interval: 5000 };
        const result = protocol.format("meta", payload);

        expect(result.type).toBe("meta");
        expect(result.detail_type).toBe("heartbeat");
        expect(result.interval).toBe(5000);
        expect(result.self).toEqual({
            platform: "qq",
            user_id: "openid-123",
        });
        expect(typeof result.id).toBe("string");
        expect(typeof result.time).toBe("number");
    });

    test("apply() returns success response for get_supported_actions", async () => {
        const { protocol } = createProtocol();
        const result = await protocol.apply("get_supported_actions");

        expect(result).toMatchObject({
            status: "ok",
            retcode: 0,
            message: "",
        });
        expect(Array.isArray(result.data)).toBe(true);
        expect(result.data).toContain("send_message");
        expect(result.data).toContain("get_self_info");
    });

    test("get_supported_actions reflects canonical and platform capabilities", async () => {
        const { protocol, adapter } = createProtocol();
        adapter.describeCapabilities.mockReturnValue({
            actions: {
                get_guild_member_list: { support: "native" },
                update_channel: { support: "native" },
                upload_file: { support: "native" },
                send_poll: { support: "native" },
                delete_message: { support: "unsupported" },
            },
        });

        await expect(protocol.apply("get_supported_actions")).resolves.toMatchObject({
            data: [
                "get_guild_member_list",
                "get_self_info",
                "get_supported_actions",
                "send_poll",
                "set_channel_name",
                "update_channel",
            ],
        });
    });

    test("apply() returns failure response for unknown action", async () => {
        const { protocol } = createProtocol();
        const result = await protocol.apply("nonexistent_action");

        expect(result).toMatchObject({
            status: "failed",
            retcode: -1,
            data: null,
        });
        expect(result.message).toContain("Unknown action");
    });

    test("能力清单中的平台扩展动作通过统一入口调用", async () => {
        const { protocol, adapter } = createProtocol();
        const params = { chat_id: -100, question: "Q", options: ["A", "B"] };

        await expect(protocol.apply("send_poll", params)).resolves.toMatchObject({
            status: "ok",
            data: { message_id: 42 },
        });
        expect(adapter.callAction).toHaveBeenCalledWith("bot", "send_poll", params);
    });

    test("标准文件动作在平台明确声明能力时走原生入口", async () => {
        const { adapter, protocol } = createProtocol();

        await expect(
            protocol.apply("upload_file", { type: "url", url: "https://example.com/a.txt" }),
        ).resolves.toMatchObject({ status: "ok", retcode: 0 });
        expect(adapter.callAction).toHaveBeenCalledWith("bot", "upload_file", {
            type: "url",
            url: "https://example.com/a.txt",
        });
    });

    test("invite_friend_to_group is advertised and delegates to the adapter", async () => {
        const { protocol, adapter } = createProtocol();

        const result = await protocol.apply("invite_friend_to_group", {
            group_id: "20001",
            user_id: "10001",
        });

        expect(result).toMatchObject({ status: "ok", retcode: 0, data: {} });
        expect(adapter.inviteGroupMember).toHaveBeenCalledWith("bot", {
            group_id: expect.objectContaining({ number: 20001 }),
            user_id: expect.objectContaining({ number: 10001 }),
        });
        await expect(protocol.apply("get_supported_actions")).resolves.toMatchObject({
            data: expect.arrayContaining(["invite_friend_to_group"]),
        });
    });

    test("accept_friend_request is advertised and preserves the opaque flag", async () => {
        const { protocol, adapter } = createProtocol();

        await expect(
            protocol.apply("accept_friend_request", {
                flag: "opaque-request-flag",
                remark: "已验证",
            }),
        ).resolves.toMatchObject({ status: "ok", retcode: 0, data: {} });
        expect(adapter.handleFriendRequest).toHaveBeenCalledWith("bot", {
            flag: "opaque-request-flag",
            approve: true,
            remark: "已验证",
        });
        await expect(protocol.apply("get_supported_actions")).resolves.toMatchObject({
            data: expect.arrayContaining(["accept_friend_request"]),
        });
    });

    test("get_guild_member_list delegates to the adapter", async () => {
        const { protocol, adapter } = createProtocol();
        adapter.getGuildMemberList.mockResolvedValue([
            {
                guild_id: { string: "guild", number: 20001 },
                user_id: { string: "tiny-id", number: 10001 },
                user_name: "Alice",
                nickname: "Moderator",
            },
        ]);

        await expect(
            protocol.apply("get_guild_member_list", { guild_id: "guild" }),
        ).resolves.toMatchObject({
            status: "ok",
            data: [
                {
                    user_id: "tiny-id",
                    user_name: "Alice",
                    user_displayname: "Moderator",
                },
            ],
        });
    });

    test("频道管理动作委托给 canonical Adapter 接口", async () => {
        const { protocol, adapter } = createProtocol();
        adapter.getChannelMemberInfo.mockResolvedValue({
            user_id: { string: "user-1", number: 1 },
            user_name: "Alice",
        });
        adapter.getChannelMemberList.mockResolvedValue([
            { user_id: { string: "user-1", number: 1 }, user_name: "Alice" },
        ]);

        await expect(
            protocol.apply("set_channel_name", {
                guild_id: "guild-1",
                channel_id: "channel-1",
                channel_name: "general",
            }),
        ).resolves.toMatchObject({ status: "ok" });
        expect(adapter.updateChannel).toHaveBeenCalledWith("bot", {
            channel_id: expect.objectContaining({ string: "channel-1" }),
            channel_name: "general",
        });

        await expect(
            protocol.apply("get_channel_member_info", {
                guild_id: "guild-1",
                channel_id: "channel-1",
                user_id: "user-1",
            }),
        ).resolves.toMatchObject({
            status: "ok",
            data: { user_id: "user-1", user_name: "Alice", user_displayname: "Alice" },
        });
        await expect(
            protocol.apply("get_channel_member_list", {
                guild_id: "guild-1",
                channel_id: "channel-1",
            }),
        ).resolves.toMatchObject({
            status: "ok",
            data: [{ user_id: "user-1", user_name: "Alice", user_displayname: "Alice" }],
        });
    });

    test("converts non-at segments through unchanged", () => {
        const { protocol } = createProtocol();
        const segments = [
            { type: "image", data: { file_id: "abc.jpg" } },
            { type: "text", data: { text: "caption" } },
        ];
        const v12Result = protocol["convertToV12Segments"](segments);

        expect(v12Result).toEqual([
            { type: "image", data: { file_id: "abc.jpg" } },
            { type: "text", data: { text: "caption" } },
        ]);

        const commonResult = protocol["convertToCommonSegments"](segments);

        expect(commonResult).toEqual([
            { type: "image", data: { file_id: "abc.jpg" } },
            { type: "text", data: { text: "caption" } },
        ]);
    });

    test("defaults unknown message_type to private", () => {
        const { protocol } = createProtocol();
        const event = textMsgEvent({
            message_type: "some_unknown_type",
        });
        const result = protocol["convertToV12Format"](event as unknown as CommonEvent.Event)!;

        expect(result.detail_type).toBe("private");
    });
});
