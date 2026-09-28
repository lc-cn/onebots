export const RESERVED_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isObjectLike(value: unknown): value is object {
    return (typeof value === "object" && value !== null) || typeof value === "function";
}

function validateMergeValue(value: unknown, seen: WeakSet<object>): void {
    if (!isObjectLike(value) || seen.has(value)) return;
    seen.add(value);
    for (const key of Object.keys(value)) {
        if (RESERVED_OBJECT_KEYS.has(key)) {
            throw new SyntaxError(`can't merge reserved property: ${key}`);
        }
        validateMergeValue(Reflect.get(value, key), seen);
    }
}

function mergeValidated(
    base: Record<string, unknown> | unknown[] | unknown,
    from: unknown[],
): unknown {
    if (base === null || base === undefined) base = from.shift();
    if (from.length === 0) return base;
    if (typeof base !== "object") return base;
    if (Array.isArray(base)) return Array.from(new Set(base.concat(...(from as unknown[][]))));

    const baseObj = base as Record<string, unknown>;
    for (const item of from) {
        if (item === null || item === undefined) continue;
        const itemObj = Object(item) as Record<string, unknown>;
        for (const key of Object.keys(itemObj)) {
            const itemValue = Reflect.get(itemObj, key) as unknown;
            if (Object.hasOwn(baseObj, key)) {
                const baseValue = Reflect.get(baseObj, key) as unknown;
                if (baseValue && typeof baseValue === "object") {
                    baseObj[key] = mergeValidated(baseValue, [itemValue]);
                } else {
                    baseObj[key] = itemValue;
                }
            } else {
                baseObj[key] = itemValue;
            }
        }
    }
    return baseObj;
}

/** 深度合并对象并合并去重数组；继承字段和原型链保留名称不会进入结果。 */
export function deepMerge(
    base: Record<string, unknown> | unknown[] | unknown,
    ...from: unknown[]
): unknown {
    const values = [base, ...from];
    const seen = new WeakSet<object>();
    values.forEach(value => validateMergeValue(value, seen));
    return mergeValidated(base, from);
}
