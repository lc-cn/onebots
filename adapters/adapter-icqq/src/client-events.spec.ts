import type { Client } from "@icqqjs/icqq";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { wireICQQClientEvents } from "./client-events.js";

describe("ICQQ 客户端事件桥接", () => {
    it("保留完整原生消息元素与群发送者语义", () => {
        const emitter = new EventEmitter();
        const client = Object.assign(emitter, { uin: 10000, nickname: "Bot" }) as unknown as Client;
        const sink = { emit: vi.fn(), online: vi.fn(), offline: vi.fn() };
        const image = {
            type: "image",
            file: "image-file",
            url: "https://example.com/image.jpg",
            md5: "0123456789abcdef",
            width: 640,
            height: 480,
            size: 1024,
            summary: "[图片]",
            nt: true,
        };
        const button = {
            type: "button",
            content: { appid: 1, rows: [] },
        };
        wireICQQClientEvents(client, sink);

        emitter.emit("message.group", {
            message_id: "message-1",
            group_id: 20000,
            group_name: "OneBots",
            user_id: 10001,
            message: [image, button],
            raw_message: "[图片]",
            time: 100,
            sub_type: "anonymous",
            anonymous: { id: 1, name: "匿名" },
            block: true,
            atme: true,
            atall: false,
            sender: {
                user_id: 10001,
                user_uid: "u_alice",
                nickname: "Alice",
                sub_id: "sub",
                card: "管理员",
                sex: "female",
                age: 20,
                area: "广东",
                level: 12,
                role: "admin",
                title: "活跃成员",
            },
            reply: vi.fn(),
        });

        const event = sink.emit.mock.calls.find(([name]) => name === "group_message")?.[1];
        expect(event).toMatchObject({
            sub_type: "anonymous",
            anonymous: { name: "匿名" },
            block: true,
            atme: true,
            atall: false,
            sender: { user_uid: "u_alice", area: "广东", level: 12 },
        });
        expect((event as { message: unknown[] }).message[0]).toBe(image);
        expect((event as { message: unknown[] }).message[1]).toBe(button);
    });

    it("桥接群消息回应并归一化回应类型", () => {
        const emitter = new EventEmitter();
        const client = Object.assign(emitter, { uin: 10000, nickname: "Bot" }) as unknown as Client;
        const sink = { emit: vi.fn(), online: vi.fn(), offline: vi.fn() };
        wireICQQClientEvents(client, sink);

        emitter.emit("notice.group.reaction", {
            group_id: 20000,
            user_id: 10001,
            seq: 42,
            id: "66",
            type: 1,
            set: true,
        });

        expect(sink.emit).toHaveBeenCalledWith(
            "group_reaction",
            expect.objectContaining({
                group_id: 20000,
                message_seq: 42,
                face_id: "66",
                reaction_type: "face",
                is_add: true,
            }),
        );
    });

    it("桥接讨论组、频道、跨设备同步与完整通知面", () => {
        const emitter = new EventEmitter();
        const client = Object.assign(emitter, { uin: 10000, nickname: "Bot" }) as unknown as Client;
        const sink = { emit: vi.fn(), online: vi.fn(), offline: vi.fn() };
        wireICQQClientEvents(client, sink);

        emitter.emit("message.discuss", {
            message_id: "discuss-message",
            discuss_id: 30000,
            discuss_name: "讨论组",
            user_id: 10001,
            message: [],
            raw_message: "",
            time: 100,
            sender: { user_id: 10001, nickname: "Alice", card: "A" },
            atme: false,
        });
        emitter.emit("message.guild", {
            guild_id: "guild",
            guild_name: "频道",
            channel_id: "channel",
            channel_name: "子频道",
            seq: 1,
            rand: 2,
            time: 100,
            message: [],
            raw_message: "",
            sender: { tiny_id: "tiny", nickname: "Alice" },
        });
        emitter.emit("sync.message", {
            message_id: "sync-message",
            user_id: 10000,
            message: [],
            raw_message: "",
            time: 100,
            sub_type: "self",
            from_uid: "u_bot",
            to_id: 10000,
            to_uid: "u_bot",
            auto_reply: false,
            sender: {
                user_id: 10000,
                user_uid: "u_bot",
                nickname: "Bot",
                group_id: undefined,
                discuss_id: undefined,
            },
        });
        emitter.emit("request.friend", {
            flag: "friend-flag",
            user_id: 10001,
            nickname: "Alice",
            comment: "申请好友",
            source: "search",
            sub_type: "single",
            age: 20,
            sex: "female",
            time: 100,
        });
        emitter.emit("request.group", {
            flag: "group-flag",
            group_id: 20000,
            group_name: "OneBots",
            user_id: 10001,
            nickname: "Alice",
            sub_type: "add",
            comment: "申请入群",
            inviter_id: 10002,
            tips: "来自群邀请",
            time: 100,
        });
        emitter.emit("notice.friend.increase", { user_id: 10001, nickname: "Alice" });
        emitter.emit("notice.friend.decrease", { user_id: 10002, nickname: "Bob" });
        emitter.emit("notice.group.sign", {
            group_id: 20000,
            user_id: 10001,
            nickname: "Alice",
            sign_text: "打卡成功",
        });
        emitter.emit("notice.group.transfer", {
            group_id: 20000,
            operator_id: 10001,
            user_id: 10002,
        });
        emitter.emit("sync.read.private", { user_id: 10001, time: 99 });
        emitter.emit("sync.read.group", { group_id: 20000, seq: 42 });
        emitter.emit("internal.input", { user_id: 10001, end: false });

        for (const name of [
            "discuss_message",
            "guild_message",
            "synced_private_message",
            "friend_request",
            "group_request",
            "friend_change",
            "group_sign",
            "group_transfer",
            "read_sync",
            "typing",
        ]) {
            expect(sink.emit).toHaveBeenCalledWith(name, expect.any(Object));
        }
        expect(sink.emit.mock.calls.filter(([name]) => name === "friend_change")).toHaveLength(2);
        expect(sink.emit.mock.calls.filter(([name]) => name === "read_sync")).toHaveLength(2);
        expect(sink.emit).toHaveBeenCalledWith(
            "friend_request",
            expect.objectContaining({ sub_type: "single", age: 20, sex: "female" }),
        );
        expect(sink.emit).toHaveBeenCalledWith(
            "group_request",
            expect.objectContaining({
                group_name: "OneBots",
                inviter_id: 10002,
                tips: "来自群邀请",
            }),
        );
    });
});
