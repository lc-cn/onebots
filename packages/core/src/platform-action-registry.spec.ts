import { describe, expect, it, vi } from "vitest";
import {
    definePlatformActionContract,
    definePlatformActionHandlers,
    definePlatformActions,
} from "./platform-action-registry.js";

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
        const dynamicAction: string = "echo";
        if (!registry.actions.has(dynamicAction)) throw new Error("动作集合未命中 echo");
        const exactAction: "echo" = dynamicAction;
        expect(exactAction).toBe("echo");
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

    it("拒绝注册会被 canonical 路由遮蔽的平台动作", () => {
        expect(() =>
            definePlatformActions(
                {
                    send_message: async () => undefined,
                    create_channel: async () => undefined,
                    get_supported_actions: async () => undefined,
                },
                action => new Error(action),
            ),
        ).toThrowError(
            "平台扩展动作不得与 canonical 动作重名: send_message, create_channel, get_supported_actions",
        );
    });
});

describe("definePlatformActionContract", () => {
    const errors = {
        unsupported: (action: string) => new RangeError(`unknown:${action}`),
        unexpectedParameter: (action: string, parameter: string) =>
            new TypeError(`unexpected:${action}:${parameter}`),
    };

    it("在执行 handler 前拒绝未声明的顶层参数", async () => {
        const handler = vi.fn(async () => "ok");
        const registry = definePlatformActionContract(
            { send: handler },
            { send: ["message"] },
            errors,
        );

        await expect(
            registry.execute(undefined, "send", { message: {}, typo: true }),
        ).rejects.toThrow("unexpected:send:typo");
        expect(handler).not.toHaveBeenCalled();
        await expect(registry.execute(undefined, "send", { message: {} })).resolves.toBe("ok");
    });

    it("允许多个已闭合 handler 子表组合进同一注册表", async () => {
        const left = definePlatformActionHandlers(
            { send: async (_context: string, params) => params.message },
            { send: ["message"] },
            errors.unexpectedParameter,
        );
        const right = definePlatformActionHandlers(
            { inspect: async () => "ok" },
            { inspect: [] },
            errors.unexpectedParameter,
        );
        const registry = definePlatformActions({ ...left, ...right }, errors.unsupported);

        await expect(registry.execute("bot", "send", { message: "hello" })).resolves.toBe("hello");
        await expect(registry.execute("bot", "inspect", { typo: true })).rejects.toThrow(
            "unexpected:inspect:typo",
        );
    });

    it("保持未知动作错误优先于参数检查", async () => {
        const registry = definePlatformActionContract(
            { ping: async () => "pong" },
            { ping: [] },
            errors,
        );

        await expect(registry.execute(undefined, "missing", { typo: true })).rejects.toThrow(
            "unknown:missing",
        );
    });

    it("在运行时拒绝动作表漂移与重复参数", () => {
        expect(() =>
            definePlatformActionContract(
                { ping: async () => "pong" },
                {} as { readonly ping: readonly string[] },
                errors,
            ),
        ).toThrow("missing=[ping]");
        expect(() =>
            definePlatformActionContract(
                { ping: async () => "pong" },
                { ping: ["value", "value"] },
                errors,
            ),
        ).toThrow("平台动作 ping 的参数契约存在重复字段");
    });
});
