import { describe, expect, it } from "vitest";
import { ZulipClient } from "./client.js";
import { projectZulipEvents } from "./events.js";
import type { ZulipConfig } from "./types.js";

const createId = (value: string | number) => ({
    string: String(value),
    source: value,
    number: Number(value) || 1,
});
const context = { botId: createId(5), botUserId: 5, createId };

describe("Zulip 个人设置事件", () => {
    it("Client 监听器保留现代 user_settings 事件类型", () => {
        const config: ZulipConfig = {
            account_id: "bot",
            server_url: "https://example.zulipchat.com",
            email: "bot@example.com",
            api_key: "secret",
            receive_mode: "manual",
        };
        const client = new ZulipClient(config, { transport: async () => ({}) });
        client.on("user_settings", event => expect(event.property).toBe("default_language"));
        client.emit("user_settings", {
            id: 1,
            type: "user_settings",
            op: "update",
            property: "default_language",
            value: "zh_CN",
            language_name: "Chinese (Simplified)",
        });
    });

    it("投影机器人本人的设置字段变化", () => {
        const event = projectZulipEvents(
            {
                id: 2,
                type: "user_settings",
                op: "update",
                property: "high_contrast_mode",
                value: true,
            },
            context,
        )[0];

        expect(event).toMatchObject({
            notice_type: "user_updated",
            sub_type: "settings",
            user: {
                id: { string: "5" },
                changed_property: "high_contrast_mode",
                high_contrast_mode: true,
            },
        });
    });

    it("投影组织新用户默认设置策略变化", () => {
        const event = projectZulipEvents(
            {
                id: 3,
                type: "realm_user_settings_defaults",
                op: "update",
                property: "send_read_receipts",
                value: false,
            },
            context,
        )[0];

        expect(event).toMatchObject({
            notice_type: "default_user_settings_updated",
            sub_type: "settings",
            changed_property: "send_read_receipts",
            value: false,
        });
    });

    it("异常设置事件退回 custom 并保留原始报文", () => {
        const raw = { id: 4, type: "user_settings", op: "update", value: true };
        expect(projectZulipEvents(raw, context)[0]).toMatchObject({
            notice_type: "custom",
            raw_event: raw,
        });
    });
});
