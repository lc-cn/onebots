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

const { SatoriV1 } = await import("../index.js");

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
          string: typeof id === "string" ? id : resolvedId.string,
        }),
    ),
    getLoginInfo: vi.fn(),
  };

  const protocol = new SatoriV1(
    adapter as never,
    { account_id: "bot" } as never,
    { protocol: "satori", version: "v1", platform: "qq" } as never,
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
      avatar: "https://example.com/avatar.png",
    },
    message: [{ type: "text", data: { text: "Hello, world!" } }],
    raw_message: "Hello, world!",
    message_id: { number: 50001, string: "m50001", source: "m50001" },
    ...overrides,
  };
}

describe("Satori V1 protocol", () => {
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
      group: { id: { number: 20001, string: "g20001", source: "g20001" }, name: "Test Group" },
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
      group: { id: { number: 20001, string: "g20001", source: "g20001" }, name: "Test Group" },
    };
    const result = protocol["convertToSatoriFormat"](event as unknown as CommonEvent.Event);

    expect(result).toMatchObject({
      type: "guild-member-removed",
      user: { id: "u10006", name: "LeftUser" },
      guild: { id: "g20001", name: "Test Group" },
    });
  });

  test("notice friend_add maps to friend-request", () => {
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
      type: "friend-request",
      user: { id: "u10007", name: "NewFriend" },
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

  test("apply returns error message for unknown action", async () => {
    const { protocol } = createProtocol();
    const result = await protocol.apply("unknown.action");

    expect(result).toHaveProperty("message");
    expect(result.message).toContain("Unknown action");
    expect(result.message).toContain("unknown.action");
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
