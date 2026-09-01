import { describe, expect, it, vi } from "vitest";
import { AccountStatus } from "onebots";
import { createDingTalkAccount } from "./account.js";

describe("钉钉账号生命周期", () => {
    it("把 Account 启动信号传给底层 Bot", async () => {
        const logger = { info: vi.fn(), error: vi.fn(), debug: vi.fn() };
        const adapter = {
            platform: "dingtalk",
            icon: "icon",
            app: {
                config: { timeout: 1, general: {} },
                getLogger: () => logger,
                router: { post: vi.fn() },
            },
            logger,
            createId: (value: string | number) => ({ string: String(value) }),
            resolveAccountStartupTimeoutSeconds: () => 0,
        };
        const account = createDingTalkAccount(adapter as never, {
            account_id: "bot",
            receive_mode: "manual",
        });
        let receivedSignal: AbortSignal | undefined;
        vi.spyOn(account.client, "start").mockImplementation(async signal => {
            receivedSignal = signal;
        });

        await account.start();

        expect(receivedSignal).toBeInstanceOf(AbortSignal);
        expect(receivedSignal?.aborted).toBe(false);
        expect(account.status).toBe(AccountStatus.Online);
        await account.stop();
        expect(account.status).toBe(AccountStatus.OffLine);
    });
});
