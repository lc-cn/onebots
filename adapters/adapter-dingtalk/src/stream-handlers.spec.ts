import { EventAck } from "dingtalk-stream";
import { describe, expect, it, vi } from "vitest";
import { registerDingTalkStreamHandlers } from "./stream-handlers.js";

describe("registerDingTalkStreamHandlers", () => {
    it("CALLBACK 只在业务成功后确认", () => {
        const stream = fakeStream();
        const robot = vi.fn().mockImplementationOnce(() => {
            throw new Error("dispatch failed");
        });
        const error = vi.fn();
        registerDingTalkStreamHandlers(stream.api as never, {
            isCurrent: () => true,
            robot,
            card: vi.fn(),
            event: vi.fn(),
            error,
        });
        const message = downstream(JSON.stringify(robotMessage()));

        stream.callbacks.get("/v1.0/im/bot/messages/get")?.(message);
        stream.callbacks.get("/v1.0/im/bot/messages/get")?.(message);

        expect(stream.respond).toHaveBeenNthCalledWith(1, "message-1", { success: false });
        expect(stream.respond).toHaveBeenNthCalledWith(2, "message-1", { success: true });
        expect(error).toHaveBeenCalledWith(
            expect.objectContaining({ code: "DINGTALK_ROBOT_DELIVERY_FAILED" }),
        );
    });

    it("EVENT 处理失败返回 LATER", () => {
        const stream = fakeStream();
        registerDingTalkStreamHandlers(stream.api as never, {
            isCurrent: () => true,
            robot: vi.fn(),
            card: vi.fn(),
            event: () => {
                throw new Error("dispatch failed");
            },
            error: vi.fn(),
        });

        expect(stream.event?.(downstream("{}"))).toMatchObject({ status: EventAck.LATER });
    });
});

function fakeStream() {
    type Downstream = ReturnType<typeof downstream>;
    type CallbackHandler = (message: Downstream) => void;
    type EventHandler = (message: Downstream) => { status: EventAck; message?: string };
    const callbacks = new Map<string, CallbackHandler>();
    let event: EventHandler | undefined;
    const respond = vi.fn();
    return {
        callbacks,
        respond,
        get event() {
            return event;
        },
        api: {
            registerCallbackListener: (topic: string, handler: CallbackHandler) => {
                callbacks.set(topic, handler);
            },
            registerAllEventListener: (handler: EventHandler) => {
                event = handler;
            },
            socketCallBackResponse: respond,
        },
    };
}

function downstream(data: string) {
    return {
        type: "EVENT",
        data,
        headers: {
            messageId: "message-1",
            topic: "topic",
            eventType: "user_add_org",
            eventId: "event-1",
            time: "1",
        },
    };
}

function robotMessage() {
    return {
        conversationId: "cid",
        conversationType: "2",
        msgId: "msg-1",
        msgtype: "text",
        createAt: 1,
        senderId: "user-1",
    };
}
