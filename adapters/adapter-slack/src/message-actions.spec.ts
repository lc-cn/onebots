import { describe, expect, it, vi } from "vitest";
import { SlackAdapter } from "./adapter.js";

const id = (value: string) => ({ string: value, number: 1, source: value });

describe("Slack 发出消息的会话身份", () => {
    it("多人私信返回独立会话，单人私信不改写为频道 ID", async () => {
        const sendMessage = vi
            .fn()
            .mockResolvedValueOnce({ ts: "1", channel: "G1" })
            .mockResolvedValueOnce({ ts: "2", channel: "D1" });
        const adapter = Object.create(SlackAdapter.prototype) as SlackAdapter;
        Object.defineProperties(adapter, {
            getAccount: {
                value: () => ({ client: { sendMessage, rememberMessage: vi.fn() } }),
            },
            coerceId: { value: (value: ReturnType<typeof id>) => value },
            createId: { value: id },
        });
        const message = [{ type: "text", data: { text: "你好" } }];

        await expect(
            adapter.sendMessage("bot", {
                scene_type: "direct",
                scene_id: id("G1"),
                message,
            }),
        ).resolves.toMatchObject({
            scene: { scene_type: "direct", scene_id: { string: "G1" } },
        });
        const single = await adapter.sendMessage("bot", {
            scene_type: "direct",
            scene_id: id("U1"),
            message,
        });
        expect(single.scene).toBeUndefined();
    });
});
