import { rm } from "node:fs/promises";
import { BaseApp, SqliteDB, type Account } from "onebots";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WechatClawbotAdapter } from "./adapter.js";
import type { IlinkSession } from "./sdk/ilink-types.js";
import { ItemKind } from "./sdk/protocol/wire-models.js";

const databasePath = `/tmp/onebots-wechat-clawbot-adapter-${process.pid}`;
const config: Account.Config<"wechat-clawbot"> = {
    platform: "wechat-clawbot",
    account_id: "internal-name",
    receive_mode: "manual",
};

describe("WechatClawbotAdapter 身份契约", () => {
    let database: SqliteDB;
    let adapter: WechatClawbotAdapter;

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
        adapter = new WechatClawbotAdapter({
            db: database,
            config: { general: {} },
            router: {},
            getLogger: () => logger,
        } as unknown as BaseApp);
    });

    afterEach(async () => {
        database.close();
        await rm(`${databasePath}.db`, { force: true });
    });
    it.each(["stop", "replace", "stopping"])(
        "%s 后迟到二维码和配对码不能污染同 ID 新账号",
        async boundary => {
            const challenge = vi.fn();
            adapter.on("verification:request", challenge);
            const old = adapter.createAccount(config);
            let replacement: ReturnType<WechatClawbotAdapter["createAccount"]> | undefined;
            let releaseStop: (() => void) | undefined;
            let stopping: Promise<void> | undefined;
            try {
                adapter.accounts.set(config.account_id, old);
                old.client.emit("qr", {
                    qrCodeUrl: "https://example.test/current",
                    qrcode: "current",
                });
                old.client.emit("verification_code_required");
                expect(challenge).toHaveBeenCalledTimes(2);
                if (boundary === "stop") await old.stop();
                if (boundary === "stopping") {
                    const pending = new Promise<void>(resolve => {
                        releaseStop = resolve;
                    });
                    const fakeStop = vi.fn(() => pending);
                    old.protocols.push({ lifecycleStatus: "ready", stop: fakeStop } as never);
                    stopping = old.stop();
                    await vi.waitFor(() => expect(fakeStop).toHaveBeenCalledOnce());
                }
                replacement = adapter.createAccount(config);
                if (boundary === "replace") adapter.accounts.set(config.account_id, replacement);
                challenge.mockClear();
                old.client.emit("qr", {
                    qrCodeUrl: "https://example.test/late",
                    qrcode: "late",
                });
                old.client.emit("verification_code_required");
                expect(challenge).not.toHaveBeenCalled();
                releaseStop?.();
                await stopping;
                adapter.accounts.set(config.account_id, replacement);
                replacement.client.emit("qr", {
                    qrCodeUrl: "https://example.test/new",
                    qrcode: "new",
                });
                replacement.client.emit("verification_code_required");
                expect(challenge).toHaveBeenCalledTimes(2);
                expect(challenge.mock.calls.map(([request]) => request.type)).toEqual([
                    "qrcode",
                    "pair_code",
                ]);
            } finally {
                releaseStop?.();
                await Promise.allSettled(
                    [stopping ?? old.stop(), replacement?.stop()].filter(Boolean),
                );
            }
        },
    );

    it("扫码窗口自动抬高账号有效启动边界并公开到账号摘要", () => {
        expect(adapter.resolveAccountStartupTimeoutSeconds(config)).toBe(480);
        expect(
            adapter.resolveAccountStartupTimeoutSeconds({
                ...config,
                qr_login_timeout_ms: 60_000,
            }),
        ).toBe(60);

        const account = adapter.createAccount(config);
        expect(account.info.startupTimeoutSeconds).toBe(480);
    });

    it("将出站文本格式传入 iLink 运行时", () => {
        const account = adapter.createAccount({
            ...config,
            outbound_text_format: "markdown",
        });

        expect(account.client.getConfig().outbound_text_format).toBe("markdown");
    });

    it("恢复会话后登录信息与事件都使用真实 ilink_bot_id", async () => {
        const account = adapter.createAccount(config);
        adapter.accounts.set(config.account_id, account);
        const session: IlinkSession = {
            token: "secret",
            accountId: "ilink-bot-native",
            baseUrl: "https://ilinkai.weixin.qq.com",
            cdnBaseUrl: "https://novac2c.cdn.weixin.qq.com/c2c",
        };
        vi.spyOn(account.client, "getSession").mockResolvedValue(session);

        await expect(adapter.getLoginInfo(config.account_id)).resolves.toMatchObject({
            user_id: { string: "ilink-bot-native" },
        });

        const dispatch = vi.spyOn(account, "dispatchAwaited");
        account.client.emit("message", {
            id: 42,
            seq: undefined,
            type: "text",
            chat: { id: "peer", type: "private" },
            from: { id: "peer" },
            date: 1_700_000_000_000,
            text: "hello",
            raw: {
                message_id: 42,
                message_type: 1,
                from_user_id: "peer",
                item_list: [{ type: ItemKind.Text, text_item: { text: "hello" } }],
            },
        });
        await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                bot_id: expect.objectContaining({ string: "ilink-bot-native" }),
            }),
        );
    });
});
