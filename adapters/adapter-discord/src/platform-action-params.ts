import { DiscordError } from "./errors.js";

export type DiscordActionParams = Readonly<Record<string, unknown>>;
type DiscordQueryScalar = string | number | boolean;
export type DiscordActionQuery = Record<string, string | string[]>;

export function requireString(params: DiscordActionParams, name: string): string {
    const value = params[name];
    if (typeof value !== "string" || !value) {
        throw invalidParameter(`Discord 参数 ${name} 必须为字符串`);
    }
    return value;
}

export function requireSnowflake(params: DiscordActionParams, name: string): string {
    const value = String(params[name] ?? "");
    if (!/^\d+$/.test(value)) throw invalidParameter(`Discord 参数 ${name} 必须为 Snowflake`);
    return value;
}

export function optionalSnowflake(params: DiscordActionParams, name: string): string | undefined {
    return params[name] == null ? undefined : requireSnowflake(params, name);
}

export function requireSnowflakeArray(
    params: DiscordActionParams,
    name: string,
    minimum: number,
    maximum: number,
): string[] {
    const value = params[name];
    if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
        throw invalidParameter(`Discord 参数 ${name} 数量必须为 ${minimum}-${maximum}`);
    }
    return value.map(item => {
        const snowflake = String(item);
        if (!/^\d+$/.test(snowflake)) {
            throw invalidParameter(`Discord 参数 ${name} 包含无效 Snowflake`);
        }
        return snowflake;
    });
}

export function requireObject(
    params: DiscordActionParams,
    name: string,
): Readonly<Record<string, unknown>> {
    const value = params[name];
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw invalidParameter(`Discord 参数 ${name} 必须为对象`);
    }
    return value as Readonly<Record<string, unknown>>;
}

export function optionalInteger(params: DiscordActionParams, name: string): number | undefined {
    if (params[name] == null) return undefined;
    const value = Number(params[name]);
    if (!Number.isSafeInteger(value) || value < 0) {
        throw invalidParameter(`Discord 参数 ${name} 必须为非负整数`);
    }
    return value;
}

export function optionalString(params: DiscordActionParams, name: string): string | undefined {
    if (params[name] == null) return undefined;
    const value = params[name];
    if (typeof value !== "string") throw invalidParameter(`Discord 参数 ${name} 必须为字符串`);
    return value;
}

export function query(params: DiscordActionParams): DiscordActionQuery {
    const source = params.query;
    if (typeof source !== "object" || source === null || Array.isArray(source)) return {};
    const result: DiscordActionQuery = {};
    for (const [key, value] of Object.entries(source)) {
        if (value == null) continue;
        if (Array.isArray(value)) {
            if (!value.every(isScalar)) {
                throw invalidParameter(`Discord query 参数 ${key} 数组必须只包含标量`);
            }
            result[key] = value.map(String);
            continue;
        }
        if (!isScalar(value)) {
            throw invalidParameter(`Discord query 参数 ${key} 必须为标量或标量数组`);
        }
        result[key] = String(value);
    }
    return result;
}

function isScalar(value: unknown): value is DiscordQueryScalar {
    return (
        typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value))
    );
}

function invalidParameter(message: string): DiscordError {
    return DiscordError.invalid(message, "DISCORD_ACTION_PARAMS_INVALID");
}
