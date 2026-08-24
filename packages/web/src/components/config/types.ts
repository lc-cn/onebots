export type ValidationRule = {
    required?: boolean;
    type?: 'string' | 'number' | 'boolean' | 'object' | 'array';
    min?: number;
    max?: number;
    pattern?: RegExp;
    choices?: Array<{ label: string; value: string | number | boolean }>;
    default?: unknown;
    label?: string;
    description?: string;
    placeholder?: string;
};

export type Schema = Record<string, ValidationRule | Schema>;

export type SchemaBundle = {
    base?: Schema;
    general?: Schema;
    protocols?: Record<string, Schema>;
    adapters?: Record<string, Schema>;
};

export type SchemaFieldDef = {
    path: string[];
    key: string;
    label: string;
    rule: ValidationRule;
    placeholder: string;
};

export type SchemaGroup = {
    key: string;
    title: string;
    fields: SchemaFieldDef[];
};

export type AccountRow = {
    key: string;
    platform: string;
    account_id: string;
    config: Record<string, unknown>;
    preview: string;
};

export type StaticApiHfBackup = { attempted: boolean; success?: boolean; message?: string };
