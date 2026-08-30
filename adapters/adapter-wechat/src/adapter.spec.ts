import { rm } from "node:fs/promises";
import { BaseApp, SqliteDB, type Account } from "onebots";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WechatAdapter } from "./adapter.js";

const databasePath = `/tmp/onebots-wechat-adapter-${process.pid}`;
const config: Account.Config<"wechat"> = {
    platform: "wechat",
    account_id: "internal-name",
    app_id: "wx-platform-app",
    app_secret: "secret",
    receive_mode: "manual",
};

describe("WechatAdapter 身份契约", () => {
    let database: SqliteDB;
    let adapter: WechatAdapter;

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
        adapter = new WechatAdapter({
            db: database,
            config: { general: {} },
            router: { all: vi.fn() },
            getLogger: () => logger,
        } as unknown as BaseApp);
    });

    afterEach(async () => {
        database.close();
        await rm(`${databasePath}.db`, { force: true });
    });

    it("登录信息和事件统一使用真实 AppID，不泄露内部账号键", async () => {
        const account = adapter.createAccount(config);
        adapter.accounts.set(config.account_id, account);
        await expect(adapter.getLoginInfo(config.account_id)).resolves.toMatchObject({
            user_id: { string: "wx-platform-app" },
            user_name: "wx-platform-app",
        });
        const dispatch = vi.spyOn(account, "dispatch");
        account.client.emit("raw_event", {
            ToUserName: "gh_original",
            FromUserName: "user",
            CreateTime: 10,
            MsgType: "text",
            MsgId: "message-1",
            Content: "hello",
        });
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                bot_id: expect.objectContaining({ string: "wx-platform-app" }),
            }),
        );
    });
});
