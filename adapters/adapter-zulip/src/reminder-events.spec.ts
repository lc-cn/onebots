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
const reminder = {
    reminder_id: 17,
    type: "private" as const,
    to: [1],
    content: "Reminder for message 42",
    rendered_content: "<p>Reminder for message 42</p>",
    scheduled_delivery_timestamp: 2_000_000_000,
    failed: false,
    reminder_target_message_id: 42,
};

describe("Zulip 提醒事件投影", () => {
    it("Client 监听器保留 add/remove 判别联合类型", () => {
        const config: ZulipConfig = {
            account_id: "bot",
            server_url: "https://example.zulipchat.com",
            email: "bot@example.com",
            api_key: "secret",
            receive_mode: "manual",
        };
        const client = new ZulipClient(config, { transport: async () => ({}) });
        client.on("reminders", event => {
            if (event.op === "add") expect(event.reminders[0]?.reminder_id).toBe(17);
        });
        client.emit("reminders", {
            id: 1,
            type: "reminders",
            op: "add",
            reminders: [reminder],
        });
    });

    it("逐个投影提醒新增并关联原消息", () => {
        const events = projectZulipEvents(
            {
                id: 2,
                type: "reminders",
                op: "add",
                reminders: [reminder, { ...reminder, reminder_id: 18 }],
            },
            context,
        );

        expect(events).toHaveLength(2);
        expect(events[0]).toMatchObject({
            notice_type: "reminder_created",
            resource: {
                type: "reminder",
                id: { string: "17" },
                reminder_target_message_id: 42,
                failed: false,
            },
        });
    });

    it("投影提醒删除并为异常报文保留 custom 退路", () => {
        expect(
            projectZulipEvents(
                { id: 3, type: "reminders", op: "remove", reminder_id: 17 },
                context,
            )[0],
        ).toMatchObject({
            notice_type: "reminder_removed",
            resource: { type: "reminder", id: { string: "17" } },
        });
        const raw = { id: 4, type: "reminders", op: "remove" };
        expect(projectZulipEvents(raw, context)[0]).toMatchObject({
            notice_type: "custom",
            raw_event: raw,
        });
    });
});
