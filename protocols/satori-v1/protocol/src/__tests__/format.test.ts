import { describe, expect, test, vi } from "vitest";
import type { CommonEvent } from "onebots";

vi.mock("onebots", () => {
    class Protocol {
        public on = vi.fn();
        public off = vi.fn();
        public removeAllListeners = vi.fn();
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

        get router() {
            return (this.adapter as { app: { router: unknown } }).app.router;
        }

        get path() {
            const account = this.account as { path: string };
            const config = this.config as { protocol: string; version: string };
            return `${account.path}/${config.protocol}/${config.version}`;
        }
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
    };
});

const { SatoriV1 } = await import("../index.js");

function createProtocol() {
    const resolvedId = {
        string: "openid-123",
        number: 12345678,
        source: "openid-123",
    };

    const wsServer = { on: vi.fn() };
    const router = {
        post: vi.fn(),
        get: vi.fn(),
        ws: vi.fn(() => wsServer),
    };
    const adapter = {
        app: {
            router,
            getLogger: vi.fn().mockReturnValue({
                debug: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
            }),
        },
        resolveId: vi.fn((id: string | number) => ({
            ...resolvedId,
            string: typeof id === "string" ? id : resolvedId.string,
        })),
        describeCapabilities: vi.fn().mockReturnValue({
            actions: {
                get_group_info: { support: "native" },
                get_channel_info: { support: "native" },
            },
        }),
        sendMessage: vi.fn().mockResolvedValue({
            message_id: { string: "sent-1", number: 1, source: "sent-1" },
        }),
        getMessageHistory: vi.fn().mockResolvedValue([]),
        createUserChannel: vi.fn().mockResolvedValue({
            channel_id: { string: "direct-1", number: 1, source: "direct-1" },
            channel_name: "Direct",
        }),
        getLoginInfo: vi.fn().mockResolvedValue({
            user_id: { string: "runtime-bot", number: 12345678, source: "runtime-bot" },
            user_name: "Runtime Bot",
        }),
        getChannelInfo: vi.fn().mockResolvedValue({
            channel_id: { string: "channel-1" },
            channel_name: "General",
            channel_type: 0,
        }),
        getChannelList: vi.fn().mockResolvedValue([]),
        createChannel: vi.fn().mockResolvedValue({
            channel_id: { string: "created-channel" },
            channel_name: "Created",
        }),
        updateChannel: vi.fn().mockResolvedValue(undefined),
        handleFriendRequest: vi.fn().mockResolvedValue(undefined),
        handleGroupRequest: vi.fn().mockResolvedValue(undefined),
        sendGroupMessageReaction: vi.fn().mockResolvedValue(undefined),
        callAction: vi.fn().mockResolvedValue(undefined),
        getGuildInfo: vi.fn().mockResolvedValue({
            guild_id: { string: "guild-1" },
            guild_name: "Guild",
        }),
        getGuildList: vi.fn().mockResolvedValue([]),
        getGuildMemberInfo: vi.fn().mockResolvedValue({
            user_id: { string: "user-1" },
            user_name: "Alice",
            nickname: "Ali",
        }),
        getGuildMemberList: vi.fn().mockResolvedValue([]),
    };

    const protocol = new SatoriV1(
        adapter as never,
        { account_id: "bot", path: "/qq/bot", platform: "qq" } as never,
        { protocol: "satori", version: "v1", platform: "qq", use_ws: true } as never,
    );

    return { adapter, protocol, resolvedId, router, wsServer };
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
            avatar: "https://example.com/avatar.png",
        },
        message: [{ type: "text", data: { text: "Hello, world!" } }],
        raw_message: "Hello, world!",
        message_id: { number: 50001, string: "m50001", source: "m50001" },
        ...overrides,
    };
}

describe("Satori V1 protocol", () => {
    test("registers the public WebSocket endpoint at a single-slash events path", () => {
        const { protocol, router } = createProtocol();

        protocol.start();

        expect(router.ws).toHaveBeenCalledWith("/qq/bot/satori/v1/events");
    });

    test("returns direct Satori results to the official adapter while preserving legacy wrappers", async () => {
        const { protocol, router } = createProtocol();
        protocol["startHttp"]();
        const handler = router.post.mock.calls[0][1];
        const createContext = (headers: Record<string, string>) => ({
            headers,
            params: { method: "login.get" },
            query: {},
            request: { body: {} },
            body: undefined as unknown,
            status: 200,
        });

        const official = createContext({ "satori-platform": "mock" });
        await handler(official);
        expect(official.body).toMatchObject({ user: { id: "runtime-bot" }, platform: "qq" });

        const legacy = createContext({});
        await handler(legacy);
        expect(legacy.body).toMatchObject({
            data: { user: { id: "runtime-bot" }, platform: "qq" },
        });
    });

    test("waits for IDENTIFY before READY and responds to PING", async () => {
        const { protocol, wsServer } = createProtocol();
        protocol.start();

        const handlers = new Map<string, (...args: unknown[]) => unknown>();
        const ws = {
            readyState: 1,
            send: vi.fn(),
            close: vi.fn(),
            on: vi.fn((name: string, handler: (...args: unknown[]) => void) =>
                handlers.set(name, handler),
            ),
        };
        const connection = wsServer.on.mock.calls.find(([name]) => name === "connection")?.[1];
        connection(ws, { headers: {} });

        expect(ws.send).not.toHaveBeenCalled();
        await handlers.get("message")?.(Buffer.from(JSON.stringify({ op: 3, body: {} })));
        expect(JSON.parse(ws.send.mock.calls[0][0])).toMatchObject({
            op: 4,
            body: {
                logins: [
                    { user: { id: "runtime-bot", name: "Runtime Bot" }, self_id: "runtime-bot" },
                ],
            },
        });
        await handlers.get("message")?.(Buffer.from(JSON.stringify({ op: 1 })));
        expect(JSON.parse(ws.send.mock.calls[1][0])).toEqual({ op: 2 });
    });

    test("converts a private message to message-created event", () => {
        const { protocol } = createProtocol();
        const event = textMsgEvent();
        const result = protocol["convertToSatoriFormat"](event as unknown as CommonEvent.Event);

        expect(result).not.toBeNull();
        expect(result).toMatchObject({
            id: expect.any(Number),
            type: "message-created",
            platform: "qq",
            self_id: "bot",
            timestamp: 1700000000000,
            channel: {
                id: "u10001",
                type: 1,
            },
            user: {
                id: "u10001",
                name: "Alice",
                avatar: "https://example.com/avatar.png",
            },
            message: {
                id: "m50001",
                content: "Hello, world!",
                created_at: 1700000000000,
            },
        });
    });

    test("消息动作复用事件登记的场景，不从 channel_id 形状猜测", async () => {
        const { adapter, protocol } = createProtocol();
        protocol["convertToSatoriFormat"](
            textMsgEvent({
                message_type: "group",
                group: {
                    id: { number: 20001, string: "opaque_channel", source: "opaque_channel" },
                },
            }) as unknown as CommonEvent.Event,
        );

        await protocol.apply("message.create", {
            channel_id: "opaque_channel",
            content: "hello",
        });

        expect(adapter.sendMessage).toHaveBeenCalledWith("bot", {
            scene_type: "group",
            scene_id: expect.objectContaining({ string: "opaque_channel" }),
            guild_id: undefined,
            message: [{ type: "text", data: { text: "hello" } }],
        });
    });

    test("无上下文且目录能力有歧义时拒绝误投消息", async () => {
        const { adapter, protocol } = createProtocol();

        const result = await protocol.apply("message.create", {
            channel_id: "unknown",
            content: "hello",
        });

        expect(result.message).toContain("无法确定 channel_id unknown 的消息场景");
        expect(adapter.sendMessage).not.toHaveBeenCalled();
    });

    test("私信频道创建会登记 direct 路由", async () => {
        const { adapter, protocol } = createProtocol();

        await protocol.apply("user.channel.create", { user_id: "user-1" });
        await protocol.apply("message.create", { channel_id: "direct-1", content: "hello" });

        expect(adapter.sendMessage).toHaveBeenCalledWith(
            "bot",
            expect.objectContaining({
                scene_type: "direct",
                scene_id: expect.objectContaining({ string: "direct-1" }),
            }),
        );
    });

    test("频道创建与更新使用标准 data 对象", async () => {
        const { adapter, protocol } = createProtocol();

        await protocol.apply("channel.create", {
            guild_id: "guild-1",
            data: { name: "Created", type: 1, parent_id: "parent-1" },
        });
        await protocol.apply("channel.update", {
            channel_id: "channel-1",
            data: { name: "Renamed", parent_id: "parent-2" },
        });

        expect(adapter.createChannel).toHaveBeenCalledWith("bot", {
            guild_id: expect.objectContaining({ string: "guild-1" }),
            channel_name: "Created",
            channel_type: 1,
            parent_id: expect.objectContaining({ string: "parent-1" }),
        });
        expect(adapter.updateChannel).toHaveBeenCalledWith("bot", {
            channel_id: expect.objectContaining({ string: "channel-1" }),
            channel_name: "Renamed",
            parent_id: expect.objectContaining({ string: "parent-2" }),
        });
    });

    test("申请处理映射到统一适配器动作", async () => {
        const { adapter, protocol } = createProtocol();

        await protocol.apply("friend.approve", {
            message_id: "friend-request-1",
            approve: false,
            comment: "declined",
        });
        await protocol.apply("guild.approve", {
            message_id: "invite-1",
            approve: true,
        });
        await protocol.apply("guild.member.approve", {
            message_id: "join-1",
            approve: false,
            comment: "declined",
        });

        expect(adapter.handleFriendRequest).toHaveBeenCalledWith("bot", {
            request_id: expect.objectContaining({ string: "friend-request-1" }),
            approve: false,
            remark: "declined",
            reason: "declined",
        });
        expect(adapter.handleGroupRequest).toHaveBeenNthCalledWith(1, "bot", {
            request_id: expect.objectContaining({ string: "invite-1" }),
            type: "invitation",
            approve: true,
            reason: undefined,
        });
        expect(adapter.handleGroupRequest).toHaveBeenNthCalledWith(2, "bot", {
            request_id: expect.objectContaining({ string: "join-1" }),
            type: "request",
            approve: false,
            reason: "declined",
        });
    });

    test("群消息 reaction 使用已登记的频道场景", async () => {
        const { adapter, protocol } = createProtocol();
        protocol["convertToSatoriFormat"](
            textMsgEvent({
                message_type: "group",
                group: {
                    id: { number: 20001, string: "guild-channel", source: "guild-channel" },
                },
            }) as unknown as CommonEvent.Event,
        );

        await protocol.apply("reaction.create", {
            channel_id: "guild-channel",
            message_id: "message-1",
            emoji: "👍",
        });

        expect(adapter.sendGroupMessageReaction).toHaveBeenCalledWith("bot", {
            group_id: expect.objectContaining({ string: "guild-channel" }),
            message_id: expect.objectContaining({ string: "message-1" }),
            reaction: "👍",
            reaction_type: "emoji",
            is_add: true,
        });
    });

    test("converts a group message with channel type 0", () => {
        const { protocol } = createProtocol();
        const event = textMsgEvent({
            message_type: "group",
            group: {
                id: { number: 20001, string: "g20001", source: "g20001" },
                name: "Test Group",
            },
        });
        const result = protocol["convertToSatoriFormat"](event as unknown as CommonEvent.Event);

        expect(result).not.toBeNull();
        expect(result).toMatchObject({
            type: "message-created",
            channel: {
                id: "g20001",
                type: 0,
                name: "Test Group",
            },
            user: {
                id: "u10001",
                name: "Alice",
            },
            message: {
                id: "m50001",
                content: "Hello, world!",
            },
        });
    });

    test("频道消息分别投影服务器与频道地址", () => {
        const { protocol } = createProtocol();
        const event = textMsgEvent({
            message_type: "channel",
            group: {
                id: { number: 30001, string: "channel-1", source: "channel-1" },
                name: "General",
                guild_id: { number: 30000, string: "guild-1", source: "guild-1" },
                channel_id: { number: 30001, string: "channel-1", source: "channel-1" },
            },
        });

        expect(
            protocol["convertToSatoriFormat"](event as unknown as CommonEvent.Event),
        ).toMatchObject({
            type: "message-created",
            guild: { id: "guild-1" },
            channel: { id: "channel-1", type: 0, name: "General" },
        });
    });

    test("private message channel type is 1 (non-group)", () => {
        const { protocol } = createProtocol();
        const event = textMsgEvent({
            message_type: "private",
            group: {
                id: { number: 30001, string: "dm30001", source: "dm30001" },
                name: "DM Channel",
            },
        });
        const result = protocol["convertToSatoriFormat"](event as unknown as CommonEvent.Event);

        expect(result).not.toBeNull();
        expect(result!.channel).toMatchObject({
            id: "dm30001",
            type: 1,
        });
    });

    test("notice group_increase maps to guild-member-added", () => {
        const { protocol } = createProtocol();
        const event = {
            id: { number: 2, string: "e2", source: "e2" },
            timestamp: 1700000000000,
            type: "notice",
            platform: "qq",
            bot_id: { number: 12345678, string: "bot", source: "bot" },
            notice_type: "group_increase",
            user: { id: { number: 10005, string: "u10005", source: "u10005" }, name: "NewUser" },
            group: {
                id: { number: 20001, string: "g20001", source: "g20001" },
                name: "Test Group",
            },
        };
        const result = protocol["convertToSatoriFormat"](event as unknown as CommonEvent.Event);

        expect(result).toMatchObject({
            type: "guild-member-added",
            platform: "qq",
            self_id: "bot",
            timestamp: 1700000000000,
            user: { id: "u10005", name: "NewUser" },
            guild: { id: "g20001", name: "Test Group" },
        });
    });

    test("notice group_decrease maps to guild-member-removed", () => {
        const { protocol } = createProtocol();
        const event = {
            id: { number: 3, string: "e3", source: "e3" },
            timestamp: 1700000000000,
            type: "notice",
            platform: "qq",
            bot_id: { number: 12345678, string: "bot", source: "bot" },
            notice_type: "group_decrease",
            user: { id: { number: 10006, string: "u10006", source: "u10006" }, name: "LeftUser" },
            group: {
                id: { number: 20001, string: "g20001", source: "g20001" },
                name: "Test Group",
            },
        };
        const result = protocol["convertToSatoriFormat"](event as unknown as CommonEvent.Event);

        expect(result).toMatchObject({
            type: "guild-member-removed",
            user: { id: "u10006", name: "LeftUser" },
            guild: { id: "g20001", name: "Test Group" },
        });
    });

    test("notice friend_add does not masquerade as a request", () => {
        const { protocol } = createProtocol();
        const event = {
            id: { number: 4, string: "e4", source: "e4" },
            timestamp: 1700000000000,
            type: "notice",
            platform: "qq",
            bot_id: { number: 12345678, string: "bot", source: "bot" },
            notice_type: "friend_add",
            user: { id: { number: 10007, string: "u10007", source: "u10007" }, name: "NewFriend" },
        };
        const result = protocol["convertToSatoriFormat"](event as unknown as CommonEvent.Event);

        expect(result).toMatchObject({
            type: "internal",
            user: { id: "u10007", name: "NewFriend" },
            _type: "qq.friend_add",
            _data: { notice_type: "friend_add" },
        });
    });

    test("notice unknown type maps to internal", () => {
        const { protocol } = createProtocol();
        const event = {
            id: { number: 5, string: "e5", source: "e5" },
            timestamp: 1700000000000,
            type: "notice",
            platform: "qq",
            bot_id: { number: 12345678, string: "bot", source: "bot" },
            notice_type: "poke",
            user: { id: { number: 10008, string: "u10008", source: "u10008" }, name: "Poker" },
        };
        const result = protocol["convertToSatoriFormat"](event as unknown as CommonEvent.Event);

        expect(result).toMatchObject({
            type: "internal",
            user: { id: "u10008", name: "Poker" },
            _type: "qq.poke",
            _data: { notice_type: "poke" },
        });
    });

    test("request friend type maps to friend-request", () => {
        const { protocol } = createProtocol();
        const event = {
            id: { number: 6, string: "e6", source: "e6" },
            timestamp: 1700000000000,
            type: "request",
            platform: "qq",
            bot_id: { number: 12345678, string: "bot", source: "bot" },
            request_type: "friend",
            user: { id: { number: 10009, string: "u10009", source: "u10009" }, name: "Requester" },
        };
        const result = protocol["convertToSatoriFormat"](event as unknown as CommonEvent.Event);

        expect(result).toMatchObject({
            type: "friend-request",
            platform: "qq",
            self_id: "bot",
            user: { id: "u10009", name: "Requester" },
        });
    });

    test("request group type maps to guild-member-request", () => {
        const { protocol } = createProtocol();
        const event = {
            id: { number: 7, string: "e7", source: "e7" },
            timestamp: 1700000000000,
            type: "request",
            platform: "qq",
            bot_id: { number: 12345678, string: "bot", source: "bot" },
            request_type: "group",
            user: { id: { number: 10010, string: "u10010", source: "u10010" }, name: "GroupReq" },
        };
        const result = protocol["convertToSatoriFormat"](event as unknown as CommonEvent.Event);

        expect(result).toMatchObject({
            type: "guild-member-request",
            user: { id: "u10010", name: "GroupReq" },
        });
    });

    test("meta event maps to internal type", () => {
        const { protocol } = createProtocol();
        const event = {
            id: { number: 8, string: "e8", source: "e8" },
            timestamp: 1700000000000,
            type: "meta",
            platform: "qq",
            bot_id: { number: 12345678, string: "bot", source: "bot" },
            meta_type: "heartbeat",
        };
        const result = protocol["convertToSatoriFormat"](event as unknown as CommonEvent.Event);

        expect(result).toMatchObject({
            type: "internal",
            platform: "qq",
            self_id: "bot",
            timestamp: 1700000000000,
        });
    });

    test("convertMessageContent with text segments returns plain text", () => {
        const { protocol } = createProtocol();
        const segments = [
            { type: "text", data: { text: "Hello " } },
            { type: "text", data: { text: "world!" } },
        ];
        const result = protocol["convertMessageContent"](segments);

        expect(result).toBe("Hello world!");
    });

    test("convertMessageContent with mixed segments produces element tags", () => {
        const { protocol } = createProtocol();
        const segments = [
            { type: "text", data: { text: "Hello " } },
            { type: "at", data: { id: "u10001" } },
            { type: "text", data: { text: " check " } },
            { type: "image", data: { url: "https://example.com/img.jpg", file: "img.jpg" } },
        ];
        const result = protocol["convertMessageContent"](segments);

        expect(result).toBe(
            'Hello <at id="u10001" /> check <image url="https://example.com/img.jpg" file="img.jpg" />',
        );
    });

    test("format wraps payload with type field", () => {
        const { protocol } = createProtocol();
        const result = protocol.format("message-created", {
            platform: "qq",
            self_id: "bot",
        });

        expect(result).toEqual({
            type: "message-created",
            platform: "qq",
            self_id: "bot",
        });
    });

    test("apply returns success response with data", async () => {
        const { protocol, adapter } = createProtocol();
        // Mock getLogin via adapter methods
        adapter.getLoginInfo = vi.fn().mockResolvedValue({
            user_id: { string: "bot", number: 12345678, source: "bot" },
            user_name: "TestBot",
        });

        const result = await protocol.apply("login.get");

        expect(result).toHaveProperty("data");
        expect(result.data).toMatchObject({
            user: { id: "bot", name: "TestBot" },
            self_id: "bot",
            status: 1,
        });
    });

    test("channel 与 guild 资源动作使用真实平台目录 API", async () => {
        const { adapter, protocol } = createProtocol();

        await protocol.apply("channel.get", { channel_id: "channel-1", guild_id: "guild-1" });
        await protocol.apply("channel.list", { guild_id: "guild-1" });
        await protocol.apply("guild.get", { guild_id: "guild-1" });
        await protocol.apply("guild.list");
        await protocol.apply("guild.member.get", { guild_id: "guild-1", user_id: "user-1" });
        await protocol.apply("guild.member.list", { guild_id: "guild-1" });

        expect(adapter.getChannelInfo).toHaveBeenCalledWith("bot", {
            channel_id: expect.objectContaining({ string: "channel-1" }),
            guild_id: expect.objectContaining({ string: "guild-1" }),
        });
        expect(adapter.getChannelList).toHaveBeenCalledWith("bot", {
            guild_id: expect.objectContaining({ string: "guild-1" }),
        });
        expect(adapter.getGuildInfo).toHaveBeenCalled();
        expect(adapter.getGuildList).toHaveBeenCalledWith("bot");
        expect(adapter.getGuildMemberInfo).toHaveBeenCalled();
        expect(adapter.getGuildMemberList).toHaveBeenCalled();
    });

    test("apply returns error message for unknown action", async () => {
        const { protocol } = createProtocol();
        const result = await protocol.apply("unknown.action");

        expect(result).toHaveProperty("message");
        expect(result.message).toContain("Unknown action");
        expect(result.message).toContain("unknown.action");
    });

    test("rejects removed camelCase action aliases", async () => {
        const { protocol } = createProtocol();

        const result = await protocol.apply("getLogin");

        expect(result.message).toContain("Unknown action: getLogin");
    });

    test("dispatch rejects preformatted protocol events", async () => {
        const { protocol } = createProtocol();

        await expect(protocol.dispatch({ type: "message-created" })).rejects.toThrow(
            "只接受 CommonEvent",
        );
    });

    test("stop explicitly removes registered webhook listeners", async () => {
        const { protocol } = createProtocol();
        protocol.config.webhooks = [{ url: "https://example.com/hook" }];

        protocol.start();
        await protocol.stop();

        expect(protocol.off).toHaveBeenCalledWith("dispatch", expect.any(Function));
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
        const result = protocol["convertToSatoriFormat"](event as unknown as CommonEvent.Event);

        expect(result).toBeNull();
    });
});
