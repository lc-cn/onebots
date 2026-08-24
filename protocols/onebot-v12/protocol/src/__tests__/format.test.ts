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
    resolveId: vi.fn(
      (id: string | number) =>
        ({
          ...resolvedId,
          number: typeof id === "number" ? id : resolvedId.number,
        }),
    ),
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
    expect(result.message).toEqual([
      { type: "text", data: { text: "Hello, world!" } },
    ]);
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
      },
    });
    const result = protocol["convertToV12Format"](event as unknown as CommonEvent.Event)!;

    expect(result.type).toBe("message");
    expect(result.detail_type).toBe("channel");
    expect(result.sub_type).toBe("");
    expect((result as unknown as Record<string, unknown>).group_id).toBe("c30001");
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
