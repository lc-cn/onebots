/**
 * 配置验证系统
 * 提供配置schema验证和默认值处理
 */

import { ValidationError } from "./errors.js";

export { ValidationError };
export interface Choice<T = unknown> {
    label: string;
    value: T;
}
export interface ValidationRule<T = unknown> {
    required?: boolean;
    type?: "string" | "number" | "boolean" | "object" | "array";
    min?: number;
    max?: number;
    pattern?: RegExp;
    /** 带展示文案的枚举选项（Web 下拉据此渲染） */
    choices?: Array<Choice<T>>;
    /** choices 只作为建议，允许列表中出现额外的自定义字符串。 */
    allowCustomValues?: boolean;
    /**
     * 自定义校验：返回 true / null / undefined 表示通过；
     * 返回 false 或错误文案表示失败
     */
    validator?: (value: T) => boolean | string | null | undefined;
    default?: T | (() => T);
    transform?: (value: unknown) => T;
    /** 用于表单展示的标签 */
    label?: string;
    /** 用于表单展示的说明 */
    description?: string;
    /** 用于表单展示的占位提示 */
    placeholder?: string;
    /** Web 表单按密码输入展示；仅影响显示，不改变配置值或运行时校验。 */
    sensitive?: boolean;
    /** Web 表单展示元数据，不参与运行时校验。 */
    ui?: {
        widget?: "endpoint-list" | "event-filter" | "choice-list" | "record-list";
        /** Web 配置页中的语义分区；布局由消费端统一决定。 */
        section?: "transport" | "delivery" | "credentials" | "filter" | "advanced";
        itemLabel?: string;
        addLabel?: string;
        schemes?: string[];
        fields?: Array<{
            key: string;
            label: string;
            type?: "string" | "number" | "boolean";
            placeholder?: string;
            description?: string;
            sensitive?: boolean;
        }>;
        eventFields?: Array<{
            path: string;
            label: string;
            choices?: Array<Choice>;
        }>;
        /** 仅当同一 Schema 根下的依赖字段命中任一值时展示并保存。 */
        visibleWhen?: {
            path: string;
            oneOf: Array<string | number | boolean>;
        };
        /** 当前字段缺失时，按同一 Schema 根下已存在的字段推断初始选择。 */
        inferValueFromPresence?: Array<{
            path: string;
            value: string | number | boolean;
        }>;
    };
}

export type Schema = {
    [key: string]: ValidationRule | Schema;
};

/** 判断 Schema 节点是否为字段规则，而不是嵌套对象。 */
export function isValidationRule(value: ValidationRule | Schema): value is ValidationRule {
    if (typeof value !== "object" || value === null) return false;
    return (
        "required" in value ||
        "type" in value ||
        "choices" in value ||
        "default" in value ||
        "validator" in value ||
        "transform" in value ||
        "label" in value
    );
}

/**
 * 校验供管理端生成表单的 Schema 元数据。
 *
 * 适配器注册边界调用本函数，使缺失分区、悬空显示依赖或泄露敏感凭据的错误
 * 在插件加载时立即失败，而不是退化成难以维护的通用 JSON 输入。
 */
export function assertSchemaFormContract(schema: Schema): void {
    const fields = flattenSchemaFields(schema);
    const paths = new Set(fields.map(field => field.path));

    for (const { path, rule } of fields) {
        if (!rule.label?.trim()) throw new ValidationError(`配置字段 ${path} 缺少 label`);
        if (!rule.ui?.section) throw new ValidationError(`配置字段 ${path} 缺少 ui.section`);

        const visibility = rule.ui.visibleWhen;
        if (visibility && !paths.has(visibility.path)) {
            throw new ValidationError(`配置字段 ${path} 引用了不存在的显示依赖 ${visibility.path}`);
        }
        if (visibility && visibility.oneOf.length === 0) {
            throw new ValidationError(`配置字段 ${path} 的显示条件 oneOf 不能为空`);
        }
        const inference = rule.ui.inferValueFromPresence;
        if (inference?.length === 0) {
            throw new ValidationError(`配置字段 ${path} 的推断来源不能为空`);
        }
        for (const source of inference ?? []) {
            if (!paths.has(source.path)) {
                throw new ValidationError(`配置字段 ${path} 引用了不存在的推断来源 ${source.path}`);
            }
            if (rule.choices && !rule.choices.some(choice => choice.value === source.value)) {
                throw new ValidationError(`配置字段 ${path} 的推断值未包含在 choices 中`);
            }
        }
        if (
            (rule.ui.widget === "endpoint-list" ||
                rule.ui.widget === "choice-list" ||
                rule.ui.widget === "record-list") &&
            rule.type !== "array"
        ) {
            throw new ValidationError(`配置字段 ${path} 的列表组件必须使用 array 类型`);
        }
        if (rule.ui.widget === "event-filter" && rule.type !== "object") {
            throw new ValidationError(`配置字段 ${path} 的事件过滤组件必须使用 object 类型`);
        }
        if (rule.allowCustomValues && rule.ui.widget !== "choice-list") {
            throw new ValidationError(`配置字段 ${path} 仅可在 choice-list 中允许自定义值`);
        }
        if (/(?:password|token|secret|private_key|encrypt_key|aes_key)$/i.test(path)) {
            if (rule.sensitive !== true) {
                throw new ValidationError(`配置字段 ${path} 必须声明 sensitive`);
            }
        }
        for (const field of rule.ui.fields ?? []) {
            if (!field.key.trim() || !field.label.trim()) {
                throw new ValidationError(`配置字段 ${path} 的子字段必须声明 key 与 label`);
            }
            if (/(?:password|token|secret|private_key|encrypt_key|aes_key)$/i.test(field.key)) {
                if (field.sensitive !== true) {
                    throw new ValidationError(`配置字段 ${path}.${field.key} 必须声明 sensitive`);
                }
            }
        }
    }
}

interface FlattenedSchemaField {
    path: string;
    rule: ValidationRule;
}

function flattenSchemaFields(schema: Schema, prefix = ""): FlattenedSchemaField[] {
    return Object.entries(schema).flatMap(([key, value]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        if (isValidationRule(value)) return [{ path, rule: value }];
        return flattenSchemaFields(value, path);
    });
}

/**
 * 配置验证器
 */
export class ConfigValidator {
    /**
     * 验证配置对象
     */
    static validate<T extends Record<string, unknown>>(
        config: T,
        schema: Schema,
        path: string = "",
    ): T {
        const result = { ...config } as Record<string, unknown>;
        const errors: string[] = [];

        for (const [key, rule] of Object.entries(schema)) {
            const currentPath = path ? `${path}.${key}` : key;
            const value = config[key];

            // 如果是嵌套schema，递归验证
            if (!isValidationRule(rule)) {
                if (value !== undefined) {
                    result[key] = this.validate(
                        (value || {}) as Record<string, unknown>,
                        rule as Schema,
                        currentPath,
                    );
                }
                continue;
            }

            const validationRule = rule as ValidationRule;

            // 检查必填字段
            if (validationRule.required && (value === undefined || value === null)) {
                if (validationRule.default !== undefined) {
                    result[key] =
                        typeof validationRule.default === "function"
                            ? validationRule.default()
                            : validationRule.default;
                    continue;
                }
                errors.push(`${currentPath} is required`);
                continue;
            }

            // 如果值为undefined且有默认值，使用默认值
            if (value === undefined && validationRule.default !== undefined) {
                result[key] =
                    typeof validationRule.default === "function"
                        ? validationRule.default()
                        : validationRule.default;
                continue;
            }

            // 如果值为undefined，跳过验证
            if (value === undefined) {
                continue;
            }

            // 类型转换
            if (validationRule.transform) {
                try {
                    result[key] = validationRule.transform(value);
                } catch (error: unknown) {
                    errors.push(
                        `${currentPath} transform failed: ${error instanceof Error ? error.message : String(error)}`,
                    );
                    continue;
                }
            }

            const finalValue = result[key];
            // transform 可能将空字符串等转为 undefined，视为可选字段未填，跳过后续类型与范围检查
            if (finalValue === undefined) {
                continue;
            }

            // 类型检查
            if (validationRule.type) {
                const typeError = this.checkType(finalValue, validationRule.type, currentPath);
                if (typeError) {
                    errors.push(typeError);
                    continue;
                }
            }

            // 数值范围检查
            if (validationRule.type === "number") {
                const numValue = finalValue as number;
                if (validationRule.min !== undefined && numValue < validationRule.min) {
                    errors.push(`${currentPath} must be >= ${validationRule.min}`);
                }
                if (validationRule.max !== undefined && numValue > validationRule.max) {
                    errors.push(`${currentPath} must be <= ${validationRule.max}`);
                }
            }

            // 字符串长度检查
            if (validationRule.type === "string") {
                const strValue = finalValue as string;
                if (validationRule.min !== undefined && strValue.length < validationRule.min) {
                    errors.push(`${currentPath} length must be >= ${validationRule.min}`);
                }
                if (validationRule.max !== undefined && strValue.length > validationRule.max) {
                    errors.push(`${currentPath} length must be <= ${validationRule.max}`);
                }
                if (validationRule.pattern && !validationRule.pattern.test(strValue)) {
                    errors.push(`${currentPath} does not match pattern ${validationRule.pattern}`);
                }
            }

            // choices 取值校验
            const allowed = validationRule.choices?.map(c => c.value);
            if (allowed && allowed.length > 0 && !validationRule.allowCustomValues) {
                if (Array.isArray(finalValue) && finalValue.some(item => !allowed.includes(item))) {
                    errors.push(`${currentPath} must contain only: ${allowed.join(", ")}`);
                } else if (!Array.isArray(finalValue) && !allowed.includes(finalValue)) {
                    errors.push(`${currentPath} must be one of: ${allowed.join(", ")}`);
                }
            }

            // 自定义验证器：true / null / undefined 通过；false 或 string 为失败
            if (validationRule.validator) {
                const validationResult = validationRule.validator(finalValue);
                if (validationResult === false || typeof validationResult === "string") {
                    errors.push(
                        `${currentPath}: ${
                            typeof validationResult === "string"
                                ? validationResult
                                : "validation failed"
                        }`,
                    );
                }
            }
        }

        if (errors.length > 0) {
            throw new ValidationError("Configuration validation failed", {
                context: {
                    errors,
                    path,
                },
            });
        }

        return result as T;
    }

    /**
     * 检查类型
     */
    private static checkType(value: unknown, expectedType: string, path: string): string | null {
        const actualType = Array.isArray(value) ? "array" : typeof value;
        if (actualType !== expectedType) {
            return `${path} must be ${expectedType}, got ${actualType}`;
        }
        return null;
    }

    /**
     * 验证并应用默认值
     */
    static validateWithDefaults<T extends Record<string, unknown>>(
        config: Partial<T>,
        schema: Schema,
    ): T {
        return this.validate(config as T, schema);
    }
}

/**
 * BaseApp 配置 Schema
 */
export const BaseAppConfigSchema: Schema = {
    port: {
        type: "number",
        min: 1,
        max: 65535,
        default: 6727,
    },
    path: {
        type: "string",
        default: "",
    },
    database: {
        type: "string",
        default: "onebots.db",
    },
    timeout: {
        type: "number",
        min: 1,
        default: 30,
    },
    username: {
        type: "string",
        transform: (v: unknown) => (v != null && String(v).trim() !== "" ? String(v) : undefined),
    },
    password: {
        type: "string",
        transform: (v: unknown) => (v != null && String(v).trim() !== "" ? String(v) : undefined),
    },
    access_token: {
        type: "string",
        transform: (v: unknown) => (v != null && String(v).trim() !== "" ? String(v) : undefined),
    },
    log_level: {
        type: "string",
        choices: [
            { value: "trace", label: "trace" },
            { value: "debug", label: "debug" },
            { value: "info", label: "info" },
            { value: "warn", label: "warn" },
            { value: "error", label: "error" },
            { value: "fatal", label: "fatal" },
            { value: "mark", label: "mark" },
            { value: "off", label: "off" },
        ],
        default: "info",
        label: "日志等级",
    },
    /** 站点根静态文件目录（相对 BaseApp.configDir 或绝对路径），用于可信域名校验文件等 */
    public_static_dir: {
        type: "string",
        transform: (v: unknown) =>
            v != null && String(v).trim() !== "" ? String(v).trim() : undefined,
    },
};
