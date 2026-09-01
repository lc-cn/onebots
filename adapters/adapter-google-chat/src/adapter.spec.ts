import { rm } from "node:fs/promises";
import { assertAdapterCapabilityContract, BaseApp, SqliteDB, type Account } from "onebots";
import { describe, expect, it, vi } from "vitest";
import { GoogleChatAdapter } from "./adapter.js";
import { GoogleChatClient } from "./client.js";

describe("GoogleChatAdapter 契约", () => {
    it("能力清单中的 canonical 与平台动作全部有真实实现", async () => {
        const databasePath = `/tmp/onebots-google-chat-adapter-${process.pid}`;
        const database = new SqliteDB(databasePath);
        const adapter = new GoogleChatAdapter({
            db: database,
            config: { general: {} },
            router: { post: vi.fn() },
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

    it("把账号启动取消信号传给客户端", async () => {
        const databasePath = `/tmp/onebots-google-chat-start-${process.pid}`;
        const database = new SqliteDB(databasePath);
        const adapter = new GoogleChatAdapter({
            db: database,
            config: { general: {} },
            router: { post: vi.fn() },
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
        const config: Account.Config<"google-chat"> = {
            platform: "google-chat",
            account_id: "bot",
            auth_mode: "access-token",
            access_token: "token",
            receive_mode: "manual",
        };
        const start = vi.spyOn(GoogleChatClient.prototype, "start").mockResolvedValue();
        try {
            const account = adapter.createAccount(config);
            adapter.accounts.set(config.account_id, account);

            await adapter.start(config.account_id);

            expect(start).toHaveBeenCalledWith(expect.any(AbortSignal));
        } finally {
            database.close();
            await rm(`${databasePath}.db`, { force: true });
        }
    });
});
