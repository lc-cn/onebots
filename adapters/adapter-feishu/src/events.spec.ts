import { describe, expect, it } from "vitest";
import { projectFeishuEvent } from "./events.js";
import type { FeishuEvent, FeishuWebhookBody } from "./types.js";

const context = {
    botId: { string: "BOT" } as never,
    createId: (value: string | number) => ({ string: String(value) }) as never,
};

describe("projectFeishuEvent", () => {
    it("按真实 2.0 载荷投影发送者、回复与 @", () => {
        const event: FeishuEvent = {
            schema: "2.0",
            header: {
                event_id: "EV1",
                event_type: "im.message.receive_v1",
                create_time: "1710000000000",
                app_id: "cli_1",
                tenant_key: "tenant",
            },
            event: {
                sender: { sender_id: { open_id: "ou_sender" }, sender_type: "user" },
                message: {
                    message_id: "om_1",
                    parent_id: "om_parent",
                    chat_id: "oc_1",
                    chat_type: "group",
                    message_type: "text",
                    content: '{"text":"你好 @_user_1"}',
                    mentions: [
                        {
                            key: "@_user_1",
                            id: { open_id: "ou_target" },
                            name: "目标用户",
                        },
                    ],
                },
            },
        };
        const raw = event as FeishuWebhookBody;

        expect(projectFeishuEvent(event, raw, context)).toMatchObject({
            type: "message",
            sender: { id: { string: "ou_sender" } },
            group: { id: { string: "oc_1" } },
            raw_event: raw,
            message: [
                { type: "reply", data: { message_id: "om_parent" } },
                { type: "text", data: { text: "你好 " } },
                { type: "at", data: { user_id: "ou_target", name: "目标用户" } },
            ],
        });
    });

    it("投影成员事件并无损保留未知事件", () => {
        const member = makeEvent("im.chat.member.user.added_v1", {
            chat_id: "oc_1",
            users: [{ open_id: "ou_1", name: "成员" }],
        });
        expect(projectFeishuEvent(member, member as FeishuWebhookBody, context)).toMatchObject({
            type: "notice",
            notice_type: "member_joined",
            user: { id: { string: "ou_1" } },
        });

        const unknown = makeEvent("drive.file.bitable_record_changed_v1", { token: "x" });
        expect(projectFeishuEvent(unknown, unknown as FeishuWebhookBody, context)).toMatchObject({
            type: "notice",
            notice_type: "custom",
            extensions: { feishu: { event_type: "drive.file.bitable_record_changed_v1" } },
        });
    });
});

function makeEvent(eventType: string, payload: Record<string, unknown>): FeishuEvent {
    return {
        schema: "2.0",
        header: {
            event_id: `EV:${eventType}`,
            event_type: eventType,
            create_time: "1710000000000",
            app_id: "cli_1",
            tenant_key: "tenant",
        },
        event: payload,
    };
}
