import { describe, expect, it } from "vitest";
import { projectZulipEvents } from "./events.js";

const createId = (value: string | number) => ({
    string: String(value),
    source: value,
    number: Number(value) || 1,
});
const context = { botId: createId(1), botUserId: 1, createId };

describe("Zulip 活动事件投影", () => {
    it("展开现代批量 Presence 并保留服务端时间", () => {
        const events = projectZulipEvents(
            {
                id: 1,
                type: "presence",
                server_timestamp: 100.5,
                presences: {
                    "11": { active_timestamp: 100, idle_timestamp: 99 },
                    "12": { active_timestamp: 98, idle_timestamp: 98 },
                },
            },
            context,
        );
        expect(events).toHaveLength(2);
        expect(events[0]).toMatchObject({
            timestamp: 100_500,
            notice_type: "user_updated",
            sub_type: "presence_online",
            user: { id: { string: "11" }, presence: { active_timestamp: 100 } },
        });
    });

    it("投影个人话题可见性与频道输入状态", () => {
        const topic = projectZulipEvents(
            {
                id: 2,
                type: "user_topic",
                stream_id: 7,
                topic_name: "release",
                last_updated: 100,
                visibility_policy: 3,
            },
            context,
        )[0];
        const typing = projectZulipEvents(
            {
                id: 3,
                type: "typing",
                op: "start",
                message_type: "stream",
                sender: { user_id: 11, email: "user@example.com" },
                stream_id: 7,
                topic: "release",
            },
            context,
        )[0];
        expect(topic).toMatchObject({
            notice_type: "topic_visibility_updated",
            sub_type: "followed",
            resource: { type: "topic", id: { string: "7/release" } },
        });
        expect(typing).toMatchObject({
            notice_type: "typing_started",
            user: { id: { string: "11" } },
            group: { id: { string: "7/release" } },
        });
    });

    it("异常活动报文退回 custom", () => {
        expect(
            projectZulipEvents({ id: 4, type: "typing", op: "start" }, context)[0],
        ).toMatchObject({
            notice_type: "custom",
        });
    });
});
