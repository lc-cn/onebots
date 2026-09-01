import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline/promises";
import yaml from "js-yaml";
import { ProtocolRegistry, writeConfigFileAtomic } from "@onebots/core";
import { writeCliOutput } from "./cli-output.js";
import {
    formatRuntimeConfigDiagnostic,
    parseRuntimeConfig,
    validateRuntimeConfig,
} from "./runtime-config-validator.js";
import { ensureManagementCredentials, hasManagementCredentials } from "./management-credentials.js";
import {
    createBaseSetupConfig,
    createProtocolDefaults,
    formatConfiguredCommand,
    normalizePluginNames,
} from "./setup-config.js";
import {
    getRuntimePluginSelection,
    setRuntimePluginSelection,
} from "./runtime-plugin-selection.js";
import { ensureRuntimeDataDirectory } from "./runtime-data-directory.js";
import { resolveManagementWebUrl } from "./doctor-endpoint.js";
import {
    inspectSensitiveDirectoryMutationPermissions,
    inspectSensitiveFilePermissions,
} from "./doctor-permissions.js";

export interface SetupOptions {
    force?: boolean;
    reset?: boolean;
    adapters?: string[];
    protocols?: string[];
}

interface PromptRule {
    type?: "string" | "number" | "boolean" | "object" | "array";
    label?: string;
    description?: string;
    default?: unknown;
}

/** 使用配置 schema 引导创建或安全更新 OneBots 配置。 */
export async function runSetup(
    configPath: string,
    options: SetupOptions = {},
    environmentPort: string | undefined = process.env.PORT,
): Promise<void> {
    const exists = fs.existsSync(configPath);
    if (options.reset && !options.force) {
        throw new Error("--reset 会重建配置，必须同时使用 --force 以创建备份");
    }
    const preserveExisting = exists && !options.force && !process.stdin.isTTY;

    let config: Record<string, unknown>;
    if (exists && options.reset) {
        config = createBaseSetupConfig();
        writeCliOutput(`将备份现有配置至 ${configPath}.bak，并从安全默认值重建。`);
    } else if (exists) {
        try {
            config = parseRuntimeConfig(fs.readFileSync(configPath, "utf8"));
        } catch (error) {
            const diagnostic = formatRuntimeConfigDiagnostic(error);
            if (!options.force) {
                throw new Error(
                    `现有配置无法读取：${diagnostic}。请修复配置，或使用 --force 备份并重建。`,
                );
            }
            config = createBaseSetupConfig();
            writeCliOutput(
                `现有配置无法解析，将保留至 ${configPath}.bak 并安全重建：${diagnostic}`,
            );
        }
    } else {
        config = createBaseSetupConfig();
    }

    const configuredPlugins = getRuntimePluginSelection(config);
    let adapters = options.adapters?.length
        ? options.adapters
        : (configuredPlugins?.adapters ?? []);
    let protocols = options.protocols?.length
        ? options.protocols
        : (configuredPlugins?.protocols ?? []);
    if (process.stdin.isTTY && process.stdout.isTTY) {
        const { getAppConfigSchema } = await import("./config-schema.js");
        const baseSchema = getAppConfigSchema().base;
        const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
        try {
            if (exists && !options.force) {
                const answer = (await prompt.question("配置已存在，是否引导修改？ [y/N] "))
                    .trim()
                    .toLowerCase();
                if (answer !== "y" && answer !== "yes") return;
            }
            for (const [key, value] of Object.entries(baseSchema)) {
                const rule = value as PromptRule;
                if (
                    !rule.type ||
                    rule.type === "object" ||
                    rule.type === "array" ||
                    key === "password"
                )
                    continue;
                const current = config[key] ?? rule.default ?? "";
                const answer = (
                    await prompt.question(
                        `${rule.label ?? key}${rule.description ? ` - ${rule.description}` : ""} [${String(current)}]: `,
                    )
                ).trim();
                if (answer) config[key] = parsePromptValue(answer, rule.type);
            }
            const adapterAnswer = (
                await prompt.question(`Adapter（逗号分隔） [${adapters.join(",")}]: `)
            ).trim();
            if (adapterAnswer)
                adapters = adapterAnswer
                    .split(",")
                    .map(value => value.trim())
                    .filter(Boolean);
            const protocolAnswer = (
                await prompt.question(`Protocol（逗号分隔） [${protocols.join(",")}]: `)
            ).trim();
            if (protocolAnswer)
                protocols = protocolAnswer
                    .split(",")
                    .map(value => value.trim())
                    .filter(Boolean);
        } finally {
            prompt.close();
        }
    }

    adapters = normalizePluginNames(adapters);
    protocols = normalizePluginNames(protocols);
    const { loadPlugins } = await import("./runtime.js");
    const failures = await loadPlugins(adapters, protocols);
    if (failures.length > 0) {
        throw new Error(`无法加载插件: ${failures.join(", ")}`);
    }
    if (preserveExisting) {
        await validateConfig(config);
        if (!hasManagementCredentials(config)) {
            throw new Error(
                "现有配置缺少管理凭据，非交互环境不会自动写入。请设置 ONEBOTS_ACCESS_TOKEN，或使用 --force 备份配置并生成鉴权码。",
            );
        }
        verifyPersistedCredentialPermissions(configPath, config);
        const managementUrls = formatSetupManagementUrls(config, environmentPort);
        ensureRuntimeDataDirectory(path.join(path.dirname(configPath), "data"));
        writeCliOutput(`配置文件已存在并通过验证: ${configPath}`);
        writeCliOutput("非交互环境不会覆盖；如需更新请使用 --force。");
        for (const line of managementUrls) writeCliOutput(line);
        return;
    }
    if (adapters.length > 0 || protocols.length > 0 || configuredPlugins) {
        setRuntimePluginSelection(config, { adapters, protocols });
    }
    if (!exists) {
        config.general = createProtocolDefaults(ProtocolRegistry.getAllSchemas());
    }
    const managementCredentials = ensureManagementCredentials(config);
    config = managementCredentials.config;

    await validateConfig(config);
    if (exists && !managementCredentials.generated) {
        verifyPersistedCredentialPermissions(configPath, config);
    }
    const managementUrls = formatSetupManagementUrls(config, environmentPort);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    ensureRuntimeDataDirectory(path.join(path.dirname(configPath), "data"));
    writeConfigFileAtomic(configPath, yaml.dump(config, { noRefs: true }), {
        backup: exists,
        ...(managementCredentials.generated ? { mode: 0o600 } : {}),
    });
    writeCliOutput(`配置已就绪: ${configPath}`);
    if (managementCredentials.generated) {
        writeCliOutput("已生成管理端鉴权码并安全写入配置文件的 access_token 字段。");
        writeCliOutput("鉴权码不会写入服务日志；首次登录时请从配置文件读取。");
    } else if (managementCredentials.source === "environment") {
        writeCliOutput("管理端将使用 ONEBOTS_ACCESS_TOKEN 环境变量，不会生成新的配置鉴权码。");
    }
    if (config.plugins) {
        writeCliOutput("插件选择已写入配置，后续命令无需重复 -r/-p。");
    } else {
        writeCliOutput("尚未选择插件，可先比较平台能力，再通过 Web 扩展中心安装。");
    }
    writeCliOutput(`比较平台能力: ${formatConfiguredCommand(configPath, "capabilities")}`);
    writeCliOutput(`验证配置: ${formatConfiguredCommand(configPath, "doctor")}`);
    writeCliOutput(`前台启动: ${formatConfiguredCommand(configPath)}`);
    for (const line of managementUrls) writeCliOutput(line);
    if (managementCredentials.source === "environment") {
        writeCliOutput(
            "安装服务前请先把管理凭据写入配置；守护服务不会保存当前 shell 的 ONEBOTS_ACCESS_TOKEN。",
        );
        writeCliOutput("可取消该环境变量后使用 setup --force 自动生成持久化鉴权码。");
    } else {
        writeCliOutput(`安装服务: ${formatConfiguredCommand(configPath, "install")}`);
    }
}

/** setup 只有在能够证明既有持久化管理凭据未暴露时，才报告配置已就绪。 */
function verifyPersistedCredentialPermissions(
    configPath: string,
    config: Record<string, unknown>,
): void {
    if (process.platform === "win32") return;
    const resolvedConfigPath = fs.realpathSync(configPath);
    const backupPath = `${resolvedConfigPath}.bak`;
    if (!hasManagementCredentials(config, "") && !fs.existsSync(backupPath)) return;
    const checks = [
        inspectSensitiveFilePermissions(resolvedConfigPath, "config-mode", "配置文件"),
        inspectSensitiveDirectoryMutationPermissions(path.dirname(resolvedConfigPath)),
        ...(fs.existsSync(backupPath)
            ? [inspectSensitiveFilePermissions(backupPath, "config-backup-mode", "配置备份")]
            : []),
    ];
    const errors = checks.filter(check => check.level === "error");
    if (errors.length > 0) {
        throw new Error(
            `现有管理凭据权限不安全：${errors.map(check => check.message).join("；")}。请先运行 ${formatConfiguredCommand(configPath, "doctor")} --fix，或按提示调整目录权限。`,
        );
    }
    for (const warning of checks.filter(check => check.level === "warning")) {
        writeCliOutput(`安全提示：${warning.message}`);
    }
}

function formatSetupManagementUrls(
    config: Record<string, unknown>,
    environmentPort: string | undefined,
): string[] {
    const configured = resolveManagementWebUrl(config);
    const foreground = resolveManagementWebUrl(config, environmentPort);
    return foreground === configured
        ? [`管理地址（启动后）: ${configured}`]
        : [
              `管理地址（当前 PORT 前台启动）: ${foreground}`,
              `管理地址（守护服务配置）: ${configured}`,
          ];
}

function parsePromptValue(value: string, type: PromptRule["type"]): string | number | boolean {
    if (type === "number") {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) throw new Error(`无效数字: ${value}`);
        return parsed;
    }
    if (type === "boolean") {
        if (!["true", "false"].includes(value.toLowerCase()))
            throw new Error(`布尔值必须是 true 或 false: ${value}`);
        return value.toLowerCase() === "true";
    }
    return value;
}

async function validateConfig(config: Record<string, unknown>): Promise<void> {
    const [{ ConfigValidator }, { getAppConfigSchema }] = await Promise.all([
        import("@onebots/core"),
        import("./config-schema.js"),
    ]);
    ConfigValidator.validate(config, getAppConfigSchema().base);
    validateRuntimeConfig(config);
}
