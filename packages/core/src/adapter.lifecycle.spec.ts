import { describe, expect, it, vi } from "vitest";
import { Adapter } from "./adapter.js";
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
    } as unknown as Account;
}

function fakeAdapter(accounts: Account[]) {
    return {
        platform: "mock",
        accounts: new Map(accounts.map(item => [String(item.account_id), item])),
        logger: { info: vi.fn(), error: vi.fn() },
    } as unknown as Adapter & {
        logger: { info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
    };
}
