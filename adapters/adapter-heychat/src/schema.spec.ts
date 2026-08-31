import { describe, expect, it } from "vitest";
import { heychatSchema } from "./index.js";

describe("Heychat 配置 Schema", () => {
    it("按接收模式隐藏内置 WebSocket 专属字段", () => {
        expect(heychatSchema.receive_mode?.default).toBe("websocket");
        expect(heychatSchema.receive_mode?.choices).toEqual([
            expect.objectContaining({ value: "websocket" }),
            expect.objectContaining({ value: "manual" }),
        ]);
        for (const field of [
            "ws_url",
            "heartbeat_interval_ms",
            "reconnect_initial_delay_ms",
            "reconnect_max_delay_ms",
        ] as const) {
            expect(heychatSchema[field]?.ui?.visibleWhen).toEqual({
                path: "receive_mode",
                oneOf: ["websocket"],
            });
        }
    });
});
