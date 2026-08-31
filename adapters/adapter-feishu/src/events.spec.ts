import { describe, expect, it } from "vitest";
import { projectFeishuEvents } from "./events.js";
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

        expect(projectFeishuEvents(event, raw, context)[0]).toMatchObject({
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
            users: [
                { user_id: { open_id: "ou_1" }, name: "成员一" },
                { user_id: { open_id: "ou_2" }, name: "成员二" },
            ],
        });
        const members = projectFeishuEvents(member, member as FeishuWebhookBody, context);
        expect(members).toHaveLength(2);
        expect(members[0]).toMatchObject({
            type: "notice",
            notice_type: "member_joined",
            user: { id: { string: "ou_1" } },
        });
        expect(members[1]).toMatchObject({ user: { id: { string: "ou_2" } } });
        expect(members[0]?.id).not.toEqual(members[1]?.id);

        const unknown = makeEvent("drive.file.bitable_record_changed_v1", { token: "x" });
        expect(
            projectFeishuEvents(unknown, unknown as FeishuWebhookBody, context)[0],
        ).toMatchObject({
            type: "notice",
            notice_type: "custom",
            extensions: { feishu: { event_type: "drive.file.bitable_record_changed_v1" } },
        });
    });

    it("按官方载荷投影消息表情回复", () => {
        const reaction = makeEvent("im.message.reaction.created_v1", {
            message_id: "om_1",
            user_id: { open_id: "ou_1" },
            reaction_type: { emoji_type: "THUMBSUP" },
            operator_type: "user",
            action_time: "1710000000000",
        });

        expect(
            projectFeishuEvents(reaction, reaction as FeishuWebhookBody, context)[0],
        ).toMatchObject({
            type: "notice",
            notice_type: "reaction_added",
            message_id: { string: "om_1" },
            user: { id: { string: "ou_1" } },
            extensions: { feishu: { emoji_type: "THUMBSUP" } },
        });
    });

    it("将批量已读消息逐条投影为稳定的消息状态", () => {
        const read = makeEvent("im.message.message_read_v1", {
            reader: {
                reader_id: { open_id: "ou_reader" },
                read_time: "1710000000123",
                tenant_key: "tenant",
            },
            message_id_list: ["om_1", "om_2"],
        });

        const notices = projectFeishuEvents(read, read as FeishuWebhookBody, context);
        expect(notices).toHaveLength(2);
        expect(notices[0]).toMatchObject({
            id: { string: "EV:im.message.message_read_v1:om_1" },
            notice_type: "message_status",
            message_id: { string: "om_1" },
            user: { id: { string: "ou_reader" } },
            extensions: { feishu: { status: "read", read_time: "1710000000123" } },
        });
        expect(notices[1]).toMatchObject({ message_id: { string: "om_2" } });
    });

    it("投影机器人群生命周期、成员操作人与菜单交互", () => {
        const botAdded = makeEvent("im.chat.member.bot.added_v1", {
            chat_id: "oc_1",
            name: "项目群",
            operator_id: { open_id: "ou_operator" },
            external: true,
        });
        expect(
            projectFeishuEvents(botAdded, botAdded as FeishuWebhookBody, context)[0],
        ).toMatchObject({
            notice_type: "group_increase",
            user: { id: { string: "BOT" } },
            operator: { id: { string: "ou_operator" } },
            group: { id: { string: "oc_1" }, name: "项目群" },
        });

        const disbanded = makeEvent("im.chat.disbanded_v1", {
            chat_id: "oc_1",
            operator_id: { open_id: "ou_operator" },
        });
        expect(
            projectFeishuEvents(disbanded, disbanded as FeishuWebhookBody, context)[0],
        ).toMatchObject({ notice_type: "group_decrease" });

        const menu = makeEvent("application.bot.menu_v6", {
            operator: {
                operator_name: "测试用户",
                operator_id: { open_id: "ou_operator" },
            },
            event_key: "open_settings",
            timestamp: 1710000000,
        });
        expect(projectFeishuEvents(menu, menu as FeishuWebhookBody, context)[0]).toMatchObject({
            notice_type: "interaction",
            user: { id: { string: "ou_operator" } },
            extensions: { feishu: { event_key: "open_settings" } },
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
