import { describe, expect, it, vi } from "vitest";
import type { Account, Protocol } from "@onebots/core";
import { CliError, runStartedMcpStdio } from "./command-application.js";

describe("MCP stdio application handoff", () => {
    it("stops the started application when no account is available", async () => {
        const app = fakeApp([]);
        const loadTransport = vi.fn();

        await expect(
            runStartedMcpStdio(app, undefined, loadTransport, async () => undefined),
        ).rejects.toMatchObject({
            message: "没有可用的账号，请在配置中添加至少一个适配器账号",
            exitCode: 2,
        });

        expect(app.stop).toHaveBeenCalledOnce();
        expect(loadTransport).not.toHaveBeenCalled();
        expect(app.enhancedLogger.error).toHaveBeenCalledWith(
            "MCP stdio 交接失败，正在停止已启动的应用",
            expect.objectContaining({ error: expect.stringContaining("没有可用的账号") }),
        );
    });

    it("stops the application when the verified protocol entry cannot provide stdio", async () => {
        const app = fakeApp([mcpAccount()]);

        await expect(
            runStartedMcpStdio(
                app,
                undefined,
                async () => {
                    throw new Error("verified entry incompatible");
                },
                async () => undefined,
            ),
        ).rejects.toThrow("verified entry incompatible");

        expect(app.stop).toHaveBeenCalledOnce();
    });

    it("preserves both startup and cleanup failures", async () => {
        const cleanupError = new Error("cleanup failed");
        const app = fakeApp([], cleanupError);

        await expect(
            runStartedMcpStdio(app, undefined, vi.fn(), async () => undefined),
        ).rejects.toMatchObject({
            message: expect.stringContaining("MCP stdio 启动失败且应用清理失败"),
            errors: [expect.any(CliError), cleanupError],
        });
        expect(app.enhancedLogger.error).toHaveBeenCalledWith(
            "MCP stdio 交接失败后的应用清理未完成",
            { error: "cleanup failed" },
        );
    });

    it("hands off the selected protocol and stops only once for repeated close signals", async () => {
        const protocol = { name: "mcp", version: "v1" } as Protocol;
        const app = fakeApp([mcpAccount(protocol)]);
        let onClose: (() => void | Promise<void>) | undefined;
        const startTransport = vi.fn(options => {
            onClose = options.onClose;
        });

        await runStartedMcpStdio(
            app,
            "mock/bot-1",
            async () => startTransport,
            async () => undefined,
        );

        expect(startTransport).toHaveBeenCalledWith({ protocol, onClose: expect.any(Function) });
        await onClose?.();
        await onClose?.();
        expect(app.stop).toHaveBeenCalledOnce();
    });
});

function mcpAccount(protocol: Protocol = { name: "mcp", version: "v1" } as Protocol): Account {
    return {
        platform: "mock",
        account_id: "bot-1",
        protocols: [protocol],
    } as unknown as Account;
}

function fakeApp(accounts: Account[], stopError?: Error) {
    const byId = new Map(accounts.map(account => [String(account.account_id), account]));
    const adapter = {
        platform: "mock",
        getAccount: (accountId: string) => byId.get(accountId),
        accounts: byId,
    };
    return {
        adapters: new Map([["mock", adapter]]),
        enhancedLogger: { error: vi.fn() },
        stop: vi.fn(async () => {
            if (stopError) throw stopError;
        }),
    };
}
