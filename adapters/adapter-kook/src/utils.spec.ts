import { describe, expect, test } from "vitest";
import { parseEvent, parseHello, parseSignal } from "./utils.js";

describe("KOOK 入站报文解析", () => {
    test("信令类型与序列号不做隐式强转", () => {
        expect(() => parseSignal({ s: "0", d: {} })).toThrowError(
            expect.objectContaining({ code: "KOOK_SIGNAL_INVALID" }),
        );
        expect(() => parseSignal({ s: 0, sn: -1, d: {} })).toThrowError(
            expect.objectContaining({ code: "KOOK_SIGNAL_SEQUENCE_INVALID" }),
        );
        expect(parseSignal({ s: 0, sn: 0, d: {} })).toEqual({ s: 0, sn: 0, d: {} });
    });

    test("HELLO 使用独立结构化解析边界", () => {
        expect(parseHello({ code: 0, session_id: "session" })).toEqual({
            code: 0,
            session_id: "session",
        });
        expect(() => parseHello({ code: "0" })).toThrowError(
            expect.objectContaining({ code: "KOOK_HELLO_INVALID" }),
        );
    });

    test("challenge 不伪造成带空 ID 和时间戳的机器人事件", () => {
        expect(
            parseEvent({
                type: 255,
                channel_type: "WEBHOOK_CHALLENGE",
                challenge: "challenge",
                verify_token: "verify",
            }),
        ).toEqual({
            type: 255,
            channel_type: "WEBHOOK_CHALLENGE",
            challenge: "challenge",
            verify_token: "verify",
        });
    });

    test("普通事件拒绝未知枚举和缺失的稳定字段", () => {
        const event = { ...validEvent(), future_field: { enabled: true } };
        expect(parseEvent(event)).toEqual(event);
        expect(() => parseEvent({ ...event, channel_type: "UNKNOWN" })).toThrowError(
            expect.objectContaining({ code: "KOOK_EVENT_KIND_INVALID" }),
        );
        expect(() => parseEvent({ ...event, msg_id: undefined })).toThrowError(
            expect.objectContaining({ code: "KOOK_EVENT_FIELD_INVALID" }),
        );
        expect(() => parseEvent({ ...event, content: undefined })).toThrowError(
            expect.objectContaining({ code: "KOOK_EVENT_FIELD_INVALID" }),
        );
        expect(() => parseEvent({ ...event, msg_timestamp: undefined })).toThrowError(
            expect.objectContaining({ code: "KOOK_EVENT_TIMESTAMP_INVALID" }),
        );
    });
});

function validEvent(): Record<string, unknown> {
    return {
        type: 9,
        channel_type: "GROUP",
        target_id: "channel",
        author_id: "user",
        content: "hello",
        msg_id: "message",
        msg_timestamp: 1_700_000_000_000,
        extra: {},
    };
}
