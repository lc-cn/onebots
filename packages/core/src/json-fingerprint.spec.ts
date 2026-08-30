import { describe, expect, it } from "vitest";
import { sha256Json, stableJsonStringify } from "./json-fingerprint.js";

describe("JSON fingerprint", () => {
    it("递归忽略对象键的构造顺序", () => {
        const left = { event: { id: "evt", tags: ["a", "b"] }, version: 2 };
        const right = { version: 2, event: { tags: ["a", "b"], id: "evt" } };

        expect(stableJsonStringify(left)).toBe(stableJsonStringify(right));
        expect(sha256Json(left)).toBe(sha256Json(right));
    });

    it("保留数组顺序", () => {
        expect(sha256Json(["a", "b"])).not.toBe(sha256Json(["b", "a"]));
    });

    it("允许不同字段复用同一个对象", () => {
        const shared = { id: "evt" };
        expect(stableJsonStringify({ first: shared, second: shared })).toBe(
            '{"first":{"id":"evt"},"second":{"id":"evt"}}',
        );
    });

    it("拒绝循环引用和不可序列化的顶层值", () => {
        const circular: Record<string, unknown> = {};
        circular.self = circular;

        expect(() => stableJsonStringify(circular)).toThrow(/循环引用/u);
        expect(() => stableJsonStringify(undefined)).toThrow(/不能序列化/u);
        expect(() => stableJsonStringify(new Date(0))).toThrow(/JSON 对象/u);
    });
});
