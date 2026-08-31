import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline/promises";
import yaml from "js-yaml";
import { ProtocolRegistry } from "@onebots/core";
import { writeCliOutput } from "./cli-output.js";
import { validateRuntimeConfig } from "./runtime-config-validator.js";
import {
    createBaseSetupConfig,
    createProtocolDefaults,
    formatSetupCommand,
    normalizePluginNames,
} from "./setup-config.js";

export interface SetupOptions {
    force?: boolean;
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
export async function runSetup(configPath: string, options: SetupOptions = {}): Promise<void> {
    const exists = fs.existsSync(configPath);
    if (exists && !options.force && !process.stdin.isTTY) {
        writeCliOutput(`配置文件已存在: ${configPath}`);
        writeCliOutput("非交互环境不会覆盖；如需更新请使用 --force。");
        return;
    }

    let config = exists
        ? (yaml.load(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>) || {}
        : createBaseSetupConfig();

    let adapters = options.adapters ?? [];
    let protocols = options.protocols ?? [];
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
    if (!exists) {
        config.general = createProtocolDefaults(ProtocolRegistry.getAllSchemas());
    }

    await validateConfig(config);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    if (exists) fs.copyFileSync(configPath, `${configPath}.bak`);
    const temporary = `${configPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, yaml.dump(config, { noRefs: true }), {
        encoding: "utf8",
        mode: 0o600,
    });
    fs.renameSync(temporary, configPath);
    fs.mkdirSync(path.join(path.dirname(configPath), "data"), { recursive: true });
    writeCliOutput(`配置已就绪: ${configPath}`);
    writeCliOutput(`前台启动: ${formatSetupCommand(configPath, adapters, protocols)}`);
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
