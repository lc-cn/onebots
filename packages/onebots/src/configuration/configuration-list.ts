import {
    parseConfigurationDocument,
    type ConfigurationDocument,
} from "./configuration-document.js";
import {
    inspectConfigurationPaths,
    type ConfigurationSchemaBundle,
} from "./configuration-schema.js";
import {
    configurationItems,
    configurationProperties,
    prepareConfigurationContainers,
} from "./configuration-containers.js";

export interface ConfigurationListChange {
    path: string[];
    action: "append" | "remove";
    index?: number;
}
const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
function invalid(): never {
    throw new Error("配置列表操作无效或字段尚未启用");
}
const prefix = (a: string[], b: string[]) => a.length <= b.length && a.every((v, i) => v === b[i]);

/** 按行编辑声明式对象列表，原有秘密只在服务端移动，绝不接收投影后的整表覆盖。 */
export function editConfigurationList(
    bundle: ConfigurationSchemaBundle,
    document: ConfigurationDocument,
    request: ConfigurationListChange,
): ConfigurationDocument {
    const clean = parseConfigurationDocument({ bundle, document, request });
    const change = clean.request;
    if (
        !object(change) ||
        !Array.isArray(change.path) ||
        !change.path.length ||
        change.path.length > 64 ||
        change.path.some(part => typeof part !== "string" || !part) ||
        !["append", "remove"].includes(String(change.action)) ||
        Object.keys(change).sort().join(",") !==
            (change.action === "append" ? "action,path" : "action,index,path")
    )
        invalid();
    const segments = change.path as string[];
    const schemas = clean.bundle as unknown as ConfigurationSchemaBundle;
    const result = prepareConfigurationContainers(
        schemas,
        clean.document as ConfigurationDocument,
        [segments],
    );
    const root: Record<string, unknown> = { ...schemas.base, general: schemas.general };
    const first = segments[0];
    const platform = first.slice(0, first.indexOf("."));
    if (
        !Object.hasOwn(root, first) &&
        first.indexOf(".") > 0 &&
        Object.hasOwn(schemas.adapters, platform)
    )
        root[first] = { ...schemas.adapters[platform], ...schemas.protocols };
    let schema: unknown = root;
    let current: unknown = result;
    for (let position = 0; position < segments.length; position++) {
        if (!object(schema) || schema.sensitive === true) invalid();
        const key = segments[position];
        let child: unknown;
        if (Array.isArray(current)) {
            if (
                schema.type !== "array" ||
                !/^(0|[1-9]\d*)$/.test(key) ||
                !Number.isSafeInteger(Number(key)) ||
                Number(key) >= current.length
            )
                invalid();
            child = configurationItems(schema);
        } else {
            if (!object(current)) invalid();
            const properties = configurationProperties(schema);
            if (!properties || !Object.hasOwn(properties, key)) invalid();
            child = properties[key];
        }
        if (!object(child) || child.sensitive === true) invalid();
        const container = current as ConfigurationDocument;
        if (position !== segments.length - 1) {
            current = container[key];
            schema = child;
            continue;
        }
        const row = configurationItems(child);
        if (
            child.type !== "array" ||
            !object(row) ||
            row.sensitive === true ||
            !configurationProperties(row)
        )
            invalid();
        const inspection = inspectConfigurationPaths(schemas, result);
        // 不允许通过列表入口清除未知字段，或操作整棵隐藏的容器。
        if (
            inspection.sensitivePaths.some(p => prefix(p, segments)) ||
            inspection.unknownPaths.some(p => prefix(segments, p))
        )
            invalid();
        const existing = container[key];
        if (existing !== undefined && !Array.isArray(existing)) invalid();
        const values = existing === undefined ? [] : existing;
        if (!Array.isArray(values) || values.some(value => !object(value))) invalid();
        if (change.action === "append") {
            if (values.length >= 1000) invalid();
            values.push({});
        } else {
            if (
                typeof change.index !== "number" ||
                !Number.isSafeInteger(change.index) ||
                change.index < 0 ||
                change.index >= values.length
            )
                invalid();
            values.splice(change.index, 1);
        }
        container[key] = values;
    }
    return parseConfigurationDocument(result);
}
