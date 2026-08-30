/**
 * 微信客服适配器基础契约测试。
 *
 * 覆盖生命周期、标准消息发送、路由挂载，以及平台 ID 的创建、缓存与反向解析。
 */
import { rm } from "node:fs/promises";
import { AccountStatus, BaseApp, SqliteDB, type Account } from "onebots";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WeComKfAdapter } from "./adapter.js";
import { WeComKfClient } from "./client.js";

const databasePath = `/tmp/onebots-wecom-kf-adapter-${process.pid}`;
const config: Account.Config<"wecom-kf"> = {
    platform: "wecom-kf",
    account_id: "customer-service",
    corp_id: "ww-corp",
    corp_secret: "secret",
    token: "callback-token",
    encoding_aes_key: Buffer.alloc(32, 1).toString("base64").slice(0, 43),
    open_kfid: "wk-default",
};

describe("WeComKfAdapter 基础契约", () => {
    let database: SqliteDB;
    let adapter: WeComKfAdapter;
    let route: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        database = new SqliteDB(databasePath);
        route = vi.fn();
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
            router: { all: route },
            getLogger: () => logger,
        } as unknown as BaseApp;
        adapter = new WeComKfAdapter(app);
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        database.close();
        await rm(`${databasePath}.db`, { force: true });
    });

    it("完成 Pending 到 Online 再到 Offline 的生命周期并挂载共享路由", async () => {
        vi.spyOn(WeComKfClient.prototype, "getAccessToken").mockResolvedValue("access-token");
        const account = adapter.createAccount(config);
        adapter.accounts.set(config.account_id, account);

        expect(account.status).toBe(AccountStatus.Pending);
        expect(route).toHaveBeenCalledWith(
            "/wecom-kf/customer-service/webhook",
            expect.any(Function),
        );

        await adapter.start(config.account_id);
        await vi.waitFor(() => expect(account.status).toBe(AccountStatus.Online));

        await adapter.stop(config.account_id);
        expect(account.status).toBe(AccountStatus.OffLine);
    });

    it("通过标准私聊动作发送并保持消息 ID 往返", async () => {
        vi.spyOn(WeComKfClient.prototype, "sendMessage").mockResolvedValue("platform-message");
        const account = adapter.createAccount(config);
        adapter.accounts.set(config.account_id, account);

        const result = await adapter.sendMessage(config.account_id, {
            scene_type: "private",
            scene_id: adapter.createId("customer-1"),
            message: [{ type: "text", data: { text: "你好" } }],
        });

        expect(result.message_id.string).toBe("platform-message");
        expect(adapter.resolveId(result.message_id.number).string).toBe("platform-message");
    });

    it("从事件内层字段恢复客户与客服账号会话上下文", async () => {
        const account = adapter.createAccount({ ...config, open_kfid: undefined });
        adapter.accounts.set(config.account_id, account);
        const send = vi.spyOn(account.client, "sendMessage").mockResolvedValue("message-1");
        await account.client.ingest(
            {
                msgid: "event-1",
                msgtype: "event",
                event: {
                    event_type: "enter_session",
                    open_kfid: "wk-event",
                    external_userid: "customer-event",
                },
            },
            "wk-callback",
        );

        await adapter.sendMessage(config.account_id, {
            scene_type: "private",
            scene_id: adapter.createId("customer-event"),
            message: ["欢迎咨询"],
        });

        expect(send).toHaveBeenCalledWith(
            "customer-event",
            "wk-event",
            expect.objectContaining({ msgtype: "text" }),
        );
        await expect(adapter.getStatus(config.account_id)).resolves.toMatchObject({
            bots: [{ self: { string: "wk-event" } }],
        });
    });

    it("缓存平台 ID 并拒绝空 ID", () => {
        const first = adapter.createId("customer-1");
        const second = adapter.createId("customer-1");

        expect(second).toEqual(first);
        expect(adapter.resolveId(first.number).string).toBe("customer-1");
        expect(() => adapter.createId(undefined as unknown as string)).toThrow("不能为 undefined");
    });

    it("没有默认账号时只接受唯一的真实客服身份", async () => {
        const account = adapter.createAccount({ ...config, open_kfid: undefined });
        adapter.accounts.set(config.account_id, account);
        vi.spyOn(account.client, "listAccounts").mockResolvedValue([
            { open_kfid: "wk-1", name: "客服一" },
            { open_kfid: "wk-2", name: "客服二" },
        ]);

        await expect(adapter.getLoginInfo(config.account_id)).rejects.toMatchObject({
            code: "WECOM_KF_ACCOUNT_CONTEXT_REQUIRED",
        });
    });
});
