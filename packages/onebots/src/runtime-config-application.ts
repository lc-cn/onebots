import fs from "node:fs";
import {
    BaseApp,
    ConfigError,
    HostConfigRestartRequiredError,
    writeConfigFileAtomic,
    type HostConfigKey,
} from "@onebots/core";
import { parseRuntimeConfig, validateRuntimeConfig } from "./runtime-config-validator.js";

export interface RuntimeConfigApplicationHost {
    readonly isReloading: boolean;
    reload(config: BaseApp.Config): Promise<void>;
}

export interface RuntimeConfigApplicationResult {
    applied: boolean;
    restartRequired: boolean;
    changedHostFields: readonly HostConfigKey[];
}

export class RuntimeConfigApplicationConflictError extends ConfigError {
    constructor() {
        super("另一项配置保存或热重载正在进行，请稍后重试");
        this.name = "RuntimeConfigApplicationConflictError";
    }
}

const activeApplications = new WeakSet<object>();

/** 原子保存配置并尽可能立即应用；运行态失败时恢复磁盘上的上一版本。 */
export async function saveAndApplyRuntimeConfig(
    host: RuntimeConfigApplicationHost,
    content: string,
    configPath = BaseApp.configPath,
): Promise<RuntimeConfigApplicationResult> {
    if (host.isReloading || activeApplications.has(host)) {
        throw new RuntimeConfigApplicationConflictError();
    }
    activeApplications.add(host);
    try {
        return await saveAndApplyRuntimeConfigUnlocked(host, content, configPath);
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

    try {
        await host.reload(config as BaseApp.Config);
        return { applied: true, restartRequired: false, changedHostFields: [] };
    } catch (error) {
        if (error instanceof HostConfigRestartRequiredError) {
            return {
                applied: false,
                restartRequired: true,
                changedHostFields: error.changed,
            };
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
}
