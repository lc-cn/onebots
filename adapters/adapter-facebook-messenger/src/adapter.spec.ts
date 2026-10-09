import { rm } from "node:fs/promises";
import { assertAdapterCapabilityContract, BaseApp, SqliteDB, type Account } from "onebots";
import { describe, expect, it, vi } from "vitest";
import { FacebookMessengerAdapter } from "./adapter.js";
import { createServer } from "node:http";
import { Router } from "../../../packages/core/src/router.js";
import { FailureCollector } from "onebots";
import { FacebookMessengerClient } from "./client.js";

describe("FacebookMessengerAdapter 契约", () => {
    it.each(["stop", "failed-start"])(
        "%s 释放真实路由，同 ID 恢复必须创建新账号",
        async boundary => {
            const databasePath = `/tmp/onebots-facebook-messenger-lifecycle-${process.pid}-${boundary}`;
            const database = new SqliteDB(databasePath);
            const router = new Router(createServer());
            const failures = new FailureCollector();
            const accounts: Array<{ stop(): Promise<void> }> = [];
            const logger = {
                trace: vi.fn(),
                debug: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
                fatal: vi.fn(),
                mark: vi.fn(),
            };
            const adapter = new FacebookMessengerAdapter({
                db: database,
                config: { general: {} },
                router,
                getLogger: () => logger,
            } as unknown as BaseApp);
            const start = vi
                .spyOn(FacebookMessengerClient.prototype, "start")
                .mockResolvedValue(undefined);
            const stop = vi.spyOn(FacebookMessengerClient.prototype, "stop").mockResolvedValue();
            const config: Parameters<typeof adapter.createAccount>[0] = {
                platform: "facebook-messenger" as const,
                account_id: "bot",
                page_id: "100",
                page_access_token: "fixture",
                app_secret: "fixture",
                verify_token: "fixture",
                receive_mode: "webhook",
                http_path: "/events",
            };
            await failures.capture(async () => {
                const old = adapter.createAccount(config);
                accounts.push(old);
                adapter.accounts.set("bot", old);
                expect(router.stack).toHaveLength(2);
                if (boundary === "failed-start") {
                    start.mockRejectedValueOnce(new Error("fixture startup failed"));
                    await expect(old.start()).rejects.toThrow();
                    expect(router.stack).toHaveLength(0);
                } else {
                    await old.start();
                    expect(start).toHaveBeenCalledOnce();
                }
                await old.stop();
                expect(router.stack).toHaveLength(0);
                const current = adapter.createAccount(config);
                accounts.push(current);
                adapter.accounts.set("bot", current);
                await current.start();
                expect(start).toHaveBeenCalledTimes(2);
                expect(router.stack).toHaveLength(2);
                await current.stop();
                expect(router.stack).toHaveLength(0);
            });
            for (const account of accounts) await failures.capture(() => account.stop());
            await failures.capture(() => database.close());
            await failures.capture(() => rm(`${databasePath}.db`, { force: true }));
            router.cleanup();
            start.mockRestore();
            stop.mockRestore();
            failures.throwIfAny("facebook-messenger 账号生命周期回归或清理失败");
        },
    );
    it("能力清单中的 canonical 与平台动作全部有真实实现", async () => {
        const databasePath = `/tmp/onebots-facebook-messenger-${process.pid}`;
        const database = new SqliteDB(databasePath);
        const adapter = new FacebookMessengerAdapter({
            db: database,
            config: { general: {} },
            router: { get: vi.fn(), post: vi.fn() },
            getLogger: () => ({
                trace: vi.fn(),
                debug: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
                fatal: vi.fn(),
                mark: vi.fn(),
            }),
        } as unknown as BaseApp);
        try {
            await expect(assertAdapterCapabilityContract(adapter)).resolves.toBeUndefined();
        } finally {
            database.close();
            await rm(`${databasePath}.db`, { force: true });
        }
    });

    it("账号启动失败时撤销已挂载的 Webhook 路由", async () => {
        const databasePath = `/tmp/onebots-facebook-messenger-start-${process.pid}`;
        const database = new SqliteDB(databasePath);
        const close = vi.fn();
        const adapter = new FacebookMessengerAdapter({
            db: database,
            config: { general: {} },
            router: {
                createRegistrationScope: () => ({
                    run: (operation: () => unknown) => operation(),
                    close,
                }),
                get: vi.fn(),
                post: vi.fn(),
            },
            getLogger: () => ({
                trace: vi.fn(),
                debug: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
                fatal: vi.fn(),
                mark: vi.fn(),
            }),
        } as unknown as BaseApp);
        const account = adapter.createAccount({
            platform: "facebook-messenger",
            account_id: "page",
            page_id: "123456",
            page_access_token: "token",
            app_secret: "secret",
            verify_token: "verify",
            receive_mode: "webhook",
            http_path: "/facebook/start-failure",
        } as Account.Config<"facebook-messenger">);
        adapter.accounts.set(account.account_id, account);
        vi.spyOn(account.client, "start").mockRejectedValue(new Error("start failed"));
        const unmount = vi.spyOn(adapter["httpHost"], "unmount");
        try {
            await expect(account.start()).rejects.toThrow("start failed");
            expect(unmount).toHaveBeenCalledWith(account.account_id);
            expect(close).toHaveBeenCalledOnce();
        } finally {
            await Promise.allSettled([account.stop()]);
            database.close();
            await rm(`${databasePath}.db`, { force: true });
        }
    });
});
