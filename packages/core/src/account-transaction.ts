import * as fs from "node:fs";
import yaml from "js-yaml";
import type { Account } from "./account.js";
import type { Adapter } from "./adapter.js";
import { FailureCollector } from "./async-utils.js";
import { writeConfigFileAtomic } from "./config-file.js";
import { ConfigError } from "./errors.js";
import { deepClone } from "./utils.js";

export interface AccountTransactionHost {
    isReloading: boolean;
    config: Record<string, unknown>;
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
    constructor() {
        super("OneBots 配置正在变更，请稍后重试账号操作");
        this.name = "AccountMutationConflictError";
    }
}

/**
 * 原子切换一个账号的运行态与磁盘配置。
 *
 * 操作期间复用 isReloading 作为 readiness 与并发锁；运行态或写盘失败时，
 * 会重建旧账号并恢复旧文件。回滚也失败时同时保留所有证据。
 */
export async function mutateAccountAtomically(options: AccountTransactionOptions): Promise<void> {
    const { host } = options;
    if (host.isReloading) throw new AccountMutationConflictError();
    host.isReloading = true;

    const dependencies: AccountTransactionDependencies = {
        serialize: options.dependencies?.serialize ?? defaultDependencies.serialize,
        write: options.dependencies?.write ?? defaultDependencies.write,
    };
    const previousEntry = host.config[options.configKey];
    const previousFile = fs.existsSync(options.configPath)
        ? fs.readFileSync(options.configPath, "utf8")
        : undefined;
    let previousRuntimeConfig: Account.Config | undefined;

    try {
        previousRuntimeConfig = await switchAccountRuntime(options, options.nextConfig);
        if (options.nextConfig) host.config[options.configKey] = options.nextConfig;
        else delete host.config[options.configKey];
        const content = dependencies.serialize(host.config);

        try {
            dependencies.write(options.configPath, content, true);
            options.onPersisted(options.configPath, content);
        } catch (error) {
            restoreConfigEntry(host.config, options.configKey, previousEntry);
            const failures = new FailureCollector();
            failures.add(error);
            await failures.capture(() => switchAccountRuntime(options, previousRuntimeConfig));
            await failures.capture(() => {
                if (previousFile === undefined) fs.rmSync(options.configPath, { force: true });
                else dependencies.write(options.configPath, previousFile, false);
            });
            if (previousFile !== undefined) {
                await failures.capture(() => options.onPersisted(options.configPath, previousFile));
            }
            throwCollectedFailures(failures, "账号配置持久化失败且回滚未完整完成");
        }
    } finally {
        host.isReloading = false;
    }
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

        const candidate = adapter.createAccount(nextConfig);
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
        restored = options.adapter.createAccount(previousConfig);
        options.adapter.accounts.set(options.accountId, restored);
    });
    if (restored && options.runtimeStarted) {
        await failures.capture(() => restored!.start());
    }
}

function restoreConfigEntry(config: Record<string, unknown>, key: string, previous: unknown): void {
    if (previous === undefined) delete config[key];
    else config[key] = previous;
}

function throwCollectedFailures(failures: FailureCollector, message: string): never {
    failures.throwIfAny(message);
    throw new Error(message);
}
