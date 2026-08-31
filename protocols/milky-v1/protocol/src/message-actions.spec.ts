import type { Adapter } from "onebots";
import { describe, expect, it, vi } from "vitest";
import { executeMilkyMessageAction } from "./message-actions.js";

describe("Milky 消息动作", () => {
    it("发送前闭合场景、ID 与消息段", async () => {
        const sendMessage = vi.fn().mockResolvedValue({
            message_id: { string: "message", number: 9001, source: "message" },
        });
        const adapter = {
            resolveId: (value: string | number) => ({
                string: String(value),
                number: Number(value),
                source: value,
            }),
            sendMessage,
        } as unknown as Adapter;

        await expect(
            executeMilkyMessageAction(adapter, "bot", "send_private_message", {
                user_id: 10001,
                message: [{ type: "text", data: { text: "hello" } }],
            }),
        ).resolves.toMatchObject({ message_seq: 9001 });
        expect(sendMessage).toHaveBeenCalledWith(
            "bot",
            expect.objectContaining({
                scene_type: "private",
                scene_id: expect.objectContaining({ number: 10001 }),
                message: [{ type: "text", data: { text: "hello" } }],
            }),
        );
    });

    it("拒绝非数组消息且不触达 Adapter", async () => {
        const sendMessage = vi.fn();
        const adapter = {
            resolveId: (value: string | number) => ({
                string: String(value),
                number: Number(value),
                source: value,
            }),
            sendMessage,
        } as unknown as Adapter;

        await expect(
            executeMilkyMessageAction(adapter, "bot", "send_group_message", {
                group_id: 20001,
                message: "hello",
            }),
        ).rejects.toThrow("message 必须是消息段数组");
        expect(sendMessage).not.toHaveBeenCalled();
    });
});
