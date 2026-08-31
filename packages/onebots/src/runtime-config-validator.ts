import {
    AdapterRegistry,
    ConfigValidator,
    ProtocolRegistry,
    ValidationError,
    deepClone,
    deepMerge,
    type Schema,
} from "@onebots/core";
import yaml from "js-yaml";
import { getAppConfigSchema } from "./config-schema.js";

export interface RuntimeConfigIssue {
    path: string;
    message: string;
}

/** 解析 YAML 并拒绝数组、标量等不可能作为 OneBots 根配置的值。 */
export function parseRuntimeConfig(source: string): Record<string, unknown> {
    try {
        const parsed = yaml.load(source);
        if (parsed === undefined || parsed === null) return {};
        const config = asConfigObject(parsed);
        if (!config) throw new ValidationError("配置根节点必须是对象");
        return config;
    } catch (error) {
        if (error instanceof ValidationError) throw error;
        throw new ValidationError(
            `YAML 解析失败: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error instanceof Error ? error : undefined },
        );
    }
}

/** 启动前校验当前已加载插件实际会消费的完整配置。 */
export function validateRuntimeConfig(config: Record<string, unknown>): void {
    const schemas = getAppConfigSchema();
    const issues: RuntimeConfigIssue[] = [];
    captureSchemaIssues(config, schemas.base, "", issues);

    const general = asConfigObject(config.general);
    if (config.general !== undefined && !general) {
        issues.push({ path: "general", message: "必须是对象" });
    }

    for (const [key, value] of Object.entries(general ?? {})) {
        const schema = schemas.protocols[key];
        if (!schema) {
            if (looksLikeProtocolKey(key)) {
                issues.push({ path: `general.${key}`, message: `协议 ${key} 未加载` });
            }
            continue;
        }
        const protocolConfig = asConfigObject(value);
        if (!protocolConfig) {
            issues.push({ path: `general.${key}`, message: "必须是对象" });
            continue;
        }
        captureSchemaIssues(protocolConfig, schema, `general.${key}`, issues);
    }

    for (const [rootKey, value] of Object.entries(config)) {
        const [platform, ...accountParts] = rootKey.split(".");
        const accountId = accountParts.join(".");
        if (!accountId) continue;

        const accountConfig = asConfigObject(value);
        if (!accountConfig) {
            issues.push({ path: rootKey, message: "账号配置必须是对象" });
            continue;
        }
        if (!AdapterRegistry.has(platform)) {
            issues.push({ path: rootKey, message: `适配器 ${platform} 未加载` });
            continue;
        }
        const adapterSchema = schemas.adapters[platform];
        if (!adapterSchema) {
            issues.push({ path: rootKey, message: `适配器 ${platform} 未注册配置 Schema` });
        } else {
            captureSchemaIssues(
                { ...accountConfig, account_id: accountId },
                adapterSchema,
                rootKey,
                issues,
            );
        }

        let loadedProtocolCount = 0;
        for (const [key, protocolValue] of Object.entries(accountConfig)) {
            const [protocol, version, ...extra] = key.split(".");
            if (!version || extra.length > 0) continue;
            if (!ProtocolRegistry.has(protocol, version)) {
                if (looksLikeProtocolConfig(protocolValue)) {
                    issues.push({ path: `${rootKey}.${key}`, message: `协议 ${key} 未加载` });
                }
                continue;
            }
            loadedProtocolCount++;
            const protocolSchema = schemas.protocols[key];
            if (!protocolSchema) {
                issues.push({
                    path: `${rootKey}.${key}`,
                    message: `协议 ${key} 未注册配置 Schema`,
                });
                continue;
            }
            const localConfig = asConfigObject(protocolValue);
            if (!localConfig) {
                issues.push({ path: `${rootKey}.${key}`, message: "协议配置必须是对象" });
                continue;
            }
            const inherited = asConfigObject(general?.[key]) ?? {};
            const merged = deepMerge(deepClone(inherited), localConfig) as Record<string, unknown>;
            captureSchemaIssues(merged, protocolSchema, `${rootKey}.${key}`, issues);
        }
        if (loadedProtocolCount === 0) {
            issues.push({
                path: rootKey,
                message: "账号至少需要配置一个已加载的协议出口",
            });
        }
    }

    if (issues.length > 0) {
        throw new ValidationError(
            `运行时配置无效：${issues.map(issue => `${issue.path || "config"}: ${issue.message}`).join("；")}`,
            { context: { issues } },
        );
    }
}

function captureSchemaIssues(
    config: Record<string, unknown>,
    schema: Schema,
    path: string,
    issues: RuntimeConfigIssue[],
): void {
    try {
        ConfigValidator.validate(config, schema, path);
    } catch (error) {
        const context =
            error instanceof ValidationError
                ? (error.context as { errors?: unknown } | undefined)
                : undefined;
        const errors = Array.isArray(context?.errors)
            ? context.errors.filter((item): item is string => typeof item === "string")
            : [];
        if (errors.length > 0) {
            for (const message of errors) issues.push(splitIssue(message, path));
        } else {
            issues.push({
                path,
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }
}

function splitIssue(message: string, fallbackPath: string): RuntimeConfigIssue {
    const separator = message.search(
        /\s(?:is required|must be|length must|does not match|transform failed)|:\s/,
    );
    if (separator <= 0) return { path: fallbackPath, message };
    return { path: message.slice(0, separator), message: message.slice(separator).trim() };
}

function asConfigObject(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function looksLikeProtocolConfig(value: unknown): boolean {
    return asConfigObject(value) !== undefined;
}

function looksLikeProtocolKey(value: string): boolean {
    return /^[a-z][a-z0-9-]*\.v[1-9][0-9]*$/u.test(value);
}
