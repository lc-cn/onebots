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
});
