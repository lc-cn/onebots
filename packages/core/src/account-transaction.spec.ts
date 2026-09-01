import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Account } from "./account.js";
import type { Adapter } from "./adapter.js";
import { BaseApp } from "./base-app.js";
import {
    AccountMutationConflictError,
    mutateAccountAtomically,
    type AccountTransactionHost,
} from "./account-transaction.js";

const directories: string[] = [];
const originalConfigDir = BaseApp.configDir;

interface TestAccountOptions {
    start?: () => Promise<void>;
    stop?: (force?: boolean) => Promise<void>;
}

function createAccount(config: Account.Config, options: TestAccountOptions = {}): Account {
    return {
        config,
        start: options.start ?? vi.fn(async () => undefined),
        stop: options.stop ?? vi.fn(async () => undefined),
    } as Account;
}

function createFixture(initialEntry?: Account.Config) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-account-transaction-"));
    directories.push(directory);
    const configPath = path.join(directory, "config.yaml");
    const host: AccountTransactionHost = {
        isReloading: false,
        config: initialEntry ? { "mock.10001": initialEntry, general: {} } : { general: {} },
    };
    const initialFile = initialEntry
        ? "mock.10001:\n  platform: mock\n  account_id: '10001'\n  token: old\ngeneral: {}\n"
        : "general: {}\n";
    fs.writeFileSync(configPath, initialFile);
    const adapter = {
        accounts: new Map<string, Account>(),
        createAccount: vi.fn(),
    } as unknown as Adapter;
    return { adapter, configPath, host, initialFile };
}

function options(fixture: ReturnType<typeof createFixture>, nextConfig?: Account.Config) {
    return {
        host: fixture.host,
        adapter: fixture.adapter,
        accountId: "10001",
        nextConfig,
        configKey: "mock.10001",
        configPath: fixture.configPath,
        runtimeStarted: true,
        onPersisted: vi.fn(),
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    BaseApp.configDir = originalConfigDir;
    for (const directory of directories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("account transaction", () => {
    it("新增账号启动失败时清理候选运行态并保留原配置文件", async () => {
        const fixture = createFixture();
        const next = { platform: "mock", account_id: "10001", token: "next" };
        const candidate = createAccount(next, {
            start: vi.fn(async () => {
                throw new Error("登录失败");
            }),
        });
        vi.mocked(fixture.adapter.createAccount).mockReturnValue(candidate);

        await expect(mutateAccountAtomically(options(fixture, next))).rejects.toThrow("登录失败");

        expect(candidate.stop).toHaveBeenCalledWith(true);
        expect(fixture.adapter.accounts.size).toBe(0);
        expect(fixture.host.config).toEqual({ general: {} });
        expect(fs.readFileSync(fixture.configPath, "utf8")).toBe(fixture.initialFile);
        expect(fixture.host.isReloading).toBe(false);
    });

    it("编辑账号启动失败时重建并启动旧账号", async () => {
        const previousConfig = { platform: "mock", account_id: "10001", token: "old" };
        const next = { ...previousConfig, token: "next" };
        const fixture = createFixture(previousConfig);
        const previous = createAccount(previousConfig);
        const candidate = createAccount(next, {
            start: vi.fn(async () => {
                throw new Error("新凭据无效");
            }),
        });
        const restored = createAccount(previousConfig);
        fixture.adapter.accounts.set("10001", previous);
        vi.mocked(fixture.adapter.createAccount)
            .mockReturnValueOnce(candidate)
            .mockReturnValueOnce(restored);

        await expect(mutateAccountAtomically(options(fixture, next))).rejects.toThrow("新凭据无效");

        expect(previous.stop).toHaveBeenCalledOnce();
        expect(candidate.stop).toHaveBeenCalledWith(true);
        expect(restored.start).toHaveBeenCalledOnce();
        expect(fixture.adapter.accounts.get("10001")).toBe(restored);
        expect(fixture.host.config["mock.10001"]).toEqual(previousConfig);
        expect(fs.readFileSync(fixture.configPath, "utf8")).toBe(fixture.initialFile);
    });

    it("写盘失败时回退运行账号、内存配置和磁盘内容", async () => {
        const previousConfig = { platform: "mock", account_id: "10001", token: "old" };
        const next = { ...previousConfig, token: "next" };
        const fixture = createFixture(previousConfig);
        const previous = createAccount(previousConfig);
        const candidate = createAccount(next);
        const restored = createAccount(previousConfig);
        fixture.adapter.accounts.set("10001", previous);
        vi.mocked(fixture.adapter.createAccount)
            .mockReturnValueOnce(candidate)
            .mockReturnValueOnce(restored);
        const write = vi
            .fn<(file: string, content: string) => void>()
            .mockImplementationOnce(() => {
                throw new Error("磁盘已满");
            })
            .mockImplementation((file, content) => fs.writeFileSync(file, content));
        const transactionOptions = options(fixture, next);
        transactionOptions.dependencies = { write };

        await expect(mutateAccountAtomically(transactionOptions)).rejects.toThrow("磁盘已满");

        expect(candidate.stop).toHaveBeenCalledOnce();
        expect(restored.start).toHaveBeenCalledOnce();
        expect(fixture.adapter.accounts.get("10001")).toBe(restored);
        expect(fixture.host.config["mock.10001"]).toEqual(previousConfig);
        expect(fs.readFileSync(fixture.configPath, "utf8")).toBe(fixture.initialFile);
        expect(transactionOptions.onPersisted).toHaveBeenCalledWith(
            fixture.configPath,
            fixture.initialFile,
        );
    });

    it("账号事务进行中拒绝第二个配置变更", async () => {
        const fixture = createFixture();
        const next = { platform: "mock", account_id: "10001", token: "next" };
        let releaseStart: (() => void) | undefined;
        const startGate = new Promise<void>(resolve => {
            releaseStart = resolve;
        });
        vi.mocked(fixture.adapter.createAccount).mockReturnValue(
            createAccount(next, { start: () => startGate }),
        );
        const first = mutateAccountAtomically(options(fixture, next));
        await vi.waitFor(() => expect(fixture.host.isReloading).toBe(true));
        expect(fixture.host.runtimeOperation).toBe("account_configuration");

        await expect(mutateAccountAtomically(options(fixture, next))).rejects.toBeInstanceOf(
            AccountMutationConflictError,
        );

        releaseStart?.();
        await first;
        expect(fixture.host.isReloading).toBe(false);
        expect(fixture.host.runtimeOperation).toBe("idle");
    });

    it("读取旧配置失败时仍释放运行态租约", async () => {
        const fixture = createFixture();
        const next = { platform: "mock", account_id: "10001", token: "next" };
        const transactionOptions = options(fixture, next);
        transactionOptions.configPath = path.dirname(fixture.configPath);

        await expect(mutateAccountAtomically(transactionOptions)).rejects.toThrow();

        expect(fixture.host).toMatchObject({
            isReloading: false,
            runtimeOperation: "idle",
        });
        expect(fixture.adapter.createAccount).not.toHaveBeenCalled();
    });

    it("运行态回滚失败时聚合原始错误和清理证据", async () => {
        const previousConfig = { platform: "mock", account_id: "10001", token: "old" };
        const next = { ...previousConfig, token: "next" };
        const fixture = createFixture(previousConfig);
        fixture.adapter.accounts.set("10001", createAccount(previousConfig));
        const candidate = createAccount(next, {
            start: vi.fn(async () => {
                throw new Error("新账号启动失败");
            }),
            stop: vi.fn(async () => {
                throw new Error("候选账号清理失败");
            }),
        });
        vi.mocked(fixture.adapter.createAccount)
            .mockReturnValueOnce(candidate)
            .mockImplementationOnce(() => {
                throw new Error("旧账号重建失败");
            });

        const result = mutateAccountAtomically(options(fixture, next)).catch(error => error);
        const error = await result;

        expect(error).toBeInstanceOf(AggregateError);
        expect((error as AggregateError).errors).toEqual([
            expect.objectContaining({ message: "新账号启动失败" }),
            expect.objectContaining({ message: "候选账号清理失败" }),
            expect.objectContaining({ message: "旧账号重建失败" }),
        ]);
        expect(fixture.host.isReloading).toBe(false);
    });

    it("BaseApp 在事务开始前拒绝重复账号和并发配置变更", async () => {
        const fixture = createFixture();
        const config = { platform: "mock", account_id: "10001", token: "next" };
        fixture.adapter.accounts.set("10001", createAccount(config));
        const findOrCreateAdapter = vi.fn(() => fixture.adapter);
        const app = {
            isReloading: false,
            adapters: new Map([["mock", fixture.adapter]]),
            findOrCreateAdapter,
            validateAccountConfigCandidate: vi.fn(),
        };

        await expect(BaseApp.prototype.addAccount.call(app, config)).rejects.toThrow(
            "已存在，请使用编辑操作",
        );
        expect(fixture.adapter.createAccount).not.toHaveBeenCalled();

        app.isReloading = true;
        findOrCreateAdapter.mockClear();
        await expect(BaseApp.prototype.addAccount.call(app, config)).rejects.toBeInstanceOf(
            AccountMutationConflictError,
        );
        expect(findOrCreateAdapter).not.toHaveBeenCalled();
    });

    it("BaseApp 新增失败时移除本次创建的空适配器", async () => {
        const fixture = createFixture();
        BaseApp.configDir = path.dirname(fixture.configPath);
        const config = { platform: "mock", account_id: "10001", token: "next" };
        vi.mocked(fixture.adapter.createAccount).mockReturnValue(
            createAccount(config, {
                start: vi.fn(async () => {
                    throw new Error("登录失败");
                }),
            }),
        );
        const adapters = new Map<string, Adapter>();
        const app = {
            isReloading: false,
            isStarted: true,
            config: fixture.host.config,
            adapters,
            findOrCreateAdapter: vi.fn(() => {
                adapters.set("mock", fixture.adapter);
                return fixture.adapter;
            }),
            validateAccountConfigCandidate: vi.fn(),
            onConfigPersisted: vi.fn(),
        };

        await expect(BaseApp.prototype.addAccount.call(app, config)).rejects.toThrow("登录失败");

        expect(adapters.has("mock")).toBe(false);
        expect(fixture.adapter.accounts.size).toBe(0);
    });

    it.each([
        null,
        [],
        {},
        { platform: "", account_id: "10001" },
        { platform: "mock" },
        { platform: "mock", account_id: "bot/name" },
        { platform: "mock", account_id: "bot%2Fchild" },
        { platform: "mock", account_id: ".." },
    ])("BaseApp 在接触适配器前拒绝畸形账号身份 %#", async config => {
        const findOrCreateAdapter = vi.fn();
        const app = { isReloading: false, adapters: new Map(), findOrCreateAdapter };

        await expect(BaseApp.prototype.addAccount.call(app, config as never)).rejects.toThrow(
            /账号配置|platform|account_id/,
        );

        expect(findOrCreateAdapter).not.toHaveBeenCalled();
    });

    it("BaseApp 候选配置校验失败时不创建适配器或账号", async () => {
        const fixture = createFixture();
        const config = { platform: "mock", account_id: "10001", token: "next" };
        const adapters = new Map<string, Adapter>();
        const validateAccountConfigCandidate = vi.fn(() => {
            throw new Error("Schema 校验失败");
        });
        const app = {
            isReloading: false,
            isStarted: true,
            config: fixture.host.config,
            adapters,
            findOrCreateAdapter: vi.fn(() => {
                adapters.set("mock", fixture.adapter);
                return fixture.adapter;
            }),
            validateAccountConfigCandidate,
        };

        await expect(BaseApp.prototype.addAccount.call(app, config)).rejects.toThrow(
            "Schema 校验失败",
        );

        expect(validateAccountConfigCandidate).toHaveBeenCalledWith("mock.10001", config);
        expect(app.findOrCreateAdapter).not.toHaveBeenCalled();
        expect(fixture.adapter.createAccount).not.toHaveBeenCalled();
        expect(adapters.has("mock")).toBe(false);
    });

    it("BaseApp 编辑候选校验失败时不提前修改在线配置", async () => {
        const previousConfig = {
            platform: "mock",
            account_id: "10001",
            token: "old",
            nested: { old: true },
        };
        const nextConfig = {
            platform: "mock",
            account_id: "10001",
            token: "next",
            nested: { next: true },
        };
        const fixture = createFixture(previousConfig);
        fixture.adapter.accounts.set("10001", createAccount(previousConfig));
        const app = {
            isReloading: false,
            config: fixture.host.config,
            adapters: new Map([["mock", fixture.adapter]]),
            validateAccountConfigCandidate: vi.fn(() => {
                throw new Error("Schema 校验失败");
            }),
        };

        await expect(BaseApp.prototype.updateAccount.call(app, nextConfig)).rejects.toThrow(
            "Schema 校验失败",
        );

        const candidate = app.validateAccountConfigCandidate.mock.calls[0][1] as typeof nextConfig;
        expect(app.config["mock.10001"]).toBe(previousConfig);
        expect(app.config["mock.10001"]).toEqual(previousConfig);
        expect(candidate).not.toBe(nextConfig);
        expect(candidate.nested).not.toBe(nextConfig.nested);
        expect(fixture.adapter.createAccount).not.toHaveBeenCalled();
    });
});
