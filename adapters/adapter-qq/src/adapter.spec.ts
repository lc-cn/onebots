import { rm } from "node:fs/promises";
import { AccountStatus, BaseApp, SqliteDB, type Account } from "onebots";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QQAdapter } from "./adapter.js";
import { QQClient } from "./client.js";

const databasePath = `/tmp/onebots-qq-adapter-${process.pid}`;
const config: Account.Config<"qq"> = {
    platform: "qq",
    account_id: "official-bot",
    appid: "app-id",
    secret: "app-secret",
    receive_mode: "manual",
};

describe("QQAdapter 生命周期", () => {
    let database: SqliteDB;
    let adapter: QQAdapter;

    beforeEach(() => {
        database = new SqliteDB(databasePath);
        const logger = {
            trace: vi.fn(),
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            fatal: vi.fn(),
            mark: vi.fn(),
        };
        const app = {
            db: database,
            config: { general: {} },
            router: { post: vi.fn() },
            getLogger: () => logger,
        } as unknown as BaseApp;
        adapter = new QQAdapter(app);
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        database.close();
        await rm(`${databasePath}.db`, { force: true });
    });

    it("等待 Client READY 并传递账号启动信号", async () => {
        const start = vi.spyOn(QQClient.prototype, "start").mockImplementation(async function (
            this: QQClient,
            signal,
        ) {
            expect(signal).toBeInstanceOf(AbortSignal);
            vi.spyOn(this, "getCachedSelf").mockReturnValue({
                id: "bot-openid",
                username: "Official Bot",
            });
        });
        vi.spyOn(QQClient.prototype, "close").mockImplementation(() => undefined);
        const account = adapter.createAccount(config);
        adapter.accounts.set(config.account_id, account);

        await adapter.start(config.account_id);

        expect(start).toHaveBeenCalledWith(expect.any(AbortSignal));
        expect(account.status).toBe(AccountStatus.Online);
        expect(account.nickname).toBe("Official Bot");
        await adapter.stop(config.account_id);
        expect(account.status).toBe(AccountStatus.OffLine);
    });
});
