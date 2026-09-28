import { describe, expect, it, vi } from "vitest";
import type { Adapter } from "./adapter.js";
import { sendAccountMessage } from "./adapter-send.js";

describe("sendAccountMessage", () => {
    it("仅在平台发送成功后发布发出事实", async () => {
        const result = { message_id: { string: "msg-1", source: "msg-1", number: 1 } };
        const sendMessage = vi.fn().mockResolvedValue(result);
        const emit = vi.fn();
        const adapter = { platform: "mock", sendMessage, emit } as unknown as Adapter;
        const params = {
            scene_type: "private" as const,
            scene_id: { string: "friend", source: "friend", number: 1 },
            message: [{ type: "text", data: { text: "你好" } }],
        };
        expect(await sendAccountMessage(adapter, "bot", params)).toBe(result);
        expect(emit).toHaveBeenCalledWith("message:sent", {
            platform: "mock",
            account_id: "bot",
            params,
            result,
        });
        sendMessage.mockRejectedValueOnce(new Error("平台拒绝"));
        await expect(sendAccountMessage(adapter, "bot", params)).rejects.toThrow("平台拒绝");
        expect(emit).toHaveBeenCalledTimes(1);
    });
});
