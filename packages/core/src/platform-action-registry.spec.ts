import { describe, expect, it, vi } from "vitest";
import { definePlatformActions } from "./platform-action-registry.js";

describe("definePlatformActions", () => {
    it("从同一 handler 表驱动发现、判断与执行", async () => {
        const handler = vi.fn(async (prefix: string, params: Readonly<Record<string, unknown>>) =>
            [prefix, params.value].join(":"),
        );
        const registry = definePlatformActions(
            { echo: handler },
            action => new Error(`unknown:${action}`),
        );

        expect([...registry.actions]).toEqual(["echo"]);
        expect(registry.has("echo")).toBe(true);
        await expect(registry.execute("bot", "echo", { value: 1 })).resolves.toBe("bot:1");
        expect(handler).toHaveBeenCalledOnce();
    });

    it("动作集合在运行时不可修改并统一构造未知动作错误", async () => {
        const registry = definePlatformActions(
            { ping: async () => "pong" },
            action => new RangeError(action),
        );

        expect("add" in registry.actions).toBe(false);
        await expect(registry.execute(undefined, "missing", {})).rejects.toBeInstanceOf(RangeError);
    });
});
