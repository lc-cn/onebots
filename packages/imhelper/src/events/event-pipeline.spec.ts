import { describe, expect, test, vi } from "vitest";
import { Adapter } from "../adapter.js";
import { createImHelper } from "../index.js";
import { EventFactory } from "./factory.js";
import { EventListenerUtils, EventUtils } from "./utils.js";

class TestAdapter extends Adapter<string> {
    readonly selfId = "bot";
}

const privateMessage = {
    timestamp: 1_700_000_000,
    bot_id: "bot",
    message_id: "message-1",
    user_id: "user-1",
    message_type: "private" as const,
    content: [{ type: "text", data: { text: "hello" } }],
};

describe("typed event pipeline", () => {
    test("constructs and serializes a typed event without leaking helper state", () => {
        const client = createImHelper(new TestAdapter());
        const event = EventFactory.createFromUnknown(
            "message.private",
            { ...privateMessage, helper: "malicious", injected: true },
            client,
        );

        expect(EventUtils.isPrivateMessage(event)).toBe(true);
        expect(event.toJSON()).toEqual({
            ...privateMessage,
            type: "message",
        });
        expect(event.toJSON()).not.toHaveProperty("helper");
        expect(event).not.toHaveProperty("injected");
        expect(event.helper).toBe(client);
    });

    test("rejects unknown adapter input at the factory seam", () => {
        const client = createImHelper(new TestAdapter());

        expect(() =>
            EventFactory.createFromUnknown("message.private", { timestamp: "invalid" }, client),
        ).toThrow("缺少有效的 timestamp");
    });

    test("defines empty listener collections instead of leaving pending promises", async () => {
        const client = createImHelper(new TestAdapter());

        await expect(EventListenerUtils.all(client, [])).resolves.toEqual([]);
        await expect(EventListenerUtils.race(client, [])).rejects.toThrow("至少需要一个事件名");
    });

    test("cleans listeners after a typed event race resolves", async () => {
        const adapter = new TestAdapter();
        const client = createImHelper(adapter);
        const result = EventListenerUtils.race(
            client,
            ["message.private", "meta.lifecycle"],
            1_000,
        );

        adapter.emit("message.private", privateMessage);

        await expect(result).resolves.toMatchObject({
            type: "message.private",
            event: { message_id: "message-1" },
        });
        expect(client.listenerCount("message.private")).toBe(0);
        expect(client.listenerCount("meta.lifecycle")).toBe(0);
    });

    test("condition listener returns an idempotent disposer", () => {
        const adapter = new TestAdapter();
        const client = createImHelper(adapter);
        const listener = vi.fn();
        const dispose = EventListenerUtils.onCondition(
            client,
            "message.private",
            event => event.user_id === "user-1",
            listener,
        );

        adapter.emit("message.private", privateMessage);
        dispose();
        dispose();
        adapter.emit("message.private", privateMessage);

        expect(listener).toHaveBeenCalledTimes(1);
    });
});
