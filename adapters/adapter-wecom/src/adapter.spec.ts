import { rm } from "node:fs/promises";
import { AccountStatus, BaseApp, SqliteDB, type Account } from "onebots";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WeComAdapter } from "./adapter.js";
import { WeComClient } from "./client.js";

const databasePath = `/tmp/onebots-wecom-adapter-${process.pid}`;
const config: Account.Config<"wecom"> = {
    platform: "wecom",
    account_id: "internal-app",
    corp_id: "ww-corp",
    corp_secret: "secret",
    agent_id: "1000001",
    token: "callback-token",
    encoding_aes_key: Buffer.alloc(32, 1).toString("base64").slice(0, 43),
};

describe("WeComAdapter 生命周期", () => {
    let database: SqliteDB;
    let adapter: WeComAdapter;

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
            router: { all: vi.fn() },
            getLogger: () => logger,
        } as unknown as BaseApp;
        adapter = new WeComAdapter(app);
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        database.close();
        await rm(`${databasePath}.db`, { force: true });
    });

    it("把账号启动信号传给 Client 并完成状态迁移", async () => {
        const start = vi.spyOn(WeComClient.prototype, "start").mockResolvedValue({
            errcode: 0,
            errmsg: "ok",
            agentid: 1000001,
            name: "Internal Bot",
        });
        const account = adapter.createAccount(config);
        adapter.accounts.set(config.account_id, account);

        await adapter.start(config.account_id);

        expect(start).toHaveBeenCalledWith(expect.any(AbortSignal));
        expect(account.status).toBe(AccountStatus.Online);
        expect(account.nickname).toBe("Internal Bot");
        await adapter.stop(config.account_id);
        expect(account.status).toBe(AccountStatus.OffLine);
    });

    it("登录信息保留企业微信数字 AgentID", async () => {
        vi.spyOn(WeComClient.prototype, "getCachedAgent").mockReturnValue({
            errcode: 0,
            errmsg: "ok",
            agentid: 1000001,
            name: "Internal Bot",
        });
        const account = adapter.createAccount(config);
        adapter.accounts.set(config.account_id, account);

        await expect(adapter.getLoginInfo(config.account_id)).resolves.toMatchObject({
            user_id: { number: 1000001, string: "1000001", source: 1000001 },
        });
    });
});
