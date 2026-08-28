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
  };
});

const { MilkyV1 } = await import("../index.js");

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
    resolveId: vi.fn(
      (id: string | number) =>
        ({
          ...resolvedId,
          number: typeof id === "number" ? id : resolvedId.number,
        }),
    ),
    sendMessage: vi.fn(),
    deleteMessage: vi.fn(),
    kickGroupMember: vi.fn(),
    muteGroupMember: vi.fn(),
    setGroupAdmin: vi.fn(),
    setGroupCard: vi.fn(),
    setGroupName: vi.fn(),
    leaveGroup: vi.fn(),
    getLoginInfo: vi.fn(),
    getFriendList: vi.fn(),
    getGroupList: vi.fn(),
    getGroupMemberList: vi.fn(),
  };

  const protocol = new MilkyV1(
    adapter as never,
    { account_id: "bot" } as never,
    { protocol: "milky", version: "v1" } as never,
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

describe("Milky V1 protocol", () => {
  test("converts a private message to native message_receive", () => {
    const { protocol } = createProtocol();
    const event = textMsgEvent();
    const result = protocol["convertToMilkyFormat"](event as unknown as CommonEvent.Event)!;

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      time: 1700000000,
      self_id: 12345678,
      event_type: "message_receive",
      data: {
        message_scene: "friend",
        peer_id: 10001,
        message_seq: 50001,
        sender_id: 10001,
        time: 1700000000,
        segments: [{ type: "text", data: { text: "Hello, world!" } }],
        friend: {
          user_id: 10001,
          nickname: "Alice",
        },
      },
    });
  });

  test("converts a group message with native scene data", () => {
    const { protocol } = createProtocol();
    const event = textMsgEvent({
      message_type: "group",
      group: {
        id: { number: 20001, string: "g20001", source: "g20001" },
        name: "Test Group",
      },
    });
    const result = protocol["convertToMilkyFormat"](event as unknown as CommonEvent.Event)!;

    expect(result).toMatchObject({
      event_type: "message_receive",
      data: {
        message_scene: "group",
        peer_id: 20001,
        message_seq: 50001,
        sender_id: 10001,
        group: { group_id: 20001, group_name: "Test Group" },
      },
    });
  });

  test("preserves all message segments when raw_message is missing", () => {
    const { protocol } = createProtocol();
    const event = textMsgEvent({
      raw_message: undefined,
      message: [
        { type: "text", data: { text: "Hello" } },
        { type: "image", data: { url: "http://example.com/img.png" } },
        { type: "text", data: { text: " World" } },
      ],
    });
    const result = protocol["convertToMilkyFormat"](event as unknown as CommonEvent.Event)!;

    if (result.event_type !== "message_receive") {
      throw new Error("期望转换为消息事件");
    }
    expect(result.data.segments).toEqual([
      { type: "text", data: { text: "Hello" } },
      { type: "image", data: { url: "http://example.com/img.png" } },
      { type: "text", data: { text: " World" } },
    ]);
  });

  test("converts a group increase notice to native event data", () => {
    const { protocol } = createProtocol();
    const event = {
      id: { number: 2, string: "e2", source: "e2" },
      timestamp: 1700000000000,
      type: "notice",
      platform: "qq",
      bot_id: { number: 12345678, string: "bot", source: "bot" },
      notice_type: "group_increase",
      user: { id: { number: 10005, string: "u10005", source: "u10005" } },
      operator: { id: { number: 10001, string: "op10001", source: "op10001" } },
      group: { id: { number: 20001, string: "g20001", source: "g20001" } },
    };
    const result = protocol["convertToMilkyFormat"](event as unknown as CommonEvent.Event)!;

    expect(result).toMatchObject({
      time: 1700000000,
      self_id: 12345678,
      event_type: "group_member_increase",
      data: {
        user_id: 10005,
        operator_id: 10001,
        group_id: 20001,
      },
    });
  });

  test("converts a friend request to native friend_request", () => {
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
    const result = protocol["convertToMilkyFormat"](event as unknown as CommonEvent.Event)!;

    expect(result).toMatchObject({
      time: 1700000000,
      self_id: 12345678,
      event_type: "friend_request",
      data: {
        initiator_id: 20002,
        initiator_uid: "req-flag-001",
        comment: "hello",
        is_filtered: false,
      },
    });
  });

  test("converts lifecycle meta event to native bot event", () => {
    const { protocol } = createProtocol();
    const event = {
      id: { number: 4, string: "e4", source: "e4" },
      timestamp: 1700000000000,
      type: "meta",
      platform: "qq",
      bot_id: { number: 12345678, string: "bot", source: "bot" },
      meta_type: "lifecycle",
      sub_type: "disable",
    };
    const result = protocol["convertToMilkyFormat"](event as unknown as CommonEvent.Event)!;

    expect(result).toMatchObject({
      time: 1700000000,
      self_id: 12345678,
      event_type: "bot_offline",
      data: {},
    });
  });

  test("does not invent Milky events for online lifecycle or heartbeat metadata", () => {
    const { protocol } = createProtocol();
    const base = {
      id: { number: 4, string: "e4", source: "e4" },
      timestamp: 1700000000000,
      type: "meta",
      platform: "qq",
      bot_id: { number: 12345678, string: "bot", source: "bot" },
    };

    expect(protocol["convertToMilkyFormat"]({
      ...base,
      meta_type: "lifecycle",
      sub_type: "connect",
    } as unknown as CommonEvent.Event)).toBeNull();
    expect(protocol["convertToMilkyFormat"]({
      ...base,
      meta_type: "heartbeat",
    } as unknown as CommonEvent.Event)).toBeNull();
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
    const result = protocol["convertToMilkyFormat"](event as unknown as CommonEvent.Event)!;

    expect(result).toBeNull();
  });

  test("extractPlainText filters only text segments and joins them", () => {
    const { protocol } = createProtocol();
    const segments = [
      { type: "text", data: { text: "Hello " } },
      { type: "image", data: { url: "http://example.com/img.png" } },
      { type: "at", data: { qq: "12345" } },
      { type: "text", data: { text: "World" } },
    ];
    const result = protocol["extractPlainText"](segments);

    expect(result).toBe("Hello World");
  });

  test("extractPlainText returns empty string when no text segments exist", () => {
    const { protocol } = createProtocol();
    const segments = [
      { type: "image", data: { url: "http://example.com/img.png" } },
      { type: "face", data: { id: "123" } },
    ];
    const result = protocol["extractPlainText"](segments);

    expect(result).toBe("");
  });

  test("format wraps payload as a native event", () => {
    const { protocol } = createProtocol();
    const payload = { foo: "bar", count: 42 };
    const result = protocol.format("message", payload);

    expect(result).toEqual({
      time: expect.any(Number),
      self_id: 0,
      event_type: "message",
      data: { foo: "bar", count: 42 },
    });
  });

  test("apply supports native send_private_message", async () => {
    const { protocol, adapter } = createProtocol();
    adapter.sendMessage = vi.fn().mockResolvedValue({
      message_id: { string: "msg-001", number: 9001 },
    });

    const result = await protocol.apply("send_private_message", {
      user_id: 10001,
      message: [{ type: "text", data: { text: "hi" } }],
    });

    expect(result).toMatchObject({
      status: "ok",
      retcode: 0,
      data: { message_seq: 9001, time: expect.any(Number) },
    });
    expect(adapter.sendMessage).toHaveBeenCalledWith("bot", {
      scene_type: "private",
      scene_id: expect.objectContaining({ number: 10001 }),
      message: [{ type: "text", data: { text: "hi" } }],
    });
  });

  test("apply maps native recall and group administration actions", async () => {
    const { protocol, adapter } = createProtocol();

    await expect(protocol.apply("recall_group_message", {
      group_id: 20001,
      message_seq: 9001,
    })).resolves.toMatchObject({ status: "ok" });
    await expect(protocol.apply("kick_group_member", {
      group_id: 20001,
      user_id: 10001,
      reject_add_request: true,
    })).resolves.toMatchObject({ status: "ok" });
    await expect(protocol.apply("set_group_member_mute", {
      group_id: 20001,
      user_id: 10001,
      duration: 60,
    })).resolves.toMatchObject({ status: "ok" });

    expect(adapter.deleteMessage).toHaveBeenCalledWith("bot", expect.objectContaining({
      scene_type: "group",
      message_id: expect.objectContaining({ number: 9001 }),
    }));
    expect(adapter.kickGroupMember).toHaveBeenCalledWith("bot", expect.objectContaining({
      reject_add_request: true,
    }));
    expect(adapter.muteGroupMember).toHaveBeenCalledWith("bot", expect.objectContaining({
      duration: 60,
    }));
  });

  test("apply returns native Milky wrappers for login and list actions", async () => {
    const { protocol, adapter } = createProtocol();
    adapter.getLoginInfo.mockResolvedValue({
      user_id: { string: "bot", number: 12345678 },
      user_name: "Milky Bot",
    });
    adapter.getFriendList.mockResolvedValue([{
      user_id: { string: "friend", number: 10001 },
      user_name: "Alice",
      remark: "A",
    }]);
    adapter.getGroupList.mockResolvedValue([{
      group_id: { string: "group", number: 20001 },
      group_name: "Test Group",
      member_count: 2,
      max_member_count: 500,
    }]);
    adapter.getGroupMemberList.mockResolvedValue([{
      group_id: { string: "group", number: 20001 },
      user_id: { string: "friend", number: 10001 },
      user_name: "Alice",
      card: "Admin",
      role: "admin",
    }]);

    await expect(protocol.apply("get_login_info", {})).resolves.toMatchObject({
      data: { uin: 12345678, nickname: "Milky Bot" },
    });
    await expect(protocol.apply("get_friend_list", {})).resolves.toMatchObject({
      data: { friends: [{ user_id: 10001 }] },
    });
    await expect(protocol.apply("get_group_list", {})).resolves.toMatchObject({
      data: { groups: [{ group_id: 20001 }] },
    });
    await expect(protocol.apply("get_group_member_list", { group_id: 20001 })).resolves.toMatchObject({
      data: { members: [{ group_id: 20001, user_id: 10001 }] },
    });
  });

  test("apply returns failure for unknown action", async () => {
    const { protocol } = createProtocol();
    const result = await protocol.apply("nonexistent_action", {});

    expect(result).toMatchObject({
      status: "failed",
      retcode: -1,
    });
    expect(result.message).toContain("Unknown action");
  });

  test("filterFn always returns true", () => {
    const { protocol } = createProtocol();

    expect(protocol.filterFn({})).toBe(true);
    expect(protocol.filterFn({ post_type: "message" })).toBe(true);
    expect(protocol.filterFn({ anything: "at all" })).toBe(true);
  });

  test("isMilkyShapedEvent detects objects with string event_type", () => {
    const { protocol } = createProtocol();

    expect(protocol["isMilkyShapedEvent"]({ event_type: "message_receive" })).toBe(true);
    expect(protocol["isMilkyShapedEvent"]({ event_type: "bot_offline", data: {} })).toBe(true);
  });

  test("isMilkyShapedEvent rejects non-objects and objects without event_type", () => {
    const { protocol } = createProtocol();

    expect(protocol["isMilkyShapedEvent"](null)).toBe(false);
    expect(protocol["isMilkyShapedEvent"](undefined)).toBe(false);
    expect(protocol["isMilkyShapedEvent"]("string")).toBe(false);
    expect(protocol["isMilkyShapedEvent"](42)).toBe(false);
    expect(protocol["isMilkyShapedEvent"]({})).toBe(false);
    expect(protocol["isMilkyShapedEvent"]({ event_type: 123 })).toBe(false);
  });
});
