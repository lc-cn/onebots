import { rm } from "node:fs/promises";
import { assertAdapterCapabilityContract, BaseApp, SqliteDB } from "onebots";
import { describe, expect, it, vi } from "vitest";
import { MatrixAdapter } from "./adapter.js";
import { createServer } from "node:http";
import { Router } from "../../../packages/core/src/router.js";
import { FailureCollector } from "onebots";
import { MatrixClient } from "./client.js";

describe("MatrixAdapter 契约", () => {
    it.each(["stop", "failed-start"])(
        "%s 释放真实路由，同 ID 恢复必须创建新账号",
        async boundary => {
            const databasePath = `/tmp/onebots-matrix-lifecycle-${process.pid}-${boundary}`;
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
            const adapter = new MatrixAdapter({
                db: database,
                config: { general: {} },
                router,
                getLogger: () => logger,
            } as unknown as BaseApp);
            const start = vi
                .spyOn(MatrixClient.prototype, "start")
                .mockResolvedValue({ user_id: "@bot:example.test" });
            const stop = vi.spyOn(MatrixClient.prototype, "stop").mockResolvedValue();
            const config: Parameters<typeof adapter.createAccount>[0] = {
                platform: "matrix" as const,
                account_id: "bot",
                homeserver_url: "https://example.test",
                user_id: "@bot:example.test",
                receive_mode: "appservice",
                appservice_id: "fixture",
                as_token: "fixture",
                hs_token: "fixture",
                appservice_path: "/events",
            };
            await failures.capture(async () => {
                const old = adapter.createAccount(config);
                accounts.push(old);
                adapter.accounts.set("bot", old);
                expect(router.stack).toHaveLength(4);
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
                expect(router.stack).toHaveLength(4);
                await current.stop();
                expect(router.stack).toHaveLength(0);
            });
            for (const account of accounts) await failures.capture(() => account.stop());
            await failures.capture(() => database.close());
            await failures.capture(() => rm(`${databasePath}.db`, { force: true }));
            router.cleanup();
            start.mockRestore();
            stop.mockRestore();
            failures.throwIfAny("matrix 账号生命周期回归或清理失败");
        },
    );
    it("能力清单中的全部 canonical 与平台动作都有真实实现", async () => {
        const databasePath = `/tmp/onebots-matrix-adapter-${process.pid}`;
        const database = new SqliteDB(databasePath);
        const adapter = new MatrixAdapter({
            db: database,
            config: { general: {} },
            router: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
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
});
