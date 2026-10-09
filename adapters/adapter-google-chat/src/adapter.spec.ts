import { rm } from "node:fs/promises";
import { assertAdapterCapabilityContract, BaseApp, SqliteDB, type Account } from "onebots";
import { describe, expect, it, vi } from "vitest";
import { GoogleChatAdapter } from "./adapter.js";
import { createServer } from "node:http";
import { Router } from "../../../packages/core/src/router.js";
import { FailureCollector } from "onebots";
import { GoogleChatClient } from "./client.js";

describe("GoogleChatAdapter 契约", () => {
    it.each(["stop", "failed-start"])(
        "%s 释放真实路由，同 ID 恢复必须创建新账号",
        async boundary => {
            const databasePath = `/tmp/onebots-google-chat-lifecycle-${process.pid}-${boundary}`;
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
            const adapter = new GoogleChatAdapter({
                db: database,
                config: { general: {} },
                router,
                getLogger: () => logger,
            } as unknown as BaseApp);
            const start = vi
                .spyOn(GoogleChatClient.prototype, "start")
                .mockResolvedValue(undefined);
            const stop = vi.spyOn(GoogleChatClient.prototype, "stop").mockResolvedValue();
            const config: Parameters<typeof adapter.createAccount>[0] = {
                platform: "google-chat" as const,
                account_id: "bot",
                auth_mode: "access-token",
                access_token: "fixture",
                receive_mode: "interaction-http",
                http_path: "/events",
                verification_audience: "https://example.test/events",
            };
            await failures.capture(async () => {
                const old = adapter.createAccount(config);
                accounts.push(old);
                adapter.accounts.set("bot", old);
                expect(router.stack).toHaveLength(1);
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
                expect(router.stack).toHaveLength(1);
                await current.stop();
                expect(router.stack).toHaveLength(0);
            });
            for (const account of accounts) await failures.capture(() => account.stop());
            await failures.capture(() => database.close());
            await failures.capture(() => rm(`${databasePath}.db`, { force: true }));
            router.cleanup();
            start.mockRestore();
            stop.mockRestore();
            failures.throwIfAny("google-chat 账号生命周期回归或清理失败");
        },
    );
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
