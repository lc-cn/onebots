import type {
    ValidationRule,
    Schema,
    SchemaBundle,
    SchemaFieldDef,
    SchemaGroup,
    AccountRow,
} from "./types.js";

export const isRule = (rule: ValidationRule | Schema): rule is ValidationRule => {
    return (
        typeof rule === "object" &&
        ("type" in rule || "required" in rule || "choices" in rule || "default" in rule)
    );
};

export const makeKey = (path: string[]) => path.join("::");

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === "object" && value !== null && !Array.isArray(value);
};

export const getValueByPath = (data: Record<string, unknown>, path: string[]): unknown => {
    let current: unknown = data;
    for (const key of path) {
        if (!isRecord(current)) return undefined;
        current = current[key];
    }
    return current;
};

export const setValueByPath = (data: Record<string, unknown>, path: string[], value: unknown) => {
    const keys = path;
    let current = data;
    keys.forEach((key, index) => {
        if (index === keys.length - 1) {
            if (value === undefined) {
                delete current[key];
            } else {
                current[key] = value;
            }
            return;
        }
        if (!isRecord(current[key])) {
            current[key] = {};
        }
        current = current[key] as Record<string, unknown>;
    });
};

/** 删除字段并向上清理因此变空的对象，避免隐藏字段留下空配置块。 */
export const deleteValueByPath = (data: Record<string, unknown>, path: string[]): void => {
    const parents: Array<{ value: Record<string, unknown>; key: string }> = [];
    let current = data;
    for (const key of path.slice(0, -1)) {
        const next = current[key];
        if (!isRecord(next)) return;
        parents.push({ value: current, key });
        current = next;
    }
    delete current[path[path.length - 1] ?? ""];
    for (const parent of parents.reverse()) {
        const child = parent.value[parent.key];
        if (isRecord(child) && Object.keys(child).length === 0) delete parent.value[parent.key];
    }
};

/** object/array 字段：空输入表示未配置（undefined），不要默认写成 {} */
export const resolveJsonFieldDisplay = (currentValue: unknown, rule: ValidationRule): string => {
    if (currentValue !== undefined && currentValue !== null) {
        return JSON.stringify(currentValue, null, 2);
    }
    if (rule.default !== undefined) {
        return JSON.stringify(rule.default, null, 2);
    }
    return "";
};

export const usesEndpointListEditor = (rule: ValidationRule): boolean =>
    rule.type === "array" && rule.ui?.widget === "endpoint-list";

export const usesEventFilterEditor = (rule: ValidationRule): boolean =>
    rule.type === "object" && rule.ui?.widget === "event-filter";

export const usesChoiceListEditor = (rule: ValidationRule): boolean =>
    rule.type === "array" && rule.ui?.widget === "choice-list";

export const usesRecordListEditor = (rule: ValidationRule): boolean =>
    rule.type === "array" && rule.ui?.widget === "record-list";

const cloneConfigValue = (value: unknown, seen = new WeakMap<object, unknown>()): unknown => {
    if (typeof value !== "object" || value === null) return value;

    const cached = seen.get(value);
    if (cached !== undefined) return cached;

    if (Array.isArray(value)) {
        const result: unknown[] = [];
        seen.set(value, result);
        value.forEach(item => result.push(cloneConfigValue(item, seen)));
        return result;
    }

    const result: Record<string, unknown> = {};
    seen.set(value, result);
    Object.entries(value).forEach(([key, item]) => {
        result[key] = cloneConfigValue(item, seen);
    });
    return result;
};

export const resolveStructuredFieldDisplay = (
    currentValue: unknown,
    rule: ValidationRule,
): unknown => {
    if (usesEndpointListEditor(rule) || usesRecordListEditor(rule)) {
        const value = currentValue ?? rule.default;
        return Array.isArray(value) ? cloneConfigValue(value) : [];
    }
    if (usesChoiceListEditor(rule)) {
        const value = currentValue ?? rule.default;
        return Array.isArray(value) ? cloneConfigValue(value) : [];
    }
    if (usesEventFilterEditor(rule)) {
        return cloneConfigValue(currentValue ?? rule.default ?? {});
    }
    return resolveJsonFieldDisplay(currentValue, rule);
};

export const parseStructuredFieldValue = (
    raw: unknown,
    rule: ValidationRule,
    label: string,
): { ok: true; value: unknown } | { ok: false; message: string } => {
    if (usesEventFilterEditor(rule)) {
        if (isRecord(raw)) return { ok: true, value: cloneConfigValue(raw) };
        return parseJsonFieldValue(raw, rule, label);
    }
    if (usesChoiceListEditor(rule)) {
        if (!Array.isArray(raw)) return { ok: false, message: `字段 ${label} 必须是选项列表` };
        const allowed = new Set((rule.choices || []).map(choice => choice.value));
        const values: Array<string | number | boolean> = [];
        for (const item of raw) {
            if (typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean") {
                return { ok: false, message: `字段 ${label} 中存在无效选项` };
            }
            if (allowed.size && !allowed.has(item)) {
                return { ok: false, message: `字段 ${label} 中存在未声明的选项：${String(item)}` };
            }
            if (!values.includes(item)) values.push(item);
        }
        return { ok: true, value: values };
    }
    if (usesRecordListEditor(rule)) {
        if (!Array.isArray(raw)) return { ok: false, message: `字段 ${label} 必须是对象列表` };
        const fieldTypes = new Map((rule.ui?.fields || []).map(field => [field.key, field.type]));
        const entries: Record<string, unknown>[] = [];
        for (const item of raw) {
            if (!isRecord(item)) return { ok: false, message: `字段 ${label} 中存在无效项目` };
            const entry = { ...item };
            for (const [key, type] of fieldTypes) {
                const value = entry[key];
                if (value === undefined || value === "") {
                    delete entry[key];
                    continue;
                }
                const expected = type || "string";
                if (typeof value !== expected) {
                    return { ok: false, message: `字段 ${label}.${key} 必须是${expected}` };
                }
            }
            if (Object.keys(entry).length) entries.push(entry);
        }
        return { ok: true, value: entries };
    }
    if (!usesEndpointListEditor(rule)) return parseJsonFieldValue(raw, rule, label);
    if (!Array.isArray(raw)) return { ok: false, message: `字段 ${label} 必须是地址列表` };

    const entries: unknown[] = [];
    for (const item of raw) {
        const value = typeof item === "string" ? item.trim() : item;
        const urlValue =
            isRecord(value) && typeof value.url === "string" ? value.url.trim() : value;
        if (urlValue === "") continue;
        if (typeof urlValue !== "string") {
            return { ok: false, message: `字段 ${label} 中存在无效地址` };
        }
        try {
            const url = new URL(urlValue);
            const schemes = rule.ui?.schemes;
            if (schemes?.length && !schemes.includes(url.protocol)) {
                return {
                    ok: false,
                    message: `字段 ${label} 仅支持 ${schemes.map(item => item.replace(":", "")).join(" / ")}`,
                };
            }
        } catch {
            return { ok: false, message: `字段 ${label} 中存在无效 URL：${urlValue}` };
        }
        entries.push(isRecord(value) ? { ...value, url: urlValue } : urlValue);
    }
    return { ok: true, value: entries };
};

export const parseJsonFieldValue = (
    raw: unknown,
    rule: ValidationRule,
    label: string,
): { ok: true; value: unknown } | { ok: false; message: string } => {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) {
        return { ok: true, value: rule.default !== undefined ? rule.default : undefined };
    }
    try {
        return { ok: true, value: JSON.parse(text) };
    } catch {
        return { ok: false, message: `字段 ${label} 不是有效 JSON` };
    }
};

export const buildSchemaFields = (
    schemaData: Schema,
    basePath: string[] = [],
    schemaRootPath: string[] = basePath,
): SchemaFieldDef[] => {
    const fields: SchemaFieldDef[] = [];
    Object.entries(schemaData).forEach(([key, rule]) => {
        const currentPath = [...basePath, key];
        if (isRule(rule)) {
            fields.push({
                path: currentPath,
                key: makeKey(currentPath),
                label: rule.label || currentPath.join("."),
                rule,
                placeholder:
                    rule.placeholder ||
                    (rule.default !== undefined ? `默认：${String(rule.default)}` : ""),
                visibility: rule.ui?.visibleWhen
                    ? {
                          dependencyKey: makeKey([
                              ...schemaRootPath,
                              ...rule.ui.visibleWhen.path.split(".").filter(Boolean),
                          ]),
                          oneOf: rule.ui.visibleWhen.oneOf,
                      }
                    : undefined,
                valueInference: rule.ui?.inferValueFromPresence?.map(source => ({
                    path: [...schemaRootPath, ...source.path.split(".").filter(Boolean)],
                    value: source.value,
                })),
            });
        } else {
            fields.push(...buildSchemaFields(rule as Schema, currentPath, schemaRootPath));
        }
    });
    return fields;
};

/** 保留已有值；字段缺失时先按同一 Schema 内的现存配置推断，再使用静态默认。 */
export const resolveSchemaFieldInitialValue = (
    configObject: Record<string, unknown>,
    field: SchemaFieldDef,
): unknown => {
    const currentValue = getValueByPath(configObject, field.path);
    if (currentValue !== undefined) return currentValue;
    for (const source of field.valueInference ?? []) {
        const sourceValue = getValueByPath(configObject, source.path);
        if (sourceValue !== undefined && sourceValue !== null && sourceValue !== "") {
            return source.value;
        }
    }
    return field.rule.default ?? (field.rule.type === "boolean" ? false : "");
};

/** Schema 声明是显示与持久化的唯一来源，两个配置入口共用同一判断。 */
export const isSchemaFieldVisible = (
    field: SchemaFieldDef,
    formModel: Readonly<Record<string, unknown>>,
): boolean => {
    if (!field.visibility) return true;
    return field.visibility.oneOf.includes(
        formModel[field.visibility.dependencyKey] as string | number | boolean,
    );
};

export const normalizeSchema = (data: Schema | SchemaBundle): SchemaBundle => {
    if ("base" in data || "general" in data || "protocols" in data || "adapters" in data) {
        return data as SchemaBundle;
    }
    return { base: data as Schema };
};

/** 配置文件中保留给全局设置的键名，不是账号 */
export const BASE_CONFIG_KEYS = new Set([
    "port",
    "path",
    "database",
    "timeout",
    "username",
    "password",
    "log_level",
    "general",
]);

/** 根据 SchemaBundle 和已解析配置对象，构建表单分组 */
export const buildConfigGroups = (bundle: SchemaBundle): SchemaGroup[] => {
    const groups: SchemaGroup[] = [];

    if (bundle.base) {
        groups.push({
            key: "base",
            title: "基础配置",
            fields: buildSchemaFields(bundle.base),
        });
    }

    if (bundle.general) {
        Object.entries(bundle.general).forEach(([protocolKey, protocolSchema]) => {
            groups.push({
                key: `general:${protocolKey}`,
                title: `协议默认值 · ${protocolTitle(protocolKey)}`,
                description: `应用于未在账号中单独覆盖的 ${protocolTitle(protocolKey)} 配置。`,
                fields: buildSchemaFields(protocolSchema as Schema, ["general", protocolKey]),
            });
        });
    }

    return groups;
};

const PROTOCOL_TITLES: Record<string, string> = {
    "onebot.v11": "OneBot 11",
    "onebot.v12": "OneBot 12",
    "milky.v1": "Milky",
    "satori.v1": "Satori",
};

export const protocolTitle = (key: string): string => PROTOCOL_TITLES[key] ?? key;

/** 从已解析配置对象中提取账号行 */
export const extractAccountRows = (configObject: Record<string, unknown>): AccountRow[] => {
    const rows: AccountRow[] = [];
    Object.entries(configObject).forEach(([key, value]) => {
        if (!key.includes(".") || BASE_CONFIG_KEYS.has(key)) return;
        const [platform, ...rest] = key.split(".");
        const account_id = rest.join(".");
        rows.push({
            key,
            platform,
            account_id,
            config: isRecord(value) ? value : {},
            preview: JSON.stringify(value, null, 2),
        });
    });
    return rows;
};
