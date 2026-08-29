import { describe, expect, it } from "vitest";
import { GatewayIntents } from "./lite/gateway.js";
import { DEFAULT_DISCORD_INTENTS, resolveDiscordIntents } from "./intents.js";
import { DISCORD_GATEWAY_INTENTS } from "./types.js";

describe("resolveDiscordIntents", () => {
    it("两个 Bot 共用覆盖核心事件能力的默认位图", () => {
        const bitmask = resolveDiscordIntents();

        for (const name of DEFAULT_DISCORD_INTENTS) {
            expect(bitmask & GatewayIntents[name]).toBe(GatewayIntents[name]);
        }
    });

    it("每个 Schema 选项都有真实 Gateway 位映射", () => {
        for (const name of DISCORD_GATEWAY_INTENTS) {
            expect(resolveDiscordIntents([name])).toBe(GatewayIntents[name]);
        }
        expect(resolveDiscordIntents(["AutoModerationExecution"])).toBe(1 << 21);
    });

    it("拒绝静默忽略未知名称和非法原始位图", () => {
        expect(() => resolveDiscordIntents(["FutureIntent"])).toThrow("FutureIntent");
        expect(() => resolveDiscordIntents(-1)).toThrow("非负安全整数");
    });
});
