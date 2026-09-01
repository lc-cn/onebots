import { describe, expect, it, vi } from "vitest";
import { AccountStatus } from "onebots";
import { createHeychatAccount } from "./account.js";

describe("黑盒语音账号生命周期", () => {
    it("把 Account 启动信号传给底层 Bot", async () => {
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
        const adapter = {
            platform: "heychat",
            app: {
                config: { timeout: 1, general: {} },
                getLogger: () => logger,
            },
            logger,
            createId: (value: string | number) => ({ string: String(value) }),
            resolveAccountStartupTimeoutSeconds: () => 0,
        };
        const account = createHeychatAccount(adapter as never, {
            account_id: "bot",
            token: "token",
            receive_mode: "manual",
        });
        let receivedSignal: AbortSignal | undefined;
        vi.spyOn(account.client, "start").mockImplementation(async signal => {
            receivedSignal = signal;
        });

        await account.start();

        expect(receivedSignal).toBeInstanceOf(AbortSignal);
        expect(receivedSignal?.aborted).toBe(false);
        expect(account.status).toBe(AccountStatus.Pending);
        await account.stop();
    });
});
