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

describe("Zulip 频道事件投影", () => {
    it("Client 的 stream 与 subscription 监听器保留精确事件类型", () => {
        const config: ZulipConfig = {
            account_id: "bot",
            server_url: "https://example.zulipchat.com",
            email: "bot@example.com",
            api_key: "secret",
            receive_mode: "manual",
        };
        const client = new ZulipClient(config, { transport: async () => ({}) });
        client.on("stream", event => {
            if (event.op === "update") expect(event.property).toBe("description");
        });
        client.on("subscription", event => {
            if (event.op === "peer_add") expect(event.user_ids).toEqual([11]);
        });

        client.emit("stream", {
            id: 1,
            type: "stream",
            op: "update",
            stream_id: 7,
            name: "engineering",
            property: "description",
            value: "Build things",
        });
        client.emit("subscription", {
            id: 2,
            type: "subscription",
            op: "peer_add",
            stream_ids: [7],
            user_ids: [11],
        });
    });

    it("逐个投影频道创建、更新与现代删除事件", () => {
        const created = projectZulipEvents(
            {
                id: 1,
                type: "stream",
                op: "create",
                streams: [
                    { stream_id: 7, name: "engineering", invite_only: false },
                    { stream_id: 8, name: "release", invite_only: true },
                ],
            },
            context,
        );
        const updated = projectZulipEvents(
            {
                id: 2,
                type: "stream",
                op: "update",
                stream_id: 7,
                name: "engineering",
                property: "description",
                value: "Build things",
                rendered_description: "<p>Build things</p>",
            },
            context,
        );
        const deleted = projectZulipEvents(
            { id: 3, type: "stream", op: "delete", stream_ids: [7, 8] },
            context,
        );

        expect(created).toHaveLength(2);
        expect(created[0]).toMatchObject({
            notice_type: "channel_created",
            resource: { type: "channel", id: { string: "7" }, name: "engineering" },
        });
        expect(updated[0]).toMatchObject({
            notice_type: "channel_updated",
            resource: {
                id: { string: "7" },
                changed_property: "description",
                description: "Build things",
                rendered_description: "<p>Build things</p>",
            },
        });
        expect(deleted.map(event => event.notice_type)).toEqual([
            "channel_deleted",
            "channel_deleted",
        ]);
    });

    it("投影当前用户的订阅新增、删除与属性更新", () => {
        const added = projectZulipEvents(
            {
                id: 4,
                type: "subscription",
                op: "add",
                subscriptions: [{ stream_id: 7, name: "engineering", color: "#a1b2c3" }],
            },
            context,
        )[0];
        const removed = projectZulipEvents(
            {
                id: 5,
                type: "subscription",
                op: "remove",
                subscriptions: [{ stream_id: 7, name: "engineering" }],
            },
            context,
        )[0];
        const updated = projectZulipEvents(
            {
                id: 6,
                type: "subscription",
                op: "update",
                stream_id: 7,
                property: "is_muted",
                value: true,
            },
            context,
        )[0];

        expect(added).toMatchObject({ notice_type: "channel_subscription_added" });
        expect(removed).toMatchObject({ notice_type: "channel_subscription_removed" });
        expect(updated).toMatchObject({
            notice_type: "channel_subscription_updated",
            resource: { id: { string: "7" }, changed_property: "is_muted", is_muted: true },
        });
    });

    it("展开频道与用户笛卡尔积的订阅者变化", () => {
        const events = projectZulipEvents(
            {
                id: 7,
                type: "subscription",
                op: "peer_add",
                stream_ids: [7, 8],
                user_ids: [11, 12],
            },
            context,
        );

        expect(events).toHaveLength(4);
        expect(events.map(event => [event.resource?.id.string, event.user?.id.string])).toEqual([
            ["7", "11"],
            ["7", "12"],
            ["8", "11"],
            ["8", "12"],
        ]);
        expect(events.every(event => event.notice_type === "channel_subscriber_added")).toBe(true);
    });

    it("异常频道报文退回 custom 且不丢失原始事件", () => {
        const raw = { id: 8, type: "stream", op: "delete", streams: [{ stream_id: 7 }] };
        expect(projectZulipEvents(raw, context)[0]).toMatchObject({
            notice_type: "custom",
            sub_type: "delete",
            raw_event: raw,
        });
    });
});
