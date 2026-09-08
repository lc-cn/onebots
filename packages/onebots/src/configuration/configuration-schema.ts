import type { ConfigurationDocument, ConfigurationPath } from "./configuration-document.js";

/** 已验证运行版本导出的纯声明数据；不执行 validator/transform/default 函数。 */
export interface ConfigurationSchema {
    [key: string]: unknown;
}
export interface VerifiedProtocolMetadata {
    registrationName: string;
    name: string;
    version: string;
}
export interface ConfigurationSchemaBundle {
    schemaVersion: 1;
    base: ConfigurationSchema;
    general: ConfigurationSchema;
    adapters: Record<string, ConfigurationSchema>;
    protocols: Record<string, ConfigurationSchema>;
    protocolRegistrations: Record<string, string>;
    applications: Record<string, { name: string; displayName: string }>;
    unknownFieldPolicy: "withhold";
}
export interface ConfigurationPathInspection {
    /** 包含未知字段：这些值仅保留在私有文档，禁止直接返回 Web。 */
    sensitivePaths: ConfigurationPath[];
    unknownPaths: ConfigurationPath[];
}
const forbidden = new Set(["__proto__", "constructor", "prototype"]);
const record = (value: unknown): value is Record<string, unknown> =>
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
function invalid(): never {
    throw new Error("可信配置 Schema 或协议元数据无效");
}
function clone(input: unknown): unknown {
    let nodes = 0;
    const ancestors = new Set<object>();
    function visit(value: unknown, depth: number): unknown {
        if (++nodes > 100_000 || depth > 64) invalid();
        if (value === null || typeof value === "string" || typeof value === "boolean") return value;
        if (typeof value === "number") return Number.isFinite(value) ? value : invalid();
        if (!Array.isArray(value) && !record(value)) invalid();
        if (ancestors.has(value)) invalid();
        ancestors.add(value);
        const result: Record<string, unknown> = {};
        for (const key of Object.keys(value)) {
            if (forbidden.has(key)) invalid();
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !("value" in descriptor)) invalid();
            result[key] = visit(descriptor.value, depth + 1);
        }
        ancestors.delete(value);
        return Array.isArray(value) ? value.map((_, index) => result[String(index)]) : result;
    }
    return visit(input, 0);
}
function schemaMap(input: unknown): Record<string, ConfigurationSchema> {
    if (!record(input)) invalid();
    for (const value of Object.values(input)) if (!record(value)) invalid();
    return input as Record<string, ConfigurationSchema>;
}
function field(type: string, label: string, extra: ConfigurationSchema = {}): ConfigurationSchema {
    return { type, label, ui: { section: "advanced" }, ...extra };
}

/** metadata 必须与 schemas 来自同一已验证工件；本函数不从注册名猜测协议名或版本。 */
export function normalizeConfigurationSchema(input: {
    schemas: unknown;
    protocols: readonly VerifiedProtocolMetadata[];
}): ConfigurationSchemaBundle {
    const source = clone(input.schemas);
    const metadata = clone(input.protocols);
    if (!record(source) || source.schemaVersion !== 1 || !Array.isArray(metadata)) invalid();
    const adapters = schemaMap(source.adapters);
    const originalProtocols = schemaMap(source.protocols);
    const protocols: Record<string, ConfigurationSchema> = {};
    const protocolRegistrations: Record<string, string> = {};
    const seen = new Set<string>();
    for (const entry of metadata) {
        if (!record(entry)) invalid();
        const { registrationName, name, version } = entry;
        if (
            [registrationName, name, version].some(
                value => typeof value !== "string" || !value || forbidden.has(value),
            )
        )
            invalid();
        const registration = registrationName as string;
        const key = `${name}.${version}`;
        if (
            seen.has(registration) ||
            Object.hasOwn(protocols, key) ||
            !Object.hasOwn(originalProtocols, registration)
        )
            invalid();
        seen.add(registration);
        protocols[key] = originalProtocols[registration];
        protocolRegistrations[key] = registration;
    }
    if (seen.size !== Object.keys(originalProtocols).length) invalid();
    const applications: ConfigurationSchemaBundle["applications"] = {};
    for (const [key, entry] of Object.entries(schemaMap(source.applications))) {
        if (entry.name !== key || typeof entry.displayName !== "string") invalid();
        applications[key] = { name: key, displayName: entry.displayName };
    }
    const selection = (names: string[], label: string) =>
        field("array", label, {
            items: { type: "string" },
            choices: names.sort().map(value => ({ label: value, value })),
            ui: { section: "advanced", widget: "choice-list" },
        });
    return {
        schemaVersion: 1,
        base: {
            path: field("string", "服务路径前缀", { default: "" }),
            database: field("string", "数据库文件", { min: 1, default: "onebots.db" }),
            timeout: field("number", "账号启动超时（秒）", { min: 1, default: 30 }),
            log_level: field("string", "日志等级", {
                default: "info",
                choices: ["trace", "debug", "info", "warn", "error", "fatal", "mark", "off"].map(
                    value => ({ value, label: value }),
                ),
            }),
            public_static_dir: field("string", "站点根静态目录"),
            plugins: {
                adapters: selection(Object.keys(adapters), "启用平台"),
                protocols: selection(Object.keys(originalProtocols), "启用协议"),
                applications: selection(Object.keys(applications), "启用框架"),
            },
        },
        general: protocols,
        adapters,
        protocols,
        protocolRegistrations,
        applications,
        unknownFieldPolicy: "withhold",
    };
}

/** 未声明/形状不匹配的数据整棵隐藏，但调用方必须保存原始私有文档，不能用投影覆盖它。 */
export function inspectConfigurationPaths(
    bundle: ConfigurationSchemaBundle,
    config: ConfigurationDocument,
): ConfigurationPathInspection {
    const document = clone(config);
    if (!record(document)) invalid();
    const sensitivePaths: ConfigurationPath[] = [];
    const unknownPaths: ConfigurationPath[] = [];
    const hide = (path: string[], unknown = false) => {
        sensitivePaths.push(path);
        if (unknown) unknownPaths.push(path);
    };
    function walk(schema: unknown, value: unknown, path: string[], present: boolean): void {
        if (!record(schema)) {
            if (present) hide(path, true);
            return;
        }
        if (schema.sensitive === true) {
            hide(path);
            return;
        }
        const type = schema.type;
        const rule =
            typeof type === "string" ||
            ["label", "required", "default", "choices"].some(key => Object.hasOwn(schema, key));
        if (rule) {
            if (type === "array") {
                if (!present) return;
                if (!Array.isArray(value)) {
                    hide(path, true);
                    return;
                }
                const ui = record(schema.ui) ? schema.ui : {};
                let items = schema.items;
                if (!items && Array.isArray(ui.fields)) {
                    const properties: ConfigurationSchema = {};
                    for (const entry of ui.fields) {
                        if (
                            !record(entry) ||
                            typeof entry.key !== "string" ||
                            forbidden.has(entry.key)
                        )
                            invalid();
                        properties[entry.key] = { type: "string", ...entry };
                    }
                    items = { type: "object", properties };
                }
                value.forEach((item, index) => walk(items, item, [...path, String(index)], true));
                return;
            }
            if (type === "object") {
                if (!record(schema.properties)) {
                    if (present) hide(path, true);
                    return;
                }
                walk(schema.properties, value, path, present);
                return;
            }
            if (!present) return;
            if (!["string", "number", "boolean"].includes(String(type)) || typeof value !== type)
                hide(path, true);
            return;
        }
        if (!present) return;
        if (!record(value)) {
            hide(path, true);
            return;
        }
        for (const key of new Set([...Object.keys(schema), ...Object.keys(value)]))
            walk(schema[key], value[key], [...path, key], Object.hasOwn(value, key));
    }
    const root: ConfigurationSchema = { ...bundle.base, general: bundle.general };
    for (const key of Object.keys(document)) {
        if (Object.hasOwn(root, key)) continue;
        const separator = key.indexOf(".");
        const platform = separator > 0 ? key.slice(0, separator) : "";
        if (Object.hasOwn(bundle.adapters, platform))
            root[key] = { ...bundle.adapters[platform], ...bundle.protocols };
    }
    walk(root, document, [], true);
    const normalize = (paths: string[][]) =>
        paths
            .filter(
                (path, index) =>
                    !paths.some(
                        (other, otherIndex) =>
                            otherIndex !== index &&
                            other.length <= path.length &&
                            other.every((part, position) => part === path[position]) &&
                            (other.length < path.length || otherIndex < index),
                    ),
            )
            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return { sensitivePaths: normalize(sensitivePaths), unknownPaths: normalize(unknownPaths) };
}

export function collectConfigurationSensitivePaths(
    bundle: ConfigurationSchemaBundle,
    config: ConfigurationDocument,
): ConfigurationPath[] {
    return inspectConfigurationPaths(bundle, config).sensitivePaths;
}
