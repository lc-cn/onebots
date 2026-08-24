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
  test("converts a private text message with string IDs", () => {
    const { protocol } = createProtocol();
    const event = textMsgEvent();
    const result = protocol["convertToMilkyFormat"](event as unknown as CommonEvent.Event)!;

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      time: 1700000000,
      self_id: "bot",
      post_type: "message",
      message_type: "private",
      message_id: "m50001",
      user_id: "u10001",
      message: [{ type: "text", data: { text: "Hello, world!" } }],
      raw_message: "Hello, world!",
      font: 0,
      sender: {
        user_id: "u10001",
        nickname: "Alice",
      },
    });
  });

  test("converts a group text message with group_id string", () => {
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
      post_type: "message",
      message_type: "group",
      group_id: "g20001",
      message_id: "m50001",
      user_id: "u10001",
    });
  });

  test("falls back to extractPlainText when raw_message is missing", () => {
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

    if (result.post_type !== "message") {
      throw new Error("期望转换为消息事件");
    }
    expect(result.raw_message).toBe("Hello World");
  });

  test("converts notice event with user_id / group_id / operator_id strings", () => {
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
      self_id: "bot",
      post_type: "notice",
      notice_type: "group_increase",
      user_id: "u10005",
      operator_id: "op10001",
      group_id: "g20001",
    });
  });

  test("converts request event with user_id / comment / flag / group_id strings", () => {
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
      self_id: "bot",
      post_type: "request",
      request_type: "friend",
      user_id: "u20002",
      comment: "hello",
      flag: "req-flag-001",
    });
  });

  test("converts meta event with meta_event_type", () => {
    const { protocol } = createProtocol();
    const event = {
      id: { number: 4, string: "e4", source: "e4" },
      timestamp: 1700000000000,
      type: "meta",
      platform: "qq",
      bot_id: { number: 12345678, string: "bot", source: "bot" },
      meta_type: "heartbeat",
    };
    const result = protocol["convertToMilkyFormat"](event as unknown as CommonEvent.Event)!;

    expect(result).toMatchObject({
      time: 1700000000,
      self_id: "bot",
      post_type: "meta_event",
      meta_event_type: "heartbeat",
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

  test("format wraps payload with post_type", () => {
    const { protocol } = createProtocol();
    const payload = { foo: "bar", count: 42 };
    const result = protocol.format("message", payload);

    expect(result).toEqual({
      foo: "bar",
      count: 42,
      post_type: "message",
    });
  });

  test("apply returns success response structure", async () => {
    const { protocol, adapter } = createProtocol();
    adapter.sendMessage = vi.fn().mockResolvedValue({
      message_id: { string: "msg-001" },
    });

    const result = await protocol.apply("send_private_msg", {
      user_id: "u10001",
      message: [{ type: "text", data: { text: "hi" } }],
    });

    expect(result).toMatchObject({
      status: "ok",
      retcode: 0,
    });
    expect(result.data).toBeDefined();
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

  test("isMilkyShapedEvent detects objects with string post_type", () => {
    const { protocol } = createProtocol();

    expect(protocol["isMilkyShapedEvent"]({ post_type: "message" })).toBe(true);
    expect(protocol["isMilkyShapedEvent"]({ post_type: "notice", extra: 1 })).toBe(true);
  });

  test("isMilkyShapedEvent rejects non-objects and objects without post_type", () => {
    const { protocol } = createProtocol();

    expect(protocol["isMilkyShapedEvent"](null)).toBe(false);
    expect(protocol["isMilkyShapedEvent"](undefined)).toBe(false);
    expect(protocol["isMilkyShapedEvent"]("string")).toBe(false);
    expect(protocol["isMilkyShapedEvent"](42)).toBe(false);
    expect(protocol["isMilkyShapedEvent"]({})).toBe(false);
    expect(protocol["isMilkyShapedEvent"]({ post_type: 123 })).toBe(false);
  });
});
