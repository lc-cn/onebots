import fs from "node:fs";
import {
    BaseApp,
    ConfigError,
    ConfigRestartRequiredError,
    writeConfigFileAtomic,
} from "@onebots/core";
import { parseRuntimeConfig, validateRuntimeConfig } from "./runtime-config-validator.js";
import {
    assertServiceActivationConfigCurrent,
    captureServiceActivationConfig,
} from "./service-activation-config.js";

export interface RuntimeConfigApplicationHost {
    readonly isReloading: boolean;
    reload(config: BaseApp.Config): Promise<void>;
    markRuntimeConfigApplied?(configPath: string, source: string): void;
}

export interface RuntimeConfigApplicationResult {
    applied: boolean;
    restartRequired: boolean;
    changedHostFields: readonly string[];
}

export class RuntimeConfigApplicationConflictError extends ConfigError {
    constructor() {
        super("另一项配置保存或热重载正在进行，请稍后重试");
        this.name = "RuntimeConfigApplicationConflictError";
    }
}

export class RuntimeConfigRollbackConflictError extends AggregateError {
    constructor(errors: Iterable<unknown>) {
        super(errors, "配置应用失败，且磁盘配置已被另一操作更新；已保留最新文件");
        this.name = "RuntimeConfigRollbackConflictError";
    }
}

export class RuntimeConfigPostApplyConflictError extends ConfigError {
    constructor(cause: Error) {
        super("配置运行态处理完成，但磁盘配置已被另一操作更新；已保留最新文件，请重新加载", {
            cause,
        });
        this.name = "RuntimeConfigPostApplyConflictError";
    }
}

export function isRuntimeConfigApplicationConflict(error: unknown): boolean {
    return (
        error instanceof RuntimeConfigApplicationConflictError ||
        error instanceof RuntimeConfigRollbackConflictError ||
        error instanceof RuntimeConfigPostApplyConflictError
    );
}

const activeApplications = new WeakSet<object>();

/** 原子保存配置并尽可能立即应用；运行态失败时恢复磁盘上的上一版本。 */
export async function saveAndApplyRuntimeConfig(
    host: RuntimeConfigApplicationHost,
    content: string,
    configPath = BaseApp.configPath,
): Promise<RuntimeConfigApplicationResult> {
    return runExclusiveRuntimeConfigApplication(host, () =>
        saveAndApplyRuntimeConfigUnlocked(host, content, configPath),
    );
}

/** 从磁盘重新读取并应用配置，与保存操作共享同一并发边界。 */
export async function applyRuntimeConfigFile(
    host: RuntimeConfigApplicationHost,
    configPath = BaseApp.configPath,
): Promise<RuntimeConfigApplicationResult> {
    return runExclusiveRuntimeConfigApplication(host, async () => {
        const source = fs.readFileSync(configPath, "utf8");
        const config = parseRuntimeConfig(source);
        validateRuntimeConfig(config);
        return reloadRuntimeConfig(host, config as BaseApp.Config, configPath, source);
    });
}

async function runExclusiveRuntimeConfigApplication<T>(
    host: RuntimeConfigApplicationHost,
    operation: () => Promise<T>,
): Promise<T> {
    if (host.isReloading || activeApplications.has(host)) {
        throw new RuntimeConfigApplicationConflictError();
    }
    activeApplications.add(host);
    try {
        return await operation();
    } finally {
        activeApplications.delete(host);
    }
}

async function saveAndApplyRuntimeConfigUnlocked(
    host: RuntimeConfigApplicationHost,
    content: string,
    configPath: string,
): Promise<RuntimeConfigApplicationResult> {
    const config = parseRuntimeConfig(content);
    validateRuntimeConfig(config);
    const existed = fs.existsSync(configPath);
    const previousContent = existed ? fs.readFileSync(configPath, "utf8") : undefined;
    writeConfigFileAtomic(configPath, content, { backup: true });
    const candidateSnapshot = captureServiceActivationConfig(configPath);

    let result: RuntimeConfigApplicationResult;
    try {
        result = await reloadRuntimeConfig(host, config as BaseApp.Config, configPath, content);
    } catch (error) {
        try {
            assertServiceActivationConfigCurrent(configPath, candidateSnapshot);
        } catch (conflictError) {
            throw new RuntimeConfigRollbackConflictError([error, conflictError]);
        }
        try {
            if (previousContent === undefined) fs.rmSync(configPath, { force: true });
            else writeConfigFileAtomic(configPath, previousContent);
        } catch (rollbackError) {
            throw new AggregateError(
                [error, rollbackError],
                "配置应用失败，且无法恢复磁盘上的上一版本",
            );
        }
        throw error;
    }
    try {
        assertServiceActivationConfigCurrent(configPath, candidateSnapshot);
    } catch (error) {
        throw new RuntimeConfigPostApplyConflictError(
            error instanceof Error ? error : new Error(String(error)),
        );
    }
    return result;
}

async function reloadRuntimeConfig(
    host: RuntimeConfigApplicationHost,
    config: BaseApp.Config,
    configPath: string,
    source: string,
): Promise<RuntimeConfigApplicationResult> {
    try {
        await host.reload(config);
        host.markRuntimeConfigApplied?.(configPath, source);
        return { applied: true, restartRequired: false, changedHostFields: [] };
    } catch (error) {
        if (error instanceof ConfigRestartRequiredError) {
            return {
                applied: false,
                restartRequired: true,
                changedHostFields: error.changed,
            };
        }
        throw error;
    }
}
