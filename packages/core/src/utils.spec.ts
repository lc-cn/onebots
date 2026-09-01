import { describe, expect, it } from "vitest";
import { deepClone, deepMerge, getValueOfObj, setValueToObj } from "./utils.js";

describe("deepClone", () => {
    it("创建包含循环引用和内建类型的独立副本", () => {
        const source = { createdAt: new Date("2026-09-01T00:00:00Z") } as {
            createdAt: Date;
            self?: unknown;
        };
        source.self = source;

        const clone = deepClone(source);

        expect(clone).not.toBe(source);
        expect(clone.createdAt).not.toBe(source.createdAt);
        expect(clone.createdAt).toEqual(source.createdAt);
        expect(clone.self).toBe(clone);
    });

    it("无法创建独立副本时抛错而不回退到原引用", () => {
        const source = { handler: () => "unsafe" };

        expect(() => deepClone(source)).toThrow();
    });
});

describe("deepMerge", () => {
    it("递归合并自有字段并保持数组去重语义", () => {
        const base = { nested: { first: true }, list: ["a"] };
        const result = deepMerge(base, {
            nested: { second: true },
            list: ["a", "b"],
        });

        expect(result).toBe(base);
        expect(result).toEqual({
            nested: { first: true, second: true },
            list: ["a", "b"],
        });
    });

    it("忽略来源对象的继承字段并支持覆盖 hasOwnProperty 配置键", () => {
        const source = Object.create({ inherited: "hidden" }) as Record<string, unknown>;
        source.visible = "shown";
        const base = { hasOwnProperty: "configuration value" };

        expect(deepMerge(base, source)).toEqual({
            hasOwnProperty: "configuration value",
            visible: "shown",
        });
    });

    it.each(["__proto__", "constructor", "prototype"])(
        "在写入前拒绝嵌套的原型链保留字段 %s",
        reserved => {
            const base = { safe: { unchanged: true } };
            const source = JSON.parse(
                `{"safe":{"accepted":true,"${reserved}":{"polluted":true}}}`,
            ) as Record<string, unknown>;

            expect(() => deepMerge(base, source)).toThrow(`reserved property: ${reserved}`);
            expect(base).toEqual({ safe: { unchanged: true } });
            expect(Object.prototype).not.toHaveProperty("polluted");
        },
    );
});

describe("对象路径工具", () => {
    it("读写自有嵌套字段且不修改调用方传入的路径", () => {
        const value = { adapter: { token: "old" } };
        const path = ["adapter", "token"];

        expect(getValueOfObj<string>(value, path)).toBe("old");
        expect(setValueToObj(value, path, "new")).toBe(true);
        expect(value.adapter.token).toBe("new");
        expect(path).toEqual(["adapter", "token"]);
    });

    it.each(["adapter..token", "__proto__.polluted", "adapter.constructor.prototype.polluted"])(
        "拒绝不安全的字符串路径 %s",
        path => {
            const value = { adapter: { token: "safe" } };

            expect(() => setValueToObj(value, path, "changed")).toThrow(SyntaxError);
            expect(() => getValueOfObj(value, path)).toThrow(SyntaxError);
            expect(value).toEqual({ adapter: { token: "safe" } });
            expect(Object.prototype).not.toHaveProperty("polluted");
        },
    );

    it("拒绝数组形式的保留路径段", () => {
        const value = {};

        expect(() => setValueToObj(value, ["constructor", "prototype", "polluted"], true)).toThrow(
            "reserved path segment",
        );
        expect(Object.prototype).not.toHaveProperty("polluted");
    });

    it("拒绝 JavaScript 调用方传入的非字符串路径段", () => {
        const value = { adapter: { token: "safe" } };
        const path = ["adapter", 1] as unknown as string[];

        expect(() => setValueToObj(value, path, "changed")).toThrow(SyntaxError);
        expect(value).toEqual({ adapter: { token: "safe" } });
    });

    it("创建自有末级字段而不触发继承的 setter", () => {
        let setterCalls = 0;
        const prototype = {
            set token(_value: unknown) {
                setterCalls += 1;
            },
        };
        const value = Object.create(prototype) as Record<string, unknown>;

        expect(setValueToObj(value, "token", "safe")).toBe(true);
        expect(setterCalls).toBe(0);
        expect(Object.hasOwn(value, "token")).toBe(true);
        expect(value.token).toBe("safe");
    });

    it("不会读取或穿过继承属性", () => {
        const prototype = { inherited: { secret: "hidden" } };
        const value = Object.create(prototype) as Record<string, unknown>;
        value.own = { visible: "shown" };

        expect(getValueOfObj(value, "own.visible")).toBe("shown");
        expect(() => getValueOfObj(value, "inherited.secret")).toThrow(
            "inherited or missing property",
        );
        expect(() => getValueOfObj(value, "toString")).toThrow("inherited or missing property");
        expect(() => setValueToObj(value, "inherited.secret", "changed")).toThrow(
            "inherited or missing property",
        );
        expect(prototype.inherited.secret).toBe("hidden");
    });
});
