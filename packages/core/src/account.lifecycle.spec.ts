import { describe, expect, it, vi } from "vitest";
import { Account } from "./account.js";
import type { Protocol } from "./protocol.js";

function createAccount(): Account {
    return new Account(
        {
            platform: "mock",
            app: {
                config: { general: {} },
                getLogger: () => ({
                    debug: vi.fn(),
                    info: vi.fn(),
                    warn: vi.fn(),
                    error: vi.fn(),
                }),
            },
        } as never,
        {},
        { account_id: "bot" } as never,
    );
}

function protocol(overrides: Partial<Protocol> = {}): Protocol {
    return {
        name: "test",
        version: "v1",
        lifecycleStatus: "pending",
        start: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
        ...overrides,
    } as Protocol;
}

describe("Account lifecycle", () => {
    it("等待账号启动监听器完成后才启动协议", async () => {
        const account = createAccount();
        const order: string[] = [];
        let release: (() => void) | undefined;
        account.on("start", async () => {
            order.push("account:start");
            await new Promise<void>(resolve => {
                release = resolve;
            });
            order.push("account:ready");
        });
        account.protocols = [
            protocol({
                start: vi.fn(async () => {
                    order.push("protocol:start");
                }),
            }),
        ];

        const starting = account.start();
        await Promise.resolve();
        expect(order).toEqual(["account:start"]);
        release?.();
        await starting;
        expect(order).toEqual(["account:start", "account:ready", "protocol:start"]);
        expect(account.protocols[0].lifecycleStatus).toBe("ready");
    });

    it("启动监听器失败时向调用方传播且不启动协议", async () => {
        const account = createAccount();
        const start = vi.fn(async () => undefined);
        account.protocols = [protocol({ start })];
        account.on("start", async () => {
            throw new Error("account failed");
        });

        await expect(account.start()).rejects.toThrow("account failed");
        expect(start).not.toHaveBeenCalled();
        expect(account.protocols[0].lifecycleStatus).toBe("pending");
    });

    it("协议启动失败时标记失败并阻止后续协议误报就绪", async () => {
        const account = createAccount();
        const failed = protocol({
            start: vi.fn(async () => {
                throw new Error("protocol failed");
            }),
        });
        const pending = protocol();
        account.protocols = [failed, pending];

        await expect(account.start()).rejects.toThrow("protocol failed");
        expect(failed.lifecycleStatus).toBe("failed");
        expect(pending.lifecycleStatus).toBe("pending");
    });

    it("停止时尝试全部协议与账号监听器并在最后汇总失败", async () => {
        const account = createAccount();
        const secondStop = vi.fn(async () => undefined);
        const accountStop = vi.fn(async () => undefined);
        account.protocols = [
            protocol({
                stop: vi.fn(async () => {
                    throw new Error("protocol failed");
                }),
            }),
            protocol({ stop: secondStop }),
        ];
        account.on("stop", accountStop);

        await expect(account.stop()).rejects.toThrow("protocol failed");
        expect(secondStop).toHaveBeenCalledOnce();
        expect(accountStop).toHaveBeenCalledOnce();
        expect(account.listenerCount("stop")).toBe(0);
        expect(account.protocols.map(item => item.lifecycleStatus)).toEqual(["failed", "stopped"]);
    });
});
