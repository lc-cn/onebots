import { createHash } from "node:crypto";

/**
 * 按 JSON 语义生成确定性文本。
 *
 * 对象键会递归排序，因此同一 JSON 值不会因解析器或构造顺序不同而产生不同指纹。
 * 该函数只接受 JSON 值；循环引用、非 JSON 对象与不可序列化的顶层值会明确失败。
 */
export function stableJsonStringify(value: unknown): string {
    const serialized = JSON.stringify(canonicalize(value, new WeakSet<object>()));
    if (serialized === undefined) throw new TypeError("值不能序列化为 JSON");
    return serialized;
}

function canonicalize(value: unknown, active: WeakSet<object>): unknown {
    if (value === null || typeof value !== "object") return value;
    if (active.has(value)) throw new TypeError("无法序列化循环引用的 JSON 值");
    active.add(value);
    let result: unknown;
    if (Array.isArray(value)) {
        result = value.map(item => canonicalize(item, active));
    } else {
        const prototype: unknown = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError("只能序列化 JSON 对象和数组");
        }
        result = Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
                .map(([key, item]) => [key, canonicalize(item, active)]),
        );
    }
    active.delete(value);
    return result;
}

/** 返回小写十六进制 SHA-256；调用方负责定义参与身份计算的字段。 */
export function sha256Text(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

/** 返回与对象键插入顺序无关的 JSON SHA-256。 */
export function sha256Json(value: unknown): string {
    return sha256Text(stableJsonStringify(value));
}
