import type {
    ControlConfigurationProjection,
    ControlConfigurationChange,
    ControlSecretChange,
} from "@onebots/core/control";
import type { Schema, SchemaFieldDef, SchemaGroup } from "./config/types.js";
import { buildSchemaFields, parseStructuredFieldValue } from "./config/utils.js";

export function configurationSecret(
    field: SchemaFieldDef,
    states: ControlConfigurationProjection["secretStates"],
) {
    return (
        states.find(state => fieldKey(state.path) === field.key) ??
        (field.rule.sensitive ? { path: field.path, configured: false } : undefined)
    );
}
export function configurationEdits(
    fields: SchemaFieldDef[],
    states: ControlConfigurationProjection["secretStates"],
    values: Record<string, unknown>,
    modes: Record<string, "keep" | "set" | "clear">,
    changed: Set<string>,
): { changes: ControlConfigurationChange[]; secrets: ControlSecretChange[] } {
    const changes: ControlConfigurationChange[] = [],
        secrets: ControlSecretChange[] = [];
    for (const field of fields.filter(field => changed.has(field.key))) {
        let value = values[field.key];
        const sensitive = configurationSecret(field, states);
        const mode = modes[field.key] ?? "keep";
        if (sensitive && mode !== "set") {
            secrets.push({ op: mode, path: field.path });
            continue;
        }
        if (sensitive && value === undefined) throw new Error(`请填写 ${field.label} 的新值`);
        if (value !== undefined && (field.rule.type === "array" || field.rule.type === "object")) {
            const parsed = parseStructuredFieldValue(value, field.rule, field.label);
            if (!parsed.ok) throw new Error(`${field.label} 格式无效`);
            value = parsed.value;
        }
        if (sensitive) secrets.push({ op: "set", path: field.path, value });
        else
            changes.push(
                value === undefined
                    ? { op: "remove", path: field.path }
                    : { op: "set", path: field.path, value },
            );
    }
    return { changes, secrets };
}

export const fieldKey = (path: string[]) => JSON.stringify(path);
export function valueAt(document: Record<string, unknown>, path: string[]): unknown {
    let value: unknown = document;
    for (const key of path) {
        if (!value || typeof value !== "object") return undefined;
        value = (value as Record<string, unknown>)[key];
    }
    return value;
}
export function schemaRecord(value: unknown): Record<string, Schema> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, Schema>)
        : {};
}
export interface ConfigurationListField {
    path: string[];
    key: string;
    label: string;
    count: number;
    readonlyReason?: string;
}
export interface ConfigurationFormGroup extends SchemaGroup {
    lists: ConfigurationListField[];
    notices: string[];
}
const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
const prefix = (a: string[], b: string[]) =>
    a.length <= b.length && a.every((part, index) => part === b[index]);
function objectProperties(value: unknown): Record<string, unknown> | undefined {
    if (!object(value)) return;
    if (value.type === "object") return object(value.properties) ? value.properties : undefined;
    if (
        ["type", "required", "label", "default", "choices", "sensitive"].some(key =>
            Object.hasOwn(value, key),
        )
    )
        return;
    return value;
}
function itemSchema(rule: Record<string, unknown>): Record<string, unknown> | undefined {
    if (object(rule.items)) return rule.items;
    if (!object(rule.ui) || !Array.isArray(rule.ui.fields)) return;
    const properties: Record<string, unknown> = {};
    for (const field of rule.ui.fields) {
        if (
            !object(field) ||
            typeof field.key !== "string" ||
            ["__proto__", "constructor", "prototype"].includes(field.key)
        )
            return;
        properties[field.key] = { type: "string", ...field };
    }
    return { type: "object", properties };
}
/** 对象/列表按声明逐叶编辑，列表结构变更由独立CAS操作完成。 */
export function configurationGroups(
    schemas: Record<string, unknown>,
    projection: ControlConfigurationProjection,
): ConfigurationFormGroup[] {
    const groups: ConfigurationFormGroup[] = [];
    const adapters = schemaRecord(schemas.adapters);
    const protocols = schemaRecord(schemas.protocols);
    const add = (title: string, schema: Schema, root: string[], account = false) => {
        const fields: SchemaFieldDef[] = [];
        const lists: ConfigurationListField[] = [];
        const notices: string[] = [];
        const dependencyPaths = new Map<string, string>();
        const walk = (
            node: unknown,
            path: string[],
            schemaRoot: string[],
            label: string,
            depth: number,
        ) => {
            if (depth > 32 || !object(node)) return;
            if (projection.unknownPaths.some(unknown => prefix(unknown, path))) {
                notices.push(`${label} 含未声明字段，已保留在服务端，暂不整体编辑。`);
                return;
            }
            const exactSecret = projection.secretStates.some(
                secret => fieldKey(secret.path) === fieldKey(path),
            );
            const sensitive = node.sensitive === true || exactSecret;
            const properties = objectProperties(node);
            if (properties && !sensitive) {
                for (const [key, child] of Object.entries(properties)) {
                    if (account && path.length === root.length && key === "account_id") continue;
                    walk(
                        child,
                        [...path, key],
                        node.type === "object" ? path : schemaRoot,
                        label,
                        depth + 1,
                    );
                }
                return;
            }
            const item = node.type === "array" ? itemSchema(node) : undefined;
            if (
                node.type === "array" &&
                item &&
                !sensitive &&
                (objectProperties(item) ||
                    item.type === "array" ||
                    item.sensitive === true ||
                    projection.secretStates.some(secret => prefix(path, secret.path)))
            ) {
                const current = valueAt(projection.document, path);
                if (current !== undefined && !Array.isArray(current)) {
                    notices.push(`${label} 的列表结构无效，请修复配置。`);
                    return;
                }
                const items = Array.isArray(current) ? current : [];
                const itemProperties = objectProperties(item);
                if (itemProperties && item.sensitive !== true)
                    lists.push({
                        path,
                        key: fieldKey(path),
                        label: String(node.label ?? path.at(-1)),
                        count: items.length,
                        ...(projection.unknownPaths.some(unknown => prefix(path, unknown))
                            ? { readonlyReason: "列表含未声明字段，已保留；暂不增删列表项。" }
                            : {}),
                    });
                else if (!items.length)
                    notices.push(`${String(node.label ?? path.at(-1))} 当前没有可编辑项。`);
                items.forEach((_, index) =>
                    walk(
                        item,
                        [...path, String(index)],
                        [...path, String(index)],
                        `${String(node.label ?? path.at(-1))} · ${index + 1}`,
                        depth + 1,
                    ),
                );
                return;
            }
            if (
                projection.secretStates.some(
                    secret => prefix(path, secret.path) && path.length < secret.path.length,
                )
            ) {
                notices.push(`${String(node.label ?? path.at(-1))} 含受保护字段，不能整体覆盖。`);
                return;
            }
            const key = path.at(-1)!;
            const leaf = buildSchemaFields(
                { [key]: node } as Schema,
                path.slice(0, -1),
                schemaRoot,
            )[0];
            if (!leaf) return;
            dependencyPaths.set(leaf.key, fieldKey(path));
            fields.push({
                ...leaf,
                key: fieldKey(path),
                label:
                    label && path.some(part => /^(0|[1-9]\d*)$/.test(part))
                        ? `${label} · ${leaf.label}`
                        : leaf.label,
                rule: { ...leaf.rule, ...(sensitive ? { sensitive: true } : {}) },
            });
        };
        walk(schema, root, root, "", 0);
        for (const field of fields)
            if (field.visibility)
                field.visibility = {
                    ...field.visibility,
                    dependencyKey:
                        dependencyPaths.get(field.visibility.dependencyKey) ??
                        field.visibility.dependencyKey,
                };
        if (fields.length || lists.length || notices.length)
            groups.push({ key: fieldKey(root), title, fields, lists, notices });
    };
    if (schemas.base) add("基础设置", schemas.base as Schema, []);
    const general = valueAt(projection.document, ["general"]);
    for (const [name, schema] of Object.entries(protocols))
        if (object(general) && Object.hasOwn(general, name))
            add(`协议默认值 · ${name}`, schema, ["general", name]);
    for (const key of Object.keys(projection.document)) {
        const separator = key.indexOf(".");
        if (separator < 1) continue;
        const schema = adapters[key.slice(0, separator)];
        if (!schema) continue;
        add(key, schema, [key], true);
        const account = projection.document[key];
        for (const [name, schema] of Object.entries(protocols))
            if (object(account) && Object.hasOwn(account, name))
                add(`${key} / ${name}`, schema, [key, name]);
    }
    return groups;
}
