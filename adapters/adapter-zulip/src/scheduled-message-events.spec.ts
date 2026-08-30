import { describe, expect, it } from "vitest";
import { ZulipClient } from "./client.js";
import { projectZulipEvents } from "./events.js";
import type { ZulipConfig } from "./types.js";

const createId = (value: string | number) => ({
    string: String(value),
    source: value,
    number: Number(value) || 1,
});
const context = { botId: createId(1), botUserId: 1, createId };
const message = {
    scheduled_message_id: 17,
    type: "stream" as const,
    to: 7,
    topic: "release",
    content: "Ship it",
    rendered_content: "<p>Ship it</p>",
    scheduled_delivery_timestamp: 2_000_000_000,
    failed: false,
};

describe("Zulip 定时消息事件投影", () => {
    it("Client 监听器保留 add/update/remove 判别联合类型", () => {
        const config: ZulipConfig = {
            account_id: "bot",
            server_url: "https://example.zulipchat.com",
            email: "bot@example.com",
            api_key: "secret",
            receive_mode: "manual",
        };
        const client = new ZulipClient(config, { transport: async () => ({}) });
        client.on("scheduled_messages", event => {
            if (event.op === "update") expect(event.scheduled_message.failed).toBe(false);
        });
        client.emit("scheduled_messages", {
            id: 1,
            type: "scheduled_messages",
            op: "update",
            scheduled_message: message,
        });
    });

    it("逐个投影新增定时消息并保留完整资源", () => {
        const events = projectZulipEvents(
            {
                id: 2,
                type: "scheduled_messages",
                op: "add",
                scheduled_messages: [message, { ...message, scheduled_message_id: 18 }],
            },
            context,
        );

        expect(events).toHaveLength(2);
        expect(events[0]).toMatchObject({
            notice_type: "scheduled_message_created",
            resource: {
                type: "scheduled_message",
                id: { string: "17" },
                topic: "release",
                content: "Ship it",
                failed: false,
            },
        });
    });

    it("投影定时消息更新与删除", () => {
        const updated = projectZulipEvents(
            {
                id: 3,
                type: "scheduled_messages",
                op: "update",
                scheduled_message: { ...message, failed: true },
            },
            context,
        )[0];
        const removed = projectZulipEvents(
            {
                id: 4,
                type: "scheduled_messages",
                op: "remove",
                scheduled_message_id: 17,
            },
            context,
        )[0];

        expect(updated).toMatchObject({
            notice_type: "scheduled_message_updated",
            resource: { id: { string: "17" }, failed: true },
        });
        expect(removed).toMatchObject({
            notice_type: "scheduled_message_removed",
            resource: { id: { string: "17" } },
        });
    });

    it("异常报文退回 custom 且不丢失原始事件", () => {
        const raw = { id: 5, type: "scheduled_messages", op: "remove" };
        expect(projectZulipEvents(raw, context)[0]).toMatchObject({
            notice_type: "custom",
            sub_type: "remove",
            raw_event: raw,
        });
    });
});
