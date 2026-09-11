/** 纯 JSON 文档编辑。账号键中的点号没有路径语义，路径必须显式分段。 */
export type ConfigurationValue =
    | null
    | boolean
    | number
    | string
    | ConfigurationValue[]
    | ConfigurationDocument;
export interface ConfigurationDocument {
    [key: string]: ConfigurationValue;
}
export type ConfigurationPath = string[];
export type ConfigurationChange =
    | { op: "set"; path: ConfigurationPath; value: ConfigurationValue }
    | { op: "remove"; path: ConfigurationPath };
export type SecretChange =
    | { op: "set"; path: ConfigurationPath; value: ConfigurationValue }
    | { op: "keep" | "clear"; path: ConfigurationPath };
export interface SecretState {
    path: ConfigurationPath;
    configured: boolean;
}
export interface ConfigurationProjection {
    document: ConfigurationDocument;
    secretStates: SecretState[];
}

const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);
const MAX_DEPTH = 64;
const MAX_NODES = 100_000;
function fail(): never {
    throw new Error("配置文档或修改请求无效");
}
const record = (value: unknown): value is Record<string, unknown> =>
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

/** 拒绝 getter、非 JSON 值、循环及危险键，不调用用户提供的序列化方法。 */
function clone(value: unknown): ConfigurationValue {
    let nodes = 0;
    let characters = 0;
    const seen = new Set<object>();
    function visit(input: unknown, depth: number): ConfigurationValue {
        if (typeof input === "string") characters += input.length;
        if (++nodes > MAX_NODES || depth > MAX_DEPTH || characters > 1_048_576) fail();
        if (input === null) return null;
        if (typeof input === "string" || typeof input === "boolean") return input;
        if (typeof input === "number") return Number.isFinite(input) ? input : fail();
        if (!Array.isArray(input) && !record(input)) fail();
        const object = input as object;
        if (seen.has(object)) fail();
        seen.add(object);
        const result: ConfigurationDocument | ConfigurationValue[] = Array.isArray(input) ? [] : {};
        const keys = Reflect.ownKeys(object);
        if (Array.isArray(input) && keys.length !== input.length + 1) fail();
        for (const key of keys) {
            if (Array.isArray(input) && key === "length") continue;
            if (typeof key !== "string" || FORBIDDEN.has(key)) fail();
            characters += key.length;
            if (characters > 1_048_576) fail();
            const descriptor = Object.getOwnPropertyDescriptor(object, key);
            if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) fail();
            if (Array.isArray(result)) {
                if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) !== result.length) fail();
                result.push(visit(descriptor.value, depth + 1));
            } else result[key] = visit(descriptor.value, depth + 1);
        }
        seen.delete(object);
        return result;
    }
    return visit(value, 0);
}

export function parseConfigurationDocument(value: unknown): ConfigurationDocument {
    return boundary(() => {
        const result = clone(value);
        if (!record(result)) fail();
        return result as ConfigurationDocument;
    });
}
function paths(value: unknown): ConfigurationPath[] {
    if (!Array.isArray(value) || value.length > 1_000) fail();
    const result = value.map(path => {
        if (
            !Array.isArray(path) ||
            !path.length ||
            path.length > MAX_DEPTH ||
            path.some(part => typeof part !== "string" || !part.length || FORBIDDEN.has(part))
        )
            fail();
        return [...path] as string[];
    });
    for (let i = 0; i < result.length; i++)
        for (let j = 0; j < i; j++) if (intersects(result[i], result[j])) fail();
    return result;
}
function prefix(a: ConfigurationPath, b: ConfigurationPath): boolean {
    return a.length <= b.length && a.every((part, index) => part === b[index]);
}
function intersects(a: ConfigurationPath, b: ConfigurationPath): boolean {
    return prefix(a, b) || prefix(b, a);
}
function keyFor(
    parent: ConfigurationDocument | ConfigurationValue[],
    key: string,
): string | number {
    if (!Array.isArray(parent)) return key;
    if (
        !/^(0|[1-9]\d*)$/.test(key) ||
        !Number.isSafeInteger(Number(key)) ||
        Number(key) >= parent.length
    )
        fail();
    return Number(key);
}
function locate(
    root: ConfigurationDocument,
    path: ConfigurationPath,
    missing = false,
): { parent: ConfigurationDocument | ConfigurationValue[]; key: string | number } | undefined {
    let current: ConfigurationValue = root;
    for (let index = 0; index < path.length; index++) {
        if (!Array.isArray(current) && !record(current)) fail();
        const parent = current as ConfigurationDocument | ConfigurationValue[];
        const key = keyFor(parent, path[index]);
        if (index === path.length - 1) return { parent, key };
        if (!Object.hasOwn(parent, key)) {
            if (missing) return undefined;
            fail();
        }
        current = (parent as ConfigurationDocument)[key];
    }
    return fail();
}
function remove(target: NonNullable<ReturnType<typeof locate>>): void {
    // 数组不可移位，否则其余秘密路径会指向另一个值；null 表示该槽位已清除。
    if (Array.isArray(target.parent)) target.parent[Number(target.key)] = null;
    else delete target.parent[target.key];
}
function requests(value: unknown, secret: boolean): Array<ConfigurationChange | SecretChange> {
    const clean = clone(value);
    if (!Array.isArray(clean) || clean.length > 1_000) fail();
    for (const change of clean) {
        if (
            !record(change) ||
            !(secret ? ["set", "keep", "clear"] : ["set", "remove"]).includes(String(change.op))
        )
            fail();
        const keys = Object.keys(change).sort().join(",");
        if (keys !== (change.op === "set" ? "op,path,value" : "op,path")) fail();
    }
    paths(clean.map(change => (change as ConfigurationDocument).path));
    return clean as unknown as Array<ConfigurationChange | SecretChange>;
}

export function projectConfiguration(
    input: unknown,
    secretPaths: unknown,
): ConfigurationProjection {
    return boundary(() => {
        const result = parseConfigurationDocument(input);
        const secrets = paths(clone(secretPaths));
        const secretStates = secrets.map(path => {
            const target = locate(result, path, true);
            const configured =
                !!target &&
                Object.hasOwn(target.parent, target.key) &&
                (target.parent as ConfigurationDocument)[target.key] !== null &&
                (target.parent as ConfigurationDocument)[target.key] !== "";
            if (target) remove(target);
            return { path, configured };
        });
        return { document: result, secretStates };
    });
}

export function applyConfigurationChanges(
    input: unknown,
    changes: unknown,
    secretPaths: unknown,
): ConfigurationDocument {
    return boundary(() => {
        const result = parseConfigurationDocument(input);
        const secrets = paths(clone(secretPaths));
        for (const change of requests(changes, false)) {
            if (secrets.some(secret => intersects(secret, change.path))) fail();
            const target = locate(result, change.path)!;
            if (change.op === "set")
                (target.parent as ConfigurationDocument)[target.key] = change.value;
            else remove(target);
        }
        return result;
    });
}

export function applySecretChanges(
    input: unknown,
    changes: unknown,
    secretPaths: unknown,
): ConfigurationDocument {
    return boundary(() => {
        const result = parseConfigurationDocument(input);
        const secrets = paths(clone(secretPaths));
        for (const change of requests(changes, true)) {
            if (!secrets.some(secret => prefix(secret, change.path) && prefix(change.path, secret)))
                fail();
            if (change.op === "keep") continue;
            const target = locate(result, change.path)!;
            if (change.op === "set")
                (target.parent as ConfigurationDocument)[target.key] = change.value;
            else remove(target);
        }
        return result;
    });
}

function boundary<T>(action: () => T): T {
    try {
        return action();
    } catch {
        return fail();
    }
}
