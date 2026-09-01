import { describe, expect, it } from "vitest";
import { getValueOfObj, setValueToObj } from "./utils.js";

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
