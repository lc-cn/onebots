import { rm } from "node:fs/promises";
import { AccountStatus, BaseApp, SqliteDB, type Account } from "onebots";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZulipAdapter } from "./adapter.js";
import { ZulipClient } from "./client.js";

const databasePath = `/tmp/onebots-zulip-adapter-${process.pid}`;
const config: Account.Config<"zulip"> = {
    platform: "zulip",
    account_id: "bot",
    server_url: "https://example.zulipchat.com",
    email: "bot@example.com",
    api_key: "secret",
    event_queue: { enabled: false },
};

describe("ZulipAdapter", () => {
    let database: SqliteDB;
    let adapter: ZulipAdapter;

    beforeEach(() => {
        database = new SqliteDB(databasePath);
        adapter = new ZulipAdapter({
            db: database,
            config: { general: {} },
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
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        database.close();
        await rm(`${databasePath}.db`, { force: true });
    });

    it("完成 Pending、Online、Offline 生命周期", async () => {
        vi.spyOn(ZulipClient.prototype, "start").mockResolvedValue();
        vi.spyOn(ZulipClient.prototype, "stop").mockResolvedValue();
        vi.spyOn(ZulipClient.prototype, "getMe").mockResolvedValue({
            user_id: 1,
            email: config.email,
            full_name: "OneBots",
            avatar_url: "https://example.com/avatar.png",
        });
        const account = adapter.createAccount(config);
        adapter.accounts.set(config.account_id, account);

        await adapter.start(config.account_id);
        await vi.waitFor(() => expect(account.status).toBe(AccountStatus.Online));
        expect(account.nickname).toBe("OneBots");

        await adapter.stop(config.account_id);
        expect(account.status).toBe(AccountStatus.OffLine);
    });

    it("发送频道消息时保留频道 ID 和话题", async () => {
        const account = adapter.createAccount(config);
        adapter.accounts.set(config.account_id, account);
        const send = vi.spyOn(account.client, "sendMessage").mockResolvedValue({
            result: "success",
            msg: "",
            id: 99,
        });

        const result = await adapter.sendMessage(config.account_id, {
            scene_type: "group",
            scene_id: adapter.createId("5/releases"),
            message: [{ type: "text", data: { text: "ship it" } }],
        });

        expect(send).toHaveBeenCalledWith({
            type: "channel",
            to: 5,
            topic: "releases",
            content: "ship it",
        });
        expect(result.message_id.string).toBe("99");
    });

    it("使用真实频道订阅者而非整个组织伪装成员", async () => {
        const account = adapter.createAccount(config);
        adapter.accounts.set(config.account_id, account);
        vi.spyOn(account.client, "getSubscribers").mockResolvedValue([2]);
        vi.spyOn(account.client, "getUsers").mockResolvedValue([
            { user_id: 2, email: "alice@example.com", full_name: "Alice", is_admin: true },
            { user_id: 3, email: "bob@example.com", full_name: "Bob" },
        ]);

        const members = await adapter.getGroupMemberList(config.account_id, {
            group_id: adapter.createId(5),
        });

        expect(members).toHaveLength(1);
        expect(members[0]).toMatchObject({ user_name: "alice@example.com", role: "admin" });
    });

    it("使用官方 dm narrow 获取多人私聊历史", async () => {
        const account = adapter.createAccount(config);
        adapter.accounts.set(config.account_id, account);
        const call = vi.spyOn(account.client, "call").mockResolvedValue({
            result: "success",
            msg: "",
            messages: [
                {
                    id: 21,
                    type: "private",
                    sender_id: 2,
                    sender_email: "alice@example.com",
                    sender_full_name: "Alice",
                    content: "hello",
                    timestamp: 100,
                    display_recipient: [
                        { id: 1, email: config.email, full_name: "Bot" },
                        { id: 2, email: "alice@example.com", full_name: "Alice" },
                        { id: 3, email: "bob@example.com", full_name: "Bob" },
                    ],
                },
            ],
        });

        const messages = await adapter.getMessageHistory(config.account_id, {
            scene_type: "direct",
            scene_id: adapter.createId("3,2"),
            limit: 10,
        });

        expect(call).toHaveBeenCalledWith(
            "messages",
            "GET",
            expect.objectContaining({ narrow: [{ operator: "dm", operand: [2, 3] }] }),
        );
        expect(messages[0]?.sender).toMatchObject({
            scene_type: "direct",
            scene_id: { string: "2,3" },
        });
    });

    it("缓存平台 ID、支持反向解析并拒绝非法 ID", () => {
        const first = adapter.createId("5/release");
        const second = adapter.createId("5/release");

        expect(second).toEqual(first);
        expect(adapter.resolveId(first.number).string).toBe("5/release");
        expect(() => adapter.createId(undefined as unknown as string)).toThrow("不能为 undefined");
    });
});
