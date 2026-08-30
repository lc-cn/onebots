/**
 * Account.dispatch() 调试旁路隔离测试
 *
 * 回归背景：dispatch() 在真正分发给各协议之前会 emit 一个仅供 Web 控制台调试
 * 使用的 "message:dispatch" 事件；这个 emit 曾经没有 try/catch 保护，一旦监听器
 * 抛出异常（例如 JSON.stringify 遇到 BigInt / 循环引用），会阻断下面 for 循环，
 * 导致该事件对所有协议都静默丢失。调试旁路异常不能影响协议投递；可靠入口还要
 * 等待所有协议完成，并在全部协议均获得投递机会后向接入层传播失败。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { Account } from "../account.js";
import { ProtocolRegistry } from "../registry.js";
import type { Protocol } from "../protocol.js";

function createAccount(adapterEmit: (event: string, payload: unknown) => void) {
    const protocolDispatch = vi.fn();
    const fakeProtocol = Object.assign(new EventEmitter(), {
        name: "fake",
        version: "v1",
        path: "/fake/bot/fake/v1",
        dispatch: protocolDispatch,
    }) as unknown as Protocol;

    vi.spyOn(ProtocolRegistry, "has").mockImplementation(
        (protocol, version) => protocol === "fake" && version === "v1",
    );
    vi.spyOn(ProtocolRegistry, "create").mockReturnValue(fakeProtocol);

    const adapter = {
        platform: "mock",
        emit: adapterEmit,
        app: {
            getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
            config: { general: {} },
        },
    } as never;

    const account = new Account(adapter, {}, { account_id: "bot", "fake.v1": {} } as never);
    return { account, protocolDispatch, fakeProtocol };
}

describe("Account.dispatch 调试旁路隔离", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("message:dispatch 监听器抛出异常时，仍然照常分发给所有协议", () => {
        const { account, protocolDispatch } = createAccount(() => {
            throw new Error("调试旁路模拟异常（如 JSON.stringify 遇到 BigInt）");
        });

        const event = { type: "message" } as never;
        expect(() => account.dispatch(event)).not.toThrow();
        expect(protocolDispatch).toHaveBeenCalledWith(event);
    });

    it("message:dispatch 监听器正常时，行为不变", () => {
        const emitted: unknown[] = [];
        const { account, protocolDispatch } = createAccount((event, payload) => {
            emitted.push({ event, payload });
        });

        const event = { type: "message" } as never;
        account.dispatch(event);

        expect(protocolDispatch).toHaveBeenCalledWith(event);
        expect(emitted).toHaveLength(1);
    });

    it("dispatchAwaited 等待异步协议完成", async () => {
        let release: (() => void) | undefined;
        const pending = new Promise<void>(resolve => {
            release = resolve;
        });
        const { account, protocolDispatch } = createAccount(vi.fn());
        protocolDispatch.mockReturnValue(pending);

        let settled = false;
        const delivery = account.dispatchAwaited({ type: "message" } as never).then(() => {
            settled = true;
        });
        await Promise.resolve();
        expect(settled).toBe(false);

        release?.();
        await delivery;
        expect(settled).toBe(true);
    });

    it("一个协议失败时仍尝试其余协议并向接入层传播错误", async () => {
        const { account, protocolDispatch } = createAccount(vi.fn());
        const secondDispatch = vi.fn();
        protocolDispatch.mockImplementation(() => {
            throw new Error("first failed");
        });
        account.protocols.push({
            name: "second",
            version: "v1",
            dispatch: secondDispatch,
        } as never);

        await expect(account.dispatchAwaited({ type: "message" } as never)).rejects.toThrow(
            "first failed",
        );
        expect(secondDispatch).toHaveBeenCalledOnce();
    });

    it("协议自身注册的 dispatch 监听器不受调试旁路监听器异常影响", () => {
        const { fakeProtocol } = createAccount(() => {
            throw new Error("调试旁路模拟异常");
        });

        const realBroadcast = vi.fn();
        // 模拟协议自身在 start() 阶段注册的真正广播监听器（比调试旁路监听器晚注册）
        (fakeProtocol as unknown as EventEmitter).on("dispatch", realBroadcast);

        expect(() =>
            (fakeProtocol as unknown as EventEmitter).emit("dispatch", "payload"),
        ).not.toThrow();
        expect(realBroadcast).toHaveBeenCalledWith("payload");
    });
});
