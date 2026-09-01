import { describe, expect, it, vi } from "vitest";
import { Account } from "./account.js";
import type { Protocol } from "./protocol.js";

function createAccount(): Account {
    return new Account(
        {
            platform: "mock",
            app: {
                config: { general: {}, timeout: 30 },
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
    it("在账号摘要中公开每个协议出口的身份、路径与生命周期", () => {
        const account = createAccount();
        account.protocols = [
            protocol({
                name: "onebot",
                version: "v11",
                path: "/mock/bot/onebot/v11",
                lifecycleStatus: "failed",
            }),
        ];

        expect(account.info).toMatchObject({
            urls: ["/mock/bot/onebot/v11"],
            protocols: [
                {
                    name: "onebot",
                    version: "v11",
                    path: "/mock/bot/onebot/v11",
                    lifecycleStatus: "failed",
                },
            ],
        });
    });

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

    it("账号登录超过配置时间后中止启动信号并拒绝迟到的协议就绪", async () => {
        vi.useFakeTimers();
        const account = createAccount();
        account.app.config.timeout = 1;
        let startSignal: AbortSignal | undefined;
        let releaseLogin: (() => void) | undefined;
        account.on("start", async (signal: AbortSignal) => {
            startSignal = signal;
            await new Promise<void>(resolve => {
                releaseLogin = resolve;
            });
        });
        const startProtocol = vi.fn(async () => undefined);
        account.protocols = [protocol({ start: startProtocol })];

        const starting = account.start();
        const rejected = expect(starting).rejects.toThrow("账号 mock/bot 启动超过 1 秒");
        await vi.advanceTimersByTimeAsync(1_000);

        await rejected;
        expect(startSignal?.aborted).toBe(true);
        expect(account.status).toBe("offline");
        expect(startProtocol).not.toHaveBeenCalled();

        releaseLogin?.();
        await vi.runAllTimersAsync();
        expect(startProtocol).not.toHaveBeenCalled();
        expect(account.protocols[0].lifecycleStatus).toBe("pending");
        vi.useRealTimers();
    });

    it("协议启动超时后不会被迟到完成覆盖为就绪", async () => {
        vi.useFakeTimers();
        const account = createAccount();
        account.app.config.timeout = 1;
        let signal: AbortSignal | undefined;
        let releaseProtocol: (() => void) | undefined;
        account.protocols = [
            protocol({
                start: vi.fn(async receivedSignal => {
                    signal = receivedSignal;
                    await new Promise<void>(resolve => {
                        releaseProtocol = resolve;
                    });
                }),
            }),
        ];

        const starting = account.start();
        const rejected = expect(starting).rejects.toThrow("账号 mock/bot 启动超过 1 秒");
        await vi.advanceTimersByTimeAsync(1_000);

        await rejected;
        expect(signal?.aborted).toBe(true);
        expect(account.protocols[0].lifecycleStatus).toBe("failed");

        releaseProtocol?.();
        await vi.runAllTimersAsync();
        expect(account.protocols[0].lifecycleStatus).toBe("failed");
        vi.useRealTimers();
    });

    it("停止账号会中止未完成的启动并拒绝迟到任务覆盖停止状态", async () => {
        const account = createAccount();
        let signal: AbortSignal | undefined;
        let releaseProtocol: (() => void) | undefined;
        account.protocols = [
            protocol({
                start: vi.fn(async receivedSignal => {
                    signal = receivedSignal;
                    await new Promise<void>(resolve => {
                        releaseProtocol = resolve;
                    });
                }),
            }),
        ];

        const starting = account.start();
        await Promise.resolve();
        await account.stop();

        expect(signal?.aborted).toBe(true);
        expect(account.protocols[0].lifecycleStatus).toBe("stopped");
        releaseProtocol?.();
        await expect(starting).rejects.toThrow("启动任务已失效");
        expect(account.protocols[0].lifecycleStatus).toBe("stopped");
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
