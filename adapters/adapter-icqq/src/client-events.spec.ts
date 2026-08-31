import type { Client } from "@icqqjs/icqq";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { wireICQQClientEvents } from "./client-events.js";

describe("ICQQ 客户端事件桥接", () => {
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
            sender: { user_id: 10000, nickname: "Bot" },
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
    });
});
