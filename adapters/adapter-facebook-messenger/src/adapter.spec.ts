import { rm } from "node:fs/promises";
import { assertAdapterCapabilityContract, BaseApp, SqliteDB, type Account } from "onebots";
import { describe, expect, it, vi } from "vitest";
import { FacebookMessengerAdapter } from "./adapter.js";

describe("FacebookMessengerAdapter 契约", () => {
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

    it("账号启动失败时撤销已重挂的 Webhook 路由", async () => {
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
