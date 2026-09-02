import { assertSchemaFormContract } from "@onebots/core";
import type { CommonTypes, ValidationRule } from "onebots";
import { describe, expect, it, vi } from "vitest";
import {
    describeTwitchCapabilities,
    TWITCH_EVENTSUB_TYPES,
    twitchCapabilities,
} from "./capabilities.js";
import { TwitchClient } from "./client.js";
import { projectTwitchEvent } from "./events.js";
import { twitchSchema } from "./index.js";
import { compileTwitchMessage, projectTwitchFragments } from "./messages.js";
import { executeTwitchPlatformAction, TWITCH_PLATFORM_ACTIONS } from "./platform-actions.js";
import type { TwitchDelivery, TwitchEventSubMessage } from "./types.js";

describe("Twitch capability and Schema contract", () => {
    it("每个发布平台动作都有能力声明，并公开四种真实事件入口", () => {
        for (const action of TWITCH_PLATFORM_ACTIONS) {
            expect(twitchCapabilities.actions[action], action).toBeDefined();
        }
        expect(twitchCapabilities.transports.eventsub_websocket?.support).toBe("native");
        expect(twitchCapabilities.transports.eventsub_webhook?.support).toBe("native");
        expect(twitchCapabilities.transports.existing_socket?.support).toBe("native");
        expect(twitchCapabilities.transports.manual?.support).toBe("native");
        expect(TWITCH_EVENTSUB_TYPES).toContain("channel.bits.use");
        expect(TWITCH_EVENTSUB_TYPES).not.toContain("channel.guest_star_session.begin");
        expect(TWITCH_EVENTSUB_TYPES).not.toContain("channel.custom_powerup_redemption.add");
    });

    it("按订阅和已验证 scope 动态收敛事件与动作", () => {
        const manifest = describeTwitchCapabilities(
            { subscriptions: [{ type: "channel.chat.message" }] },
            ["user:write:chat"],
        );
        expect(manifest.events.message?.support).toBe("native");
        expect(manifest.events.message_deleted?.support).toBe("unsupported");
        expect(manifest.actions.send_twitch_chat_message?.support).toBe("native");
        expect(manifest.actions.ban_twitch_user?.support).toBe("unsupported");
    });

    it("record-list 使用稳定类型下拉和行内条件，且完整满足表单契约", () => {
        expect(() => assertSchemaFormContract(twitchSchema)).not.toThrow();
        const subscriptions = rule("subscriptions");
        expect(subscriptions).toMatchObject({
            type: "array",
            ui: { widget: "record-list", section: "filter" },
        });
        const fields = subscriptions.ui?.fields || [];
        expect(fields.find(field => field.key === "type")?.choices).toHaveLength(
            TWITCH_EVENTSUB_TYPES.length,
        );
        expect(fields.find(field => field.key === "organization_id")?.visibleWhen).toEqual({
            path: "type",
            oneOf: ["drop.entitlement.grant"],
        });
        expect(rule("access_token").sensitive).toBe(true);
        expect(rule("webhook_secret").sensitive).toBe(true);
    });
});

describe("Twitch message and event projection", () => {
    it("编译 mention、emote、reply 与媒体 URL，拒绝伪原生上传", () => {
        expect(
            compileTwitchMessage([
                { type: "reply", data: { message_id: "parent1" } },
                { type: "at", data: { login: "viewer" } },
                { type: "text", data: { text: " hello " } },
                { type: "emoji", data: { name: "Kappa" } },
                { type: "image", data: { url: "https://cdn.example.com/image.png" } },
            ] as CommonTypes.Segment[]),
        ).toEqual({
            text: "@viewer hello Kappahttps://cdn.example.com/image.png",
            replyParentMessageId: "parent1",
        });
        expect(() =>
            compileTwitchMessage([{ type: "image", data: {} }] as CommonTypes.Segment[]),
        ).toThrow(/公开 URL/u);
    });

    it("保留 EventSub fragment 的 mention、emote、gif 与 cheermote 语义", () => {
        expect(
            projectTwitchFragments({
                text: "@viewer Kappa Cheer100",
                fragments: [
                    {
                        type: "mention",
                        text: "@viewer",
                        mention: { user_id: "300", user_login: "viewer", user_name: "Viewer" },
                    },
                    { type: "emote", text: "Kappa", emote: { id: "25" } },
                    { type: "gif", text: "gif", gif: { id: "g1", url: "https://cdn/g.gif" } },
                    {
                        type: "cheermote",
                        text: "Cheer100",
                        cheermote: { prefix: "Cheer", bits: 100, tier: 100 },
                    },
                ],
            }).map(segment => segment.type),
        ).toEqual(["at", "emoji", "image", "emoji"]);
    });

    it("消息投影保留 raw envelope，批量事件生成稳定且不冲突的 ID", () => {
        const single = projectTwitchEvent(
            delivery("message1", "channel.chat.message", {
                broadcaster_user_id: "100",
                broadcaster_user_name: "Channel",
                chatter_user_id: "300",
                chatter_user_login: "viewer",
                chatter_user_name: "Viewer",
                message_id: "chat1",
                message: { text: "hello", fragments: [{ type: "text", text: "hello" }] },
            }),
            context,
        )[0];
        expect(single).toMatchObject({
            type: "message",
            message_type: "channel",
            raw_message: "hello",
            message_id: { string: "chat1" },
        });

        const batch = delivery("drop1", "drop.entitlement.grant", { id: "entitlement" });
        batch.batchIndex = 1;
        expect(projectTwitchEvent(batch, context)[0]).toMatchObject({
            id: { string: "drop1:1" },
            type: "notice",
            notice_type: "custom",
            sub_type: "drop.entitlement.grant",
        });
    });
});

describe("Twitch platform actions", () => {
    it("generic call 仍受 Helix 相对路径边界保护，并拒绝多余参数", async () => {
        const call = vi.fn().mockResolvedValue({ ok: true });
        const client = new TwitchClient(config(), { rest: { call } });
        await executeTwitchPlatformAction(client, "call_twitch_api", {
            method: "GET",
            path: "users",
            query: { id: ["100"] },
        });
        expect(call).toHaveBeenCalledWith("GET", "users", {
            query: { id: ["100"] },
            body: undefined,
        });
        await expect(
            executeTwitchPlatformAction(client, "call_twitch_api", {
                method: "GET",
                path: "https://evil.example.com/users",
            }),
        ).rejects.toThrow(/相对资源路径|Helix path/u);
        await expect(
            executeTwitchPlatformAction(client, "get_twitch_global_emotes", { typo: true }),
        ).rejects.toThrow(/不接受参数 typo/u);
        await expect(executeTwitchPlatformAction(client, "unknown", {})).rejects.toMatchObject({
            code: "TWITCH_ACTION_NOT_IMPLEMENTED",
        });
    });
});

const context = {
    botId: id("200"),
    createId: (value: string | number) => id(String(value)),
};

function id(value: string): CommonTypes.Id {
    return { string: value } as CommonTypes.Id;
}

function delivery(messageId: string, type: string, event: Record<string, unknown>): TwitchDelivery {
    const envelope: TwitchEventSubMessage = {
        metadata: {
            message_id: messageId,
            message_type: "notification",
            message_timestamp: "2026-09-02T10:00:00Z",
        },
        payload: {
            subscription: {
                id: "subscription1",
                status: "enabled",
                type,
                version: "1",
                cost: 0,
                condition: { broadcaster_user_id: "100", user_id: "200" },
                transport: { method: "websocket" },
                created_at: "2026-09-02T10:00:00Z",
            },
            event,
        },
    };
    return { envelope, subscription: envelope.payload.subscription, event };
}

function rule(path: string): ValidationRule {
    const value = twitchSchema[path];
    if (!value || !("type" in value)) throw new Error(`missing schema field ${path}`);
    return value;
}

function config() {
    return {
        account_id: "account",
        client_id: "client",
        access_token: "token",
        broadcaster_user_id: "100",
        bot_user_id: "200",
        receive_mode: "manual" as const,
    };
}
