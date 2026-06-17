import { describe, expect, test, vi } from "vitest";

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
      public adapter: any,
      public account: any,
      public config: any,
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

const { OneBotV11Protocol } = await import("../index.js");

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
        }) as any,
    ),
  };

  const protocol = new OneBotV11Protocol(
    adapter as any,
    { account_id: "bot" } as any,
    { protocol: "onebot", version: "v11" } as any,
  );

  return { adapter, protocol, resolvedId };
}

// Helper to build realistic CommonEvent.Message objects
function textMsgEvent(overrides: Record<string, any> = {}) {
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

describe("OneBot V11 message format conversion", () => {
  test("converts a private text message", () => {
    const { protocol } = createProtocol();
    const event = textMsgEvent();
    const result = protocol["convertToV11Format"](event as any);

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      time: 1700000000,
      self_id: 12345678,
      post_type: "message",
      message_type: "private",
      sub_type: "friend",
      message_id: 50001,
      user_id: 10001,
      message: [{ type: "text", data: { text: "Hello, world!" } }],
      raw_message: "Hello, world!",
      font: 0,
      sender: {
        user_id: 10001,
        nickname: "Alice",
      },
    });
    // The spread from event.sender (excluding id) adds name:"Alice"
    expect(result.sender.name).toBe("Alice");
  });

  test("converts a group text message with group_id", () => {
    const { protocol } = createProtocol();
    const event = textMsgEvent({
      message_type: "group",
      group: {
        id: { number: 20001, string: "g20001", source: "g20001" },
        name: "Test Group",
      },
    });
    const result = protocol["convertToV11Format"](event as any);

    expect(result).toMatchObject({
      post_type: "message",
      message_type: "group",
      sub_type: "normal",
      group_id: 20001,
      message_id: 50001,
      user_id: 10001,
    });
  });

  test("maps channel message_type to group", () => {
    const { protocol } = createProtocol();
    const event = textMsgEvent({
      message_type: "channel",
      group: {
        id: { number: 30001, string: "c30001", source: "c30001" },
        name: "Channel",
      },
    });
    const result = protocol["convertToV11Format"](event as any);

    expect(result.message_type).toBe("group");
    expect(result.sub_type).toBe("normal");
    expect(result.group_id).toBe(30001);
  });

  test("maps direct message_type to group", () => {
    const { protocol } = createProtocol();
    const event = textMsgEvent({
      message_type: "direct",
      group: {
        id: { number: 30002, string: "d30002", source: "d30002" },
        name: "Direct",
      },
    });
    const result = protocol["convertToV11Format"](event as any);

    expect(result.message_type).toBe("group");
    expect(result.sub_type).toBe("normal");
    expect(result.group_id).toBe(30002);
  });

  test("converts image segment with file and url", () => {
    const { protocol } = createProtocol();
    const event = textMsgEvent({
      message_type: "group",
      group: { id: { number: 20001, string: "g20001", source: "g20001" } },
      message: [
        {
          type: "image",
          data: {
            file: "abc.jpg",
            url: "https://example.com/img.jpg",
          },
        },
      ],
      raw_message: "[CQ:image,file=abc.jpg]",
    });
    const result = protocol["convertToV11Format"](event as any);

    expect(result.message).toEqual([
      {
        type: "image",
        data: { file: "abc.jpg", url: "https://example.com/img.jpg" },
      },
    ]);
  });

  test("converts at segment", () => {
    const { protocol } = createProtocol();
    const event = textMsgEvent({
      message_type: "group",
      group: { id: { number: 20001, string: "g20001", source: "g20001" } },
      message: [
        { type: "at", data: { qq: "12345" } },
        { type: "text", data: { text: " hello" } },
      ],
      raw_message: "[CQ:at,qq=12345] hello",
    });
    const result = protocol["convertToV11Format"](event as any);

    expect(result.message).toEqual([
      { type: "at", data: { qq: "12345" } },
      { type: "text", data: { text: " hello" } },
    ]);
  });

  test("converts reply segment", () => {
    const { protocol } = createProtocol();
    const event = textMsgEvent({
      message: [
        { type: "reply", data: { id: "99999" } },
        { type: "text", data: { text: " replied message" } },
      ],
      raw_message: "[CQ:reply,id=99999] replied message",
    });
    const result = protocol["convertToV11Format"](event as any);

    expect(result.message).toEqual([
      { type: "reply", data: { id: "99999" } },
      { type: "text", data: { text: " replied message" } },
    ]);
  });

  test("converts face/emoji segment", () => {
    const { protocol } = createProtocol();
    const event = textMsgEvent({
      message_type: "group",
      group: { id: { number: 20001, string: "g20001", source: "g20001" } },
      message: [{ type: "face", data: { id: "123" } }],
      raw_message: "[CQ:face,id=123]",
    });
    const result = protocol["convertToV11Format"](event as any);

    expect(result.message).toEqual([
      { type: "face", data: { id: "123" } },
    ]);
  });

  test("converts mixed segments in one message", () => {
    const { protocol } = createProtocol();
    const event = textMsgEvent({
      message_type: "group",
      group: { id: { number: 20001, string: "g20001", source: "g20001" } },
      message: [
        { type: "text", data: { text: "Hey " } },
        { type: "at", data: { qq: "10001" } },
        { type: "text", data: { text: ", check this: " } },
        { type: "image", data: { file: "pic.jpg" } },
        { type: "face", data: { id: "14" } },
      ],
      raw_message: "Hey [CQ:at,qq=10001], check this: [CQ:image,file=pic.jpg][CQ:face,id=14]",
    });
    const result = protocol["convertToV11Format"](event as any);

    expect(result.message).toHaveLength(5);
    expect(result.message[1]).toEqual({ type: "at", data: { qq: "10001" } });
    expect(result.message[3]).toEqual({ type: "image", data: { file: "pic.jpg" } });
    expect(result.message[4]).toEqual({ type: "face", data: { id: "14" } });
  });

  test("falls back to segmentsToString when raw_message is missing", () => {
    const { protocol } = createProtocol();
    const event = textMsgEvent({
      raw_message: undefined,
      message: [
        { type: "text", data: { text: "Hello" } },
      ],
    });
    const result = protocol["convertToV11Format"](event as any);

    expect(result.raw_message).toBe("Hello");
  });

  test("uses sender.name as nickname", () => {
    const { protocol } = createProtocol();
    const event = textMsgEvent({
      sender: {
        id: { number: 10001, string: "u10001", source: "u10001" },
        name: "Bob",
      },
    });
    const result = protocol["convertToV11Format"](event as any);

    expect(result.sender.nickname).toBe("Bob");
    expect(result.sender.name).toBe("Bob"); // from spread
  });

  test("returns empty nickname when sender.name is missing", () => {
    const { protocol } = createProtocol();
    const event = textMsgEvent({
      sender: {
        id: { number: 10001, string: "u10001", source: "u10001" },
      },
    });
    const result = protocol["convertToV11Format"](event as any);

    expect(result.sender.nickname).toBe("");
  });

  test("passes through extra sender fields via spread", () => {
    const { protocol } = createProtocol();
    const event = textMsgEvent({
      sender: {
        id: { number: 10001, string: "u10001", source: "u10001" },
        name: "Alice",
        sex: "female",
        age: 25,
      },
    });
    const result = protocol["convertToV11Format"](event as any);

    // sender has user_id, nickname AND the spread fields (minus id)
    expect(result.sender.sex).toBe("female");
    expect(result.sender.age).toBe(25);
    // id should NOT leak into V11 sender
    expect(result.sender.id).toBeUndefined();
  });

  test("notice events are converted with user_id / operator_id / group_id", () => {
    const { protocol } = createProtocol();
    const event = {
      id: { number: 2, string: "e2", source: "e2" },
      timestamp: 1700000000000,
      type: "notice",
      platform: "qq",
      bot_id: { number: 12345678, string: "bot", source: "bot" },
      notice_type: "group_increase",
      user: { id: { number: 10005 } },
      operator: { id: { number: 10001 } },
      group: { id: { number: 20001 } },
    };
    const result = protocol["convertToV11Format"](event as any);

    expect(result).toMatchObject({
      time: 1700000000,
      self_id: 12345678,
      post_type: "notice",
      notice_type: "group_increase",
      user_id: 10005,
      operator_id: 10001,
      group_id: 20001,
    });
  });

  test("request events are converted with user_id / comment / flag / group_id", () => {
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
    const result = protocol["convertToV11Format"](event as any);

    expect(result).toMatchObject({
      time: 1700000000,
      self_id: 12345678,
      post_type: "request",
      request_type: "friend",
      user_id: 20002,
      comment: "hello",
      flag: "req-flag-001",
    });
  });

  test("meta events are converted with meta_event_type and sub_type", () => {
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
    const result = protocol["convertToV11Format"](event as any);

    expect(result).toMatchObject({
      time: 1700000000,
      self_id: 12345678,
      post_type: "meta_event",
      meta_event_type: "heartbeat",
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
    const result = protocol["convertToV11Format"](event as any);

    expect(result).toBeNull();
  });
});
