import { describe, expect, it, vi } from "vitest";
import { ICQQAdapter } from "./adapter.js";
import { projectICQQFriendChange } from "./events.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BaseApp, SqliteDB, type Account } from "onebots";

describe("ICQQ 账号统一 ID", () => {
    it.each(["stop", "replace", "stopping"])(
        "%s 后旧实例验证事件不污染同 ID 新账号",
        async boundary => {
            const directory = await mkdtemp(join(tmpdir(), "onebots-icqq-verification-"));
            let database: SqliteDB | undefined;
            let old: ReturnType<ICQQAdapter["createAccount"]> | undefined;
            let replacement: ReturnType<ICQQAdapter["createAccount"]> | undefined;
            let releaseStop: (() => void) | undefined;
            let stopping: Promise<void> | undefined;
            const logger = {
                trace: vi.fn(),
                debug: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
                fatal: vi.fn(),
                mark: vi.fn(),
            };
            try {
                database = new SqliteDB(join(directory, "state"));
                const adapter = new ICQQAdapter({
                    db: database,
                    config: { general: {} },
                    router: {},
                    getLogger: () => logger,
                } as unknown as BaseApp);
                const config: Account.Config<"icqq"> = { platform: "icqq", account_id: "12345678" };
                const challenge = vi.fn();
                const cleared = vi.fn();
                const qr = vi.fn();
                adapter.on("verification:request", challenge);
                adapter.on("verification:clear", cleared);
                adapter.on("qrcode", qr);
                old = adapter.createAccount(config);
                adapter.accounts.set(config.account_id, old);
                old.client.emit("qrcode", { image: Buffer.from("current challenge") });
                expect(challenge).toHaveBeenCalledOnce();
                expect(qr).toHaveBeenCalledOnce();
                if (boundary === "stop") await old.stop();
                if (boundary === "stopping") {
                    const pending = new Promise<void>(resolve => {
                        releaseStop = resolve;
                    });
                    const fakeStop = vi.fn(() => pending);
                    old.protocols.push({
                        lifecycleStatus: "ready",
                        stop: fakeStop,
                    } as never);
                    stopping = old.stop();
                    await vi.waitFor(() => expect(fakeStop).toHaveBeenCalledOnce());
                }
                replacement = adapter.createAccount(config);
                if (boundary === "replace") adapter.accounts.set(config.account_id, replacement);
                challenge.mockClear();
                cleared.mockClear();
                qr.mockClear();
                old.client.emit("qrcode", { image: Buffer.from("late challenge") });
                old.client.emit("offline", { uin: 12345678, message: "late offline" });
                expect(challenge).not.toHaveBeenCalled();
                expect(cleared).not.toHaveBeenCalled();
                expect(qr).not.toHaveBeenCalled();
                releaseStop?.();
                await stopping;
                adapter.accounts.set(config.account_id, replacement);
                replacement.client.emit("qrcode", { image: Buffer.from("new challenge") });
                expect(challenge).toHaveBeenCalledOnce();
                expect(qr).toHaveBeenCalledOnce();
            } finally {
                releaseStop?.();
                await Promise.allSettled(
                    [stopping ?? old?.stop(), replacement?.stop()].filter(Boolean),
                );
                try {
                    database?.close();
                } finally {
                    await rm(directory, { recursive: true, force: true });
                }
            }
        },
    );
    it("将配置中的数字 QQ 号恢复为 number 后投影 CommonEvent.bot_id", () => {
        const adapter = Object.create(ICQQAdapter.prototype) as ICQQAdapter;
        const createId = vi.fn((value: string | number) => ({
            string: String(value),
            number: typeof value === "number" ? value : 99_000_000_001,
            source: value,
        }));
        Object.defineProperty(adapter, "createId", { value: createId });

        const context = adapter["projectionContext"]("12345678");
        const event = projectICQQFriendChange(
            {
                raw_event: {},
                user_id: 10001,
                nickname: "Alice",
                change_type: "increase",
                time: 1_700_000_000,
            },
            context,
        );

        expect(createId).toHaveBeenCalledWith(12345678);
        expect(context.botId).toEqual({
            string: "12345678",
            number: 12345678,
            source: 12345678,
        });
        expect(event.bot_id).toBe(context.botId);
    });
});
