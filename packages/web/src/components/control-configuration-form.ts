import type { ControlConfigurationProjection } from "@onebots/core/control";
import type { Schema, SchemaFieldDef, SchemaGroup } from "./config/types.js";
import { buildSchemaFields } from "./config/utils.js";

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
/** 只展开声明字段。带秘密的列表不能作为整体提交，改成已有列表项的独立字段。 */
export function configurationGroups(
    schemas: Record<string, unknown>,
    projection: ControlConfigurationProjection,
): SchemaGroup[] {
    const groups: SchemaGroup[] = [];
    const adapters = schemaRecord(schemas.adapters);
    const protocols = schemaRecord(schemas.protocols);
    const add = (title: string, schema: Schema, root: string[], account = false) => {
        const fields: SchemaFieldDef[] = [];
        for (const field of buildSchemaFields(schema, root)) {
            if (account && field.path.at(-1) === "account_id") continue;
            const children = projection.secretStates.filter(
                secret =>
                    secret.path.length > field.path.length &&
                    field.path.every((part, index) => part === secret.path[index]),
            );
            if (children.length) {
                const value = valueAt(projection.document, field.path);
                if (Array.isArray(value) && field.rule.ui?.fields) {
                    value.forEach((_, index) =>
                        field.rule.ui!.fields!.forEach(child => {
                            const path = [...field.path, String(index), child.key];
                            fields.push({
                                path,
                                key: fieldKey(path),
                                label: `${field.label} · ${index + 1} · ${child.label}`,
                                placeholder: child.placeholder ?? "",
                                rule: {
                                    type: child.type ?? "string",
                                    sensitive: child.sensitive,
                                    choices: child.choices,
                                },
                            });
                        }),
                    );
                }
                continue;
            }
            fields.push({ ...field, key: fieldKey(field.path) });
        }
        if (fields.length) groups.push({ key: fieldKey(root), title, fields });
    };
    if (schemas.base) add("基础设置", schemas.base as Schema, []);
    const general = valueAt(projection.document, ["general"]);
    for (const [name, schema] of Object.entries(protocols)) {
        if (general && typeof general === "object" && Object.hasOwn(general, name))
            add(`协议默认值 · ${name}`, schema, ["general", name]);
    }
    for (const key of Object.keys(projection.document)) {
        const separator = key.indexOf(".");
        if (separator < 1) continue;
        const schema = adapters[key.slice(0, separator)];
        if (!schema) continue;
        add(key, schema, [key], true);
        const account = projection.document[key];
        for (const [name, schema] of Object.entries(protocols)) {
            if (account && typeof account === "object" && Object.hasOwn(account, name))
                add(`${key} / ${name}`, schema, [key, name]);
        }
    }
    return groups;
}
