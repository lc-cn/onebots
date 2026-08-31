import { ConfigValidator, type Schema } from "@onebots/core";

export function createBaseSetupConfig(): Record<string, unknown> {
    return {
        port: 6727,
        log_level: "info",
        timeout: 30,
        general: {},
    };
}

/** 从实际加载协议的 Schema 生成默认值，避免 setup 写入未加载协议。 */
export function createProtocolDefaults(schemas: Record<string, Schema>): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(schemas).map(([key, schema]) => [
            key,
            ConfigValidator.validateWithDefaults({}, schema),
        ]),
    );
}

export function normalizePluginNames(values: readonly string[]): string[] {
    return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

/** 输出可直接粘贴到 POSIX shell 的启动命令。 */
export function formatSetupCommand(
    configPath: string,
    adapters: readonly string[],
    protocols: readonly string[],
): string {
    const args = [
        "onebots",
        "-c",
        configPath,
        ...adapters.flatMap(value => ["-r", value]),
        ...protocols.flatMap(value => ["-p", value]),
    ];
    return args.map(shellArgument).join(" ");
}

function shellArgument(value: string): string {
    if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(value)) return value;
    return `'${value.replace(/'/gu, `'\\''`)}'`;
}
