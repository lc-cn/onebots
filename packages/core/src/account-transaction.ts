import * as fs from "node:fs";
import yaml from "js-yaml";
import type { Account } from "./account.js";
import type { Adapter } from "./adapter.js";
import { FailureCollector } from "./async-utils.js";
import { writeConfigFileAtomic } from "./config-file.js";
import { ConfigError } from "./errors.js";
import { acquireRuntimeOperation, type RuntimeOperationHost } from "./runtime-operation.js";
import { createAccountWithRouteScope } from "./scoped-account.js";
import type { Router } from "./router.js";
import { deepClone } from "./utils.js";

export interface AccountTransactionHost extends RuntimeOperationHost {
    config: Record<string, unknown>;
    router?: Router;
}

export interface AccountTransactionDependencies {
    serialize(config: Record<string, unknown>): string;
    write(file: string, content: string, backup: boolean): void;
}

export interface AccountTransactionOptions {
    host: AccountTransactionHost;
    adapter: Adapter;
    accountId: string;
    nextConfig?: Account.Config;
    configKey: string;
    configPath: string;
    runtimeStarted: boolean;
    forceStop?: boolean;
    /** 宿主可在触碰账号运行态前证明磁盘来源仍是当前进程已应用的版本。 */
    assertSourceCurrent?(configPath: string, source: string | undefined): void;
    onPersisted(configPath: string, content: string): void;
    dependencies?: Partial<AccountTransactionDependencies>;
}

const defaultDependencies: AccountTransactionDependencies = {
    serialize: config => yaml.dump(deepClone(config)),
    write: (file, content, backup) => {
        writeConfigFileAtomic(file, content, { backup });
    },
};

export class AccountMutationConflictError extends ConfigError {
    constructor(message = "OneBots 配置正在变更，请稍后重试账号操作", options?: { cause?: Error }) {
        super(message, options);
        this.name = "AccountMutationConflictError";
    }
}

/** 磁盘配置在账号运行态切换期间被外部操作更新。 */
export class AccountConfigDriftError extends AccountMutationConflictError {
    constructor(cause?: Error) {
        super("账号配置在操作期间已被其他进程更新；已保留最新文件，请重试", { cause });
        this.name = "AccountConfigDriftError";
    }
}

/**
 * 原子切换一个账号的运行态与磁盘配置。
 *
 * 操作期间复用 isReloading 作为 readiness 与并发锁，并发布 account_configuration
 * 作为公开诊断原因；运行态或写盘失败时会重建旧账号并恢复旧文件。回滚也失败时
 * 同时保留所有证据。
 */
export async function mutateAccountAtomically(options: AccountTransactionOptions): Promise<string> {
    const { host } = options;
    const runtimeLease = acquireRuntimeOperation(
        host,
        "account_configuration",
        () => new AccountMutationConflictError(),
    );

    try {
        const dependencies: AccountTransactionDependencies = {
            serialize: options.dependencies?.serialize ?? defaultDependencies.serialize,
            write: options.dependencies?.write ?? defaultDependencies.write,
        };
        const previousEntry = host.config[options.configKey];
        const previousFile = readConfigFile(options.configPath);
        let previousRuntimeConfig: Account.Config | undefined;

        options.assertSourceCurrent?.(options.configPath, previousFile);
        previousRuntimeConfig = await switchAccountRuntime(options, options.nextConfig);
        if (options.nextConfig) host.config[options.configKey] = options.nextConfig;
        else delete host.config[options.configKey];

        let content: string | undefined;
        try {
            content = dependencies.serialize(host.config);
            assertConfigFileCurrent(options.configPath, previousFile);
            dependencies.write(options.configPath, content, true);
            assertConfigFileCurrent(options.configPath, content);
            options.onPersisted(options.configPath, content);
            return content;
        } catch (error) {
            restoreConfigEntry(host.config, options.configKey, previousEntry);
            const failures: unknown[] = [error];
            try {
                await switchAccountRuntime(options, previousRuntimeConfig);
            } catch (rollbackError) {
                failures.push(rollbackError);
            }
            if (!(error instanceof AccountConfigDriftError)) {
                try {
                    restoreConfigFileAfterFailure(
                        options.configPath,
                        previousFile,
                        content,
                        dependencies,
                    );
                    if (previousFile !== undefined) {
                        options.onPersisted(options.configPath, previousFile);
                    }
                } catch (rollbackError) {
                    if (rollbackError instanceof AccountConfigDriftError && failures.length === 1) {
                        throw new AccountConfigDriftError(asError(error));
                    }
                    failures.push(rollbackError);
                }
            }
            if (failures.length === 1) throw error;
            throw new AggregateError(failures, "账号配置持久化失败且回滚未完整完成");
        }
    } finally {
        runtimeLease.release();
    }
}

function assertConfigFileCurrent(file: string, expected: string | undefined): void {
    if (readConfigFile(file) !== expected) throw new AccountConfigDriftError();
}

function readConfigFile(file: string): string | undefined {
    try {
        return fs.readFileSync(file, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
    }
}

function restoreConfigFileAfterFailure(
    file: string,
    previous: string | undefined,
    candidate: string | undefined,
    dependencies: AccountTransactionDependencies,
): void {
    const current = readConfigFile(file);
    if (current === previous) return;
    if (current !== candidate) throw new AccountConfigDriftError();
    if (previous === undefined) fs.rmSync(file, { force: true });
    else dependencies.write(file, previous, false);
    assertConfigFileCurrent(file, previous);
}

function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

async function switchAccountRuntime(
    options: AccountTransactionOptions,
    nextConfig: Account.Config | undefined,
): Promise<Account.Config | undefined> {
    const { adapter, accountId, runtimeStarted } = options;
    const previous = adapter.accounts.get(accountId);
    const previousConfig = previous ? deepClone(previous.config) : undefined;
    let previousStopped = false;

    try {
        if (previous) {
            await previous.stop(options.forceStop);
            previousStopped = true;
            adapter.accounts.delete(accountId);
        }
        if (!nextConfig) return previousConfig;

        const candidate = createAccount(options, nextConfig);
        adapter.accounts.set(accountId, candidate);
        if (runtimeStarted) await candidate.start();
        return previousConfig;
    } catch (error) {
        const failures = new FailureCollector();
        failures.add(error);
        const active = adapter.accounts.get(accountId);
        if (active && active !== previous) {
            await failures.capture(() => active.stop(true));
            adapter.accounts.delete(accountId);
        } else if (previous && !previousStopped) {
            await failures.capture(() => previous.stop(true));
            adapter.accounts.delete(accountId);
        }
        await restorePreviousAccount(options, previousConfig, failures);
        throwCollectedFailures(failures, "账号运行态切换失败且回滚未完整完成");
    }
}

async function restorePreviousAccount(
    options: AccountTransactionOptions,
    previousConfig: Account.Config | undefined,
    failures: FailureCollector,
): Promise<void> {
    if (!previousConfig) return;
    let restored: Account | undefined;
    await failures.capture(() => {
        restored = createAccount(options, previousConfig);
        options.adapter.accounts.set(options.accountId, restored);
    });
    if (restored && options.runtimeStarted) {
        await failures.capture(() => restored!.start());
    }
}

function createAccount(options: AccountTransactionOptions, config: Account.Config): Account {
    return createAccountWithRouteScope(options.host, options.adapter, config);
}

function restoreConfigEntry(config: Record<string, unknown>, key: string, previous: unknown): void {
    if (previous === undefined) delete config[key];
    else config[key] = previous;
}

function throwCollectedFailures(failures: FailureCollector, message: string): never {
    failures.throwIfAny(message);
    throw new Error(message);
}
