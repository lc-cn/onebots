import { describe, expect, it, vi } from "vitest";
import { Adapter } from "./adapter.js";
import type { BaseApp } from "./base-app.js";
import type { Account } from "./account.js";
import { UnsupportedCapabilityError } from "./errors.js";

describe("Adapter account startup isolation", () => {
    it("continues starting later accounts after one account fails", async () => {
        const firstError = new Error("first account failed");
        const first = account("first", async () => {
            throw firstError;
        });
        const second = account("second");
        const adapter = fakeAdapter([first, second]);

        await expect(Adapter.prototype.start.call(adapter)).rejects.toBe(firstError);

        expect(first.start).toHaveBeenCalledOnce();
        expect(second.start).toHaveBeenCalledOnce();
        expect(adapter.logger.info).toHaveBeenCalledTimes(1);
        expect(adapter.logger.error).toHaveBeenCalledWith(
            "账号 mock/first 启动失败",
            expect.objectContaining({ context: { platform: "mock", account_id: "first" } }),
        );
    });

    it("preserves every account startup failure in one aggregate", async () => {
        const firstError = new Error("first account failed");
        const secondError = new Error("second account failed");
        const adapter = fakeAdapter([
            account("first", async () => {
                throw firstError;
            }),
            account("second", async () => {
                throw secondError;
            }),
        ]);

        const result = Adapter.prototype.start.call(adapter).catch(error => error);
        const error = await result;

        expect(error).toBeInstanceOf(AggregateError);
        expect((error as AggregateError).message).toBe("2 个 mock 账号启动失败");
        expect((error as AggregateError).errors).toEqual([firstError, secondError]);
    });

    it.each([false, true])("does not start queued accounts after stop (reject=%s)", async reject => {
        const wait = deferred();
        const first = account("first", async () => {
            await wait.promise;
            if (reject) throw new Error("late login failure");
        });
        const second = account("second");
        const adapter = fakeAdapter([first, second]);
        let settled = false;
        const starting = adapter.start().finally(() => {
            settled = true;
        });
        const result = expect(starting).rejects.toMatchObject({ name: "AbortError" });
        await adapter.stop();
        expect(second.start).not.toHaveBeenCalled();
        expect(settled).toBe(false);
        wait.resolve();
        await result;
        expect(second.start).not.toHaveBeenCalled();
        expect(first.stop).toHaveBeenCalledOnce();
        expect(second.stop).toHaveBeenCalledOnce();
    });

    it("keeps the startup batch cancelled even if stopping an account fails", async () => {
        const wait = deferred();
        const first = account("first", () => wait.promise);
        const stopError = new Error("account stop failed");
        vi.mocked(first.stop).mockRejectedValueOnce(stopError);
        const second = account("second");
        const adapter = fakeAdapter([first, second]);
        const result = expect(adapter.start()).rejects.toMatchObject({ name: "AbortError" });
        await expect(adapter.stop()).rejects.toBe(stopError);
        expect(second.stop).toHaveBeenCalledOnce();
        wait.resolve();
        await result;
        expect(second.start).not.toHaveBeenCalled();
    });

    it("stopping one account cancels its batch but not a separate account start", async () => {
        const firstWait = deferred();
        const secondWait = deferred();
        const first = account("first", () => firstWait.promise);
        const second = account("second", () => secondWait.promise);
        const adapter = fakeAdapter([first, second]);
        const firstResult = expect(adapter.start("first")).rejects.toMatchObject({ name: "AbortError" });
        const secondResult = adapter.start("second");
        await adapter.stop("first");
        firstWait.resolve();
        secondWait.resolve();
        await firstResult;
        await expect(secondResult).resolves.toBeUndefined();
        expect(second.stop).not.toHaveBeenCalled();
    });

    it("stopping a queued account invalidates the containing full batch", async () => {
        const wait = deferred();
        const first = account("first", () => wait.promise);
        const second = account("second");
        const adapter = fakeAdapter([first, second]);
        const result = expect(adapter.start()).rejects.toMatchObject({ name: "AbortError" });
        await adapter.stop("second");
        wait.resolve();
        await result;
        expect(second.start).not.toHaveBeenCalled();
        expect(first.stop).not.toHaveBeenCalled();
    });

    it("a fresh start after stop is independent of the old pending batch", async () => {
        const wait = deferred();
        const first = account("first", () => wait.promise);
        const second = account("second");
        const adapter = fakeAdapter([first, second]);
        const result = expect(adapter.start()).rejects.toMatchObject({ name: "AbortError" });
        await adapter.stop();
        await adapter.start("second");
        wait.resolve();
        await result;
        expect(second.start).toHaveBeenCalledOnce();
    });

    it("fails closed when an adapter does not implement manual lifecycle control", async () => {
        const adapter = {
            platform: "mock",
            unsupported: Adapter.prototype.unsupported,
        } as Adapter;

        await expect(Adapter.prototype.setOnline.call(adapter, "demo")).rejects.toMatchObject({
            name: "UnsupportedCapabilityError",
            capability: "account.set_online",
            reason: "not_implemented",
        } satisfies Partial<UnsupportedCapabilityError>);
        await expect(Adapter.prototype.setOffline.call(adapter, "demo")).rejects.toMatchObject({
            name: "UnsupportedCapabilityError",
            capability: "account.set_offline",
            reason: "not_implemented",
        } satisfies Partial<UnsupportedCapabilityError>);
    });

    it("reports only lifecycle controls that the adapter really overrides", () => {
        const getter = Object.getOwnPropertyDescriptor(
            Adapter.prototype,
            "accountLifecycleControl",
        )?.get;
        expect(getter).toBeTypeOf("function");

        expect(
            getter?.call({
                setOnline: Adapter.prototype.setOnline,
                setOffline: Adapter.prototype.setOffline,
            }),
        ).toEqual({ online: false, offline: false });
        expect(
            getter?.call({
                setOnline: vi.fn(),
                setOffline: Adapter.prototype.setOffline,
            }),
        ).toEqual({ online: true, offline: false });
    });
});

function account(
    accountId: string,
    startImplementation: () => Promise<void> = async () => undefined,
): Account {
    return {
        account_id: accountId,
        start: vi.fn(startImplementation),
        stop: vi.fn(async () => undefined),
    } as unknown as Account;
}

class TestAdapter extends Adapter {
    constructor() {
        const logger = { info: vi.fn(), error: vi.fn() };
        super({ db: { create: vi.fn() }, getLogger: () => logger } as unknown as BaseApp, "mock");
    }

    createAccount(): never {
        throw new Error("测试不创建账号");
    }
}

function fakeAdapter(accounts: Account[]) {
    const adapter = new TestAdapter();
    adapter.accounts = new Map(accounts.map(item => [String(item.account_id), item]));
    return adapter;
}

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => {
        resolve = done;
    });
    return { promise, resolve };
}
