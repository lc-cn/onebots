import { describe, expect, it, vi } from "vitest";
import { ZulipClient } from "./client.js";
import { executeZulipPlatformAction } from "./platform-actions.js";
import type { ZulipConfig } from "./types.js";

const config: ZulipConfig = {
    account_id: "bot",
    server_url: "https://example.zulipchat.com",
    email: "bot@example.com",
    api_key: "secret",
};

describe("Zulip 消息扩展动作", () => {
    it("按现代范围模式与消息 ID 模式查询消息", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });

        await executeZulipPlatformAction(client, "get_messages", {
            anchor: "date",
            anchor_date: "2026-08-31T12:30:00+08:00",
            include_anchor: false,
            num_before: 20,
            num_after: 10,
            narrow: [
                ["channel", "engineering"],
                { operator: "has", operand: "link", negated: true },
            ],
            apply_markdown: false,
            allow_empty_topic_name: true,
        });
        await executeZulipPlatformAction(client, "get_messages", {
            message_ids: [31, 32],
            narrow: [{ operator: "sender", operand: 11 }],
            client_gravatar: true,
        });

        expect(call).toHaveBeenNthCalledWith(1, "messages", "GET", {
            anchor: "date",
            anchor_date: "2026-08-31T12:30:00+08:00",
            include_anchor: false,
            num_before: 20,
            num_after: 10,
            narrow: [
                ["channel", "engineering"],
                { operator: "has", operand: "link", negated: true },
            ],
            apply_markdown: false,
            allow_empty_topic_name: true,
        });
        expect(call).toHaveBeenNthCalledWith(2, "messages", "GET", {
            message_ids: [31, 32],
            narrow: [{ operator: "sender", operand: 11 }],
            client_gravatar: true,
        });
    });

    it("覆盖指定消息和 narrow 标记", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });

        await executeZulipPlatformAction(client, "update_message_flags", {
            messages: [4, 8],
            op: "add",
            flag: "collapsed",
        });
        await executeZulipPlatformAction(client, "update_message_flags_for_narrow", {
            anchor: "first_unread",
            include_anchor: true,
            num_before: 10,
            num_after: 20,
            narrow: [
                { operator: "channel", operand: 7 },
                { operator: "is", operand: "unread", negated: false },
            ],
            op: "add",
            flag: "read",
        });

        expect(call).toHaveBeenNthCalledWith(1, "messages/flags", "POST", {
            messages: [4, 8],
            op: "add",
            flag: "collapsed",
        });
        expect(call).toHaveBeenNthCalledWith(2, "messages/flags/narrow", "POST", {
            anchor: "first_unread",
            include_anchor: true,
            num_before: 10,
            num_after: 20,
            narrow: [
                { operator: "channel", operand: 7 },
                { operator: "is", operand: "unread", negated: false },
            ],
            op: "add",
            flag: "read",
        });
    });

    it("查询批量 narrow 匹配并保留官方参数", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });

        await executeZulipPlatformAction(client, "check_messages_match_narrow", {
            msg_ids: [31, 32],
            narrow: [{ operator: "has", operand: "link" }],
        });

        expect(call).toHaveBeenCalledWith("messages/matches_narrow", "GET", {
            msg_ids: [31, 32],
            narrow: [{ operator: "has", operand: "link" }],
        });
    });

    it("举报理由保留服务端动态 key，并验证 other 描述", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });

        await executeZulipPlatformAction(client, "report_message", {
            message_id: 42,
            report_type: "organization_policy",
            description: "Contains confidential data",
        });

        expect(call).toHaveBeenCalledWith("messages/42/report", "POST", {
            report_type: "organization_policy",
            description: "Contains confidential data",
        });
    });

    it.each([
        ["get_messages", {}],
        ["get_messages", { num_before: 10 }],
        ["get_messages", { num_before: 10, num_after: 10, use_first_unread_anchor: true }],
        ["get_messages", { anchor: "date", num_before: 10, num_after: 10 }],
        [
            "get_messages",
            { anchor: "date", anchor_date: "2026-02-31", num_before: 10, num_after: 10 },
        ],
        ["get_messages", { anchor_date: "2026-08-31", num_before: 10, num_after: 10 }],
        ["get_messages", { message_ids: [1], anchor: "newest" }],
        ["get_messages", { message_ids: [1], narrow: [["channel"]] }],
        ["update_message_flags", { messages: [], op: "add", flag: "read" }],
        ["update_message_flags", { messages: [1], op: "add", flag: "mentioned" }],
        [
            "update_message_flags_for_narrow",
            {
                anchor: "now",
                num_before: 1,
                num_after: 1,
                narrow: [],
                op: "add",
                flag: "read",
            },
        ],
        ["check_messages_match_narrow", { msg_ids: [1], narrow: [{ operator: "is" }] }],
        ["report_message", { message_id: 1, report_type: "other" }],
        ["report_message", { message_id: 1, report_type: "spam", description: "x".repeat(1001) }],
        ["add_reaction", { message_id: 1, emoji_name: "wave", extra: true }],
        ["add_reaction", { message_id: 1, emoji_name: "wave", emoji_code: 1 }],
    ])("%s 在请求前拒绝无效参数", async (action, params) => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call");

        await expect(executeZulipPlatformAction(client, action, params)).rejects.toMatchObject({
            code: "ZULIP_INVALID_ACTION_PARAM",
        });
        expect(call).not.toHaveBeenCalled();
    });
});
