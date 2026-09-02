import { rm } from "node:fs/promises";
import { assertAdapterCapabilityContract, BaseApp, SqliteDB } from "onebots";
import { describe, expect, it, vi } from "vitest";
import { TwitchAdapter } from "./adapter.js";

describe("TwitchAdapter 契约", () => {
    it("能力清单中的 canonical 与平台动作全部有真实实现", async () => {
        const databasePath = `/tmp/onebots-twitch-${process.pid}`;
        const database = new SqliteDB(databasePath);
        const adapter = new TwitchAdapter({
            db: database,
            config: { general: {} },
            router: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
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
