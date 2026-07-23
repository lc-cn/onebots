/**
 * 配置验证系统
 * 提供配置schema验证和默认值处理
 */

import { ValidationError, ConfigError } from './errors.js';

export { ValidationError };
export interface Choice<T = any> {
    label: string;
    value: T;
}
export interface ValidationRule<T = any> {
    required?: boolean;
    type?: 'string' | 'number' | 'boolean' | 'object' | 'array';
    min?: number;
    max?: number;
    pattern?: RegExp;
    /** 带展示文案的枚举选项（Web 下拉据此渲染） */
    choices?: Array<Choice<T>>;
    /**
     * 自定义校验：返回 true / null / undefined 表示通过；
     * 返回 false 或错误文案表示失败
     */
    validator?: (value: T) => boolean | string | null | undefined;
    default?: T | (() => T);
    transform?: (value: any) => T;
    /** 用于表单展示的标签 */
    label?: string;
    /** 用于表单展示的说明 */
    description?: string;
    /** 用于表单展示的占位提示 */
    placeholder?: string;
}

export type Schema = {
    [key: string]: ValidationRule | Schema;
};

/**
 * 配置验证器
 */
export class ConfigValidator {
    /**
     * 验证配置对象
     */
    static validate<T extends Record<string, any>>(
        config: T,
        schema: Schema,
        path: string = '',
    ): T {
        const result = { ...config } as any;
        const errors: string[] = [];

        for (const [key, rule] of Object.entries(schema)) {
            const currentPath = path ? `${path}.${key}` : key;
            const value = config[key];

            // 如果是嵌套schema，递归验证
            if (this.isSchema(rule)) {
                if (value !== undefined) {
                    result[key] = this.validate(value || {}, rule as Schema, currentPath);
                }
                continue;
            }

            const validationRule = rule as ValidationRule;

            // 检查必填字段
            if (validationRule.required && (value === undefined || value === null)) {
                if (validationRule.default !== undefined) {
                    result[key] = typeof validationRule.default === 'function'
                        ? validationRule.default()
                        : validationRule.default;
                    continue;
                }
                errors.push(`${currentPath} is required`);
                continue;
            }

            // 如果值为undefined且有默认值，使用默认值
            if (value === undefined && validationRule.default !== undefined) {
                (result as any)[key] = typeof validationRule.default === 'function'
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
                    (result as any)[key] = validationRule.transform(value);
                } catch (error: any) {
                    errors.push(`${currentPath} transform failed: ${error.message}`);
                    continue;
                }
            }

            const finalValue = (result as any)[key];
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
            if (validationRule.type === 'number') {
                if (validationRule.min !== undefined && finalValue < validationRule.min) {
                    errors.push(`${currentPath} must be >= ${validationRule.min}`);
                }
                if (validationRule.max !== undefined && finalValue > validationRule.max) {
                    errors.push(`${currentPath} must be <= ${validationRule.max}`);
                }
            }

            // 字符串长度检查
            if (validationRule.type === 'string') {
                if (validationRule.min !== undefined && finalValue.length < validationRule.min) {
                    errors.push(`${currentPath} length must be >= ${validationRule.min}`);
                }
                if (validationRule.max !== undefined && finalValue.length > validationRule.max) {
                    errors.push(`${currentPath} length must be <= ${validationRule.max}`);
                }
                if (validationRule.pattern && !validationRule.pattern.test(finalValue)) {
                    errors.push(`${currentPath} does not match pattern ${validationRule.pattern}`);
                }
            }

            // choices 取值校验
            const allowed = validationRule.choices?.map(c => c.value);
            if (allowed && allowed.length > 0 && !allowed.includes(finalValue)) {
                errors.push(`${currentPath} must be one of: ${allowed.join(', ')}`);
            }

            // 自定义验证器：true / null / undefined 通过；false 或 string 为失败
            if (validationRule.validator) {
                const validationResult = validationRule.validator(finalValue);
                if (validationResult === false || typeof validationResult === 'string') {
                    errors.push(
                        `${currentPath}: ${
                            typeof validationResult === 'string'
                                ? validationResult
                                : 'validation failed'
                        }`,
                    );
                }
            }
        }

        if (errors.length > 0) {
            throw new ValidationError('Configuration validation failed', {
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
    private static checkType(value: any, expectedType: string, path: string): string | null {
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (actualType !== expectedType) {
            return `${path} must be ${expectedType}, got ${actualType}`;
        }
        return null;
    }

    /**
     * 判断是否为嵌套schema
     */
    private static isSchema(rule: ValidationRule | Schema): rule is Schema {
        if (typeof rule !== 'object' || rule === null) return false;
        return !(
            'required' in rule ||
            'type' in rule ||
            'choices' in rule ||
            'default' in rule ||
            'validator' in rule ||
            'transform' in rule ||
            'label' in rule
        );
    }

    /**
     * 验证并应用默认值
     */
    static validateWithDefaults<T extends Record<string, any>>(
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
        type: 'number',
        min: 1,
        max: 65535,
        default: 6727,
    },
    path: {
        type: 'string',
        default: '',
    },
    database: {
        type: 'string',
        default: 'onebots.db',
    },
    timeout: {
        type: 'number',
        min: 1,
        default: 30,
    },
    username: {
        type: 'string',
        transform: (v: unknown) => (v != null && String(v).trim() !== '' ? String(v) : undefined),
    },
    password: {
        type: 'string',
        transform: (v: unknown) => (v != null && String(v).trim() !== '' ? String(v) : undefined),
    },
    access_token: {
        type: 'string',
        transform: (v: unknown) => (v != null && String(v).trim() !== '' ? String(v) : undefined),
    },
    log_level: {
        type: 'string',
        choices: [
            { value: 'trace', label: 'trace' },
            { value: 'debug', label: 'debug' },
            { value: 'info', label: 'info' },
            { value: 'warn', label: 'warn' },
            { value: 'error', label: 'error' },
            { value: 'fatal', label: 'fatal' },
            { value: 'mark', label: 'mark' },
            { value: 'off', label: 'off' },
        ],
        default: 'info',
        label: '日志等级',
    },
    /** 站点根静态文件目录（相对 BaseApp.configDir 或绝对路径），用于可信域名校验文件等 */
    public_static_dir: {
        type: 'string',
        transform: (v: unknown) => (v != null && String(v).trim() !== '' ? String(v).trim() : undefined),
    },
};

