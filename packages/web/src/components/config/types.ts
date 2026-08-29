import type { Schema, ValidationRule } from "@onebots/core";

export type { Schema, ValidationRule };

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
    visibility?: {
        dependencyKey: string;
        oneOf: Array<string | number | boolean>;
    };
    valueInference?: Array<{
        path: string[];
        value: string | number | boolean;
    }>;
};

export type SchemaGroup = {
    key: string;
    title: string;
    description?: string;
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
