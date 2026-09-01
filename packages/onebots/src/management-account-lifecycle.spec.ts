import {
    UnsupportedCapabilityError,
    type Account,
    type Adapter,
    type BaseApp,
} from "@onebots/core";
import { describe, expect, it, vi } from "vitest";
import {
    executeManagementAccountLifecycle,
    handleManagementAccountLifecycleSocketAction,
} from "./management-account-lifecycle.js";

describe("management account lifecycle boundary", () => {
    it("keeps the legacy success event while accepting its JSON-string payload", async () => {
        const account = fakeAccount("demo", "online");
        const adapter = fakeAdapter(account);
        const app = host(adapter);

        const response = await handleManagementAccountLifecycleSocketAction(app, {
            action: "bot.start",
            data: JSON.stringify({ platform: "mock", uin: "demo" }),
            echo: "request-1",
        });

        expect(adapter.setOnline).toHaveBeenCalledWith("demo");
        expect(response).toEqual({
            event: "bot.change",
            echo: "request-1",
            data: account.info,
        });
    });

    it("returns a correlated failure receipt for malformed WebSocket JSON", async () => {
        const app = host();

        const response = await handleManagementAccountLifecycleSocketAction(app, {
            action: "bot.stop",
            data: "{",
            echo: 7,
        });

        expect(response).toEqual({
            event: "bot.change.result",
            echo: 7,
            data: {
                success: false,
                action: "bot.stop",
                code: "ACCOUNT_REQUEST_INVALID",
                message: "账号生命周期请求 data 必须是有效 JSON",
            },
        });
        expect(app.logger.error).toHaveBeenCalledOnce();
    });

    it("isolates missing targets and unsupported controls with stable codes", async () => {
        const missing = await executeManagementAccountLifecycle(host(), "bot.start", {
            platform: "missing",
            uin: "demo",
        });
        const account = fakeAccount("demo", "offline");
        const unsupportedAdapter = fakeAdapter(account, {
            setOnline: vi.fn(async () => {
                throw new UnsupportedCapabilityError({
                    platform: "mock",
                    capability: "account.set_online",
                    message: "mock 适配器不支持手动上线账号",
                });
            }),
        });
        const unsupported = await executeManagementAccountLifecycle(
            host(unsupportedAdapter),
            "bot.start",
            { platform: "mock", uin: "demo" },
        );

        expect(missing).toEqual({
            success: false,
            status: 404,
            code: "ACCOUNT_TARGET_NOT_FOUND",
            message: "适配器 missing 不存在",
        });
        expect(unsupported).toEqual({
            success: false,
            status: 501,
            code: "ACCOUNT_LIFECYCLE_UNSUPPORTED",
            message: "mock 适配器不支持手动上线账号",
        });
    });

    it("bounds unexpected plugin errors and keeps them out of rejected message handlers", async () => {
        const account = fakeAccount("demo", "online");
        const adapter = fakeAdapter(account, {
            setOffline: vi.fn(async () => {
                throw new Error(`disconnect failed\n${"x".repeat(700)}`);
            }),
        });
        const app = host(adapter);

        const result = await executeManagementAccountLifecycle(app, "bot.stop", {
            platform: "mock",
            uin: "demo",
        });

        expect(result).toMatchObject({
            success: false,
            status: 500,
            code: "ACCOUNT_LIFECYCLE_FAILED",
        });
        if (result.success === true) throw new Error("expected lifecycle failure");
        expect(result.message).toHaveLength(500);
        expect(result.message).not.toContain("\n");
        expect(app.logger.error).toHaveBeenCalledOnce();
    });

    it("rejects a concurrent operation on the same account across transports", async () => {
        let release!: () => void;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        const account = fakeAccount("demo", "online");
        const adapter = fakeAdapter(account, {
            setOnline: vi.fn(() => gate),
        });
        const app = host(adapter);
        const first = executeManagementAccountLifecycle(app, "bot.start", {
            platform: "mock",
            uin: "demo",
        });
        await vi.waitFor(() => expect(adapter.setOnline).toHaveBeenCalledOnce());

        const conflict = await handleManagementAccountLifecycleSocketAction(app, {
            action: "bot.stop",
            data: { platform: "mock", uin: "demo" },
            echo: "parallel-stop",
        });

        expect(conflict).toEqual({
            event: "bot.change.result",
            echo: "parallel-stop",
            data: {
                success: false,
                action: "bot.stop",
                code: "ACCOUNT_LIFECYCLE_CONFLICT",
                message: "账号 mock.demo 正在执行上线操作，请稍后重试",
            },
        });
        expect(adapter.setOffline).not.toHaveBeenCalled();

        release();
        await expect(first).resolves.toMatchObject({ success: true });
        await expect(
            executeManagementAccountLifecycle(app, "bot.stop", {
                platform: "mock",
                uin: "demo",
            }),
        ).resolves.toMatchObject({ success: true });
        expect(adapter.setOffline).toHaveBeenCalledOnce();
    });

    it("ignores unrelated management messages", async () => {
        await expect(
            handleManagementAccountLifecycleSocketAction(host(), { action: "system.reload" }),
        ).resolves.toBeUndefined();
    });
});

function host(adapter?: Adapter) {
    return {
        adapters: new Map(adapter ? [["mock", adapter]] : []),
        logger: { error: vi.fn() },
    } as unknown as Pick<BaseApp, "adapters" | "logger"> & {
        logger: { error: ReturnType<typeof vi.fn> };
    };
}

function fakeAccount(uin: string, status: string) {
    return { info: { uin, status } } as unknown as Account;
}

function fakeAdapter(account: Account, overrides: Record<string, unknown> = {}) {
    return {
        getAccount: vi.fn((uin: string) => (uin === account.info.uin ? account : undefined)),
        setOnline: vi.fn(async () => undefined),
        setOffline: vi.fn(async () => undefined),
        ...overrides,
    } as unknown as Adapter & {
        setOnline: ReturnType<typeof vi.fn>;
        setOffline: ReturnType<typeof vi.fn>;
    };
}
