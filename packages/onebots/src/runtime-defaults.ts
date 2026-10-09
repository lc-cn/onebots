import {
    BaseApp,
    deepClone,
    deepMerge,
    planRuntimeConfiguration,
    type ConfigurationImpact,
    type Protocol,
} from "@onebots/core";

/** 平台与协议共享的配置默认值，不依赖任何管理宿主或认证模块。 */
export const runtimeDefaultConfig: BaseApp.Config = { ...BaseApp.defaultConfig };

export function registerProtocolDefaults<K extends keyof Protocol.Configs>(
    key: K,
    config: Protocol.Config<Protocol.Configs[K]>,
): void {
    runtimeDefaultConfig.general = { ...runtimeDefaultConfig.general, [key]: deepClone(config) };
}

export function mergeRuntimeConfigDefaults(
    config: BaseApp.Config,
    defaults: BaseApp.Config = runtimeDefaultConfig,
): BaseApp.Config {
    const defaultGeneral = defaults.general ?? {};
    const configuredGeneral = config.general ?? {};
    const general = Object.fromEntries(
        [...new Set([...Object.keys(defaultGeneral), ...Object.keys(configuredGeneral)])].map(
            key => [
                key,
                deepMerge(
                    deepClone(defaultGeneral[key] ?? {}),
                    deepClone(configuredGeneral[key] ?? {}),
                ),
            ],
        ),
    );
    return {
        ...defaults,
        ...config,
        general,
    };
}

export function defineConfig(config: BaseApp.Config): BaseApp.Config {
    return config;
}

/** 校验 worker 与网关必须使用同一运行版本的注册表和默认值计算影响。 */
export function planEffectiveRuntimeConfiguration(
    current: BaseApp.Config,
    next: BaseApp.Config,
): ConfigurationImpact {
    return planRuntimeConfiguration(
        { ...mergeRuntimeConfigDefaults(current) },
        { ...mergeRuntimeConfigDefaults(next) },
    );
}
