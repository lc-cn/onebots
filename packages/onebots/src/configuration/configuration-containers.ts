import {
    parseConfigurationDocument,
    type ConfigurationDocument,
    type ConfigurationValue,
} from "./configuration-document.js";
import type { ConfigurationSchemaBundle } from "./configuration-schema.js";

function invalid(): never {
    throw new Error("配置字段父容器无效或尚未启用");
}
function object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function properties(schema: unknown): Record<string, unknown> | undefined {
    if (!object(schema)) return undefined;
    if (schema.type === "object") return object(schema.properties) ? schema.properties : undefined;
    if (
        ["type", "label", "required", "default", "choices", "sensitive"].some(key =>
            Object.hasOwn(schema, key),
        )
    )
        return undefined;
    return schema;
}
function items(schema: Record<string, unknown>): unknown {
    if (schema.items !== undefined) return schema.items;
    const fields = object(schema.ui) ? schema.ui.fields : undefined;
    if (!Array.isArray(fields)) return undefined;
    const result: Record<string, unknown> = {};
    for (const field of fields) {
        if (
            !object(field) ||
            typeof field.key !== "string" ||
            !field.key ||
            Object.hasOwn(result, field.key)
        )
            invalid();
        result[field.key] = { type: "string", ...field };
    }
    return { type: "object", properties: result };
}

/** 只准备明确 set 路径的对象父容器；绝不生成默认值、账号、协议或数组行。 */
export function prepareConfigurationContainers(
    bundle: ConfigurationSchemaBundle,
    document: ConfigurationDocument,
    paths: string[][],
): ConfigurationDocument {
    // 复用纯 JSON 边界，拒绝 getter/危险键/函数/循环，并与原始文档隔离。
    const clean = parseConfigurationDocument({ bundle, document, paths });
    const source = clean.bundle as unknown as ConfigurationSchemaBundle;
    const result = clean.document as ConfigurationDocument;
    const requested = clean.paths;
    if (!Array.isArray(requested) || requested.length > 1000) invalid();
    const root: Record<string, unknown> = { ...source.base, general: source.general };
    const accounts = new Set<string>();
    for (const entry of requested) {
        if (
            !Array.isArray(entry) ||
            !entry.length ||
            entry.length > 64 ||
            entry.some(part => typeof part !== "string" || !part)
        )
            invalid();
        const segments = entry as string[];
        const first = segments[0];
        const separator = first.indexOf(".");
        const platform = separator > 0 ? first.slice(0, separator) : "";
        if (!Object.hasOwn(root, first) && Object.hasOwn(source.adapters, platform)) {
            root[first] = { ...source.adapters[platform], ...source.protocols };
            accounts.add(first);
        }
        let schema: unknown = root;
        let current: ConfigurationValue = result;
        for (let index = 0; index < segments.length; index++) {
            const key = segments[index];
            let child: unknown;
            if (Array.isArray(current)) {
                if (
                    !object(schema) ||
                    schema.type !== "array" ||
                    !/^(0|[1-9]\d*)$/.test(key) ||
                    !Number.isSafeInteger(Number(key)) ||
                    Number(key) >= current.length
                )
                    invalid();
                child = items(schema);
            } else {
                if (!object(current)) invalid();
                const fields = properties(schema);
                if (!fields || !Object.hasOwn(fields, key)) invalid();
                child = fields[key];
            }
            if (!object(child)) invalid();
            const container = current as ConfigurationDocument;
            const exists = Object.hasOwn(current, key);
            const protectedContainer =
                (index === 0 && (accounts.has(key) || key === "general" || key === "plugins")) ||
                (index === 1 &&
                    (first === "general" || accounts.has(first)) &&
                    Object.hasOwn(source.protocols, key));
            if (!exists && protectedContainer) invalid();
            if (index === segments.length - 1) break;
            if (!exists) {
                if (
                    index < 1 ||
                    Array.isArray(current) ||
                    !properties(child) ||
                    child.sensitive === true
                )
                    invalid();
                container[key] = {};
            }
            current = container[key];
            schema = child;
        }
    }
    return result;
}
