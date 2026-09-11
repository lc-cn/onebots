import { describe, expect, it } from "vitest";
import {
    applyConfigurationChanges,
    applySecretChanges,
    projectConfiguration,
} from "./configuration-document.js";

const secret = [
    ["qq.001.02", "token"],
    ["servers", "0", "password"],
];
const fixture = () => ({
    "qq.001.02": { token: "synthetic-secret", id: "001.02" },
    servers: [{ password: "nested-secret", port: 80 }],
});
const failure = /^配置文档或修改请求无效$/;

describe("configuration document", () => {
    it("尚未出现的秘密路径也不能经普通父对象set引入", () => {
        expect(() =>
            applyConfigurationChanges(
                {},
                [{ op: "set", path: ["account"], value: { token: "synthetic-secret" } }],
                [["account", "token"]],
            ),
        ).toThrow(failure);
        expect(
            applySecretChanges(
                { account: {} },
                [{ op: "set", path: ["account", "token"], value: "synthetic-secret" }],
                [["account", "token"]],
            ),
        ).toEqual({ account: { token: "synthetic-secret" } });
    });
    it("秘密路径与修改列表必须是完整有界数组，不接受字符串路径", () => {
        for (const paths of [
            undefined,
            "a.b",
            [["a", 1]],
            [[]],
            [["a"], ["a"]],
            Array(2),
            Array.from({ length: 1001 }, (_, i) => [String(i)]),
        ])
            expect(() => projectConfiguration({}, paths)).toThrow(failure);
        for (const changes of [
            undefined,
            {},
            [{ op: "set", path: "a.b", value: 1 }],
            [{ op: "unknown", path: ["a"] }],
        ])
            expect(() => applyConfigurationChanges({}, changes, [])).toThrow(failure);
        expect(() => projectConfiguration({ large: "x".repeat(1_048_577) }, [])).toThrow(failure);
    });
    it("按显式路径投影秘密，保留带点账号键及字符串ID，不污染原值", () => {
        const input = fixture();
        const projected = projectConfiguration(input, secret);
        expect(projected).toEqual({
            document: { "qq.001.02": { id: "001.02" }, servers: [{ port: 80 }] },
            secretStates: secret.map(path => ({ path, configured: true })),
        });
        expect(JSON.stringify(projected)).not.toContain("synthetic-secret");
        projected.secretStates[0].path[0] = "changed";
        expect(secret[0][0]).toBe("qq.001.02");
        expect(input).toEqual(fixture());
    });
    it("普通修改深复制输入和请求值，数组路径不拆点", () => {
        const input = fixture();
        const value = { nested: ["001"] };
        const result = applyConfigurationChanges(
            input,
            [
                { op: "set", path: ["servers", "0", "port"], value: 443 },
                { op: "set", path: ["new"], value },
            ],
            secret,
        );
        value.nested[0] = "changed";
        expect(result.new).toEqual({ nested: ["001"] });
        expect(result.servers).toEqual([{ password: "nested-secret", port: 443 }]);
        expect(input).toEqual(fixture());
    });
    it("普通set/remove不能修改秘密、秘密父节点或秘密子节点", () => {
        for (const path of [
            ["qq.001.02"],
            ["qq.001.02", "token"],
            ["qq.001.02", "token", "child"],
            ["servers"],
            ["servers", "0"],
        ]) {
            expect(() =>
                applyConfigurationChanges(fixture(), [{ op: "set", path, value: {} }], secret),
            ).toThrow(failure);
            expect(() =>
                applyConfigurationChanges(fixture(), [{ op: "remove", path }], secret),
            ).toThrow(failure);
        }
    });
    it("秘密仅接受keep/set/clear，不能通过秘密接口改普通字段", () => {
        const input = fixture();
        expect(applySecretChanges(input, [{ op: "keep", path: secret[0] }], secret)).toEqual(input);
        const result = applySecretChanges(
            input,
            [
                { op: "set", path: secret[0], value: "replacement" },
                { op: "clear", path: secret[1] },
            ],
            secret,
        );
        expect(result).toEqual({
            "qq.001.02": { token: "replacement", id: "001.02" },
            servers: [{ port: 80 }],
        });
        expect(() =>
            applySecretChanges(input, [{ op: "set", path: ["ordinary"], value: "secret" }], secret),
        ).toThrow(failure);
        expect(() =>
            applySecretChanges(input, [{ op: "keep", path: secret[0], value: "ignored" }], secret),
        ).toThrow(failure);
        expect(input).toEqual(fixture());
    });
    it("数组槽秘密清除为null以保持其余路径，不移动索引", () => {
        const input = { tokens: ["first", "second", "third"] };
        expect(
            projectConfiguration(input, [
                ["tokens", "0"],
                ["tokens", "2"],
            ]),
        ).toEqual({
            document: { tokens: [null, "second", null] },
            secretStates: [
                { path: ["tokens", "0"], configured: true },
                { path: ["tokens", "2"], configured: true },
            ],
        });
        expect(
            applyConfigurationChanges(
                input,
                [{ op: "remove", path: ["tokens", "0"] }],
                [["tokens", "2"]],
            ),
        ).toEqual({ tokens: [null, "second", "third"] });
    });
    it("缺失秘密报告未设置，空值不伪造已配置状态", () => {
        expect(
            projectConfiguration({ a: "", b: null, enabled: false }, [
                ["a"],
                ["b"],
                ["missing", "nested"],
                ["enabled"],
            ]).secretStates.map(value => value.configured),
        ).toEqual([false, false, false, true]);
    });
    it("重复及父子冲突路径整体拒绝，前面的修改不外泄", () => {
        const input = { a: { b: 1 } };
        for (const next of [["a"], ["a", "b"]])
            expect(() =>
                applyConfigurationChanges(
                    input,
                    [
                        { op: "set", path: ["a"], value: {} },
                        { op: "remove", path: next },
                    ],
                    [],
                ),
            ).toThrow(failure);
        expect(input).toEqual({ a: { b: 1 } });
        expect(() => projectConfiguration(input, [["a"], ["a", "b"]])).toThrow(failure);
    });
    it("拒绝非对象穿透、非规范数组索引及创建数组空洞", () => {
        for (const path of [
            ["a", "nested"],
            ["missing", "nested"],
            ["list", "01"],
            ["list", "-1"],
            ["list", "1"],
            ["list", "length"],
        ])
            expect(() =>
                applyConfigurationChanges({ a: 1, list: [0] }, [{ op: "set", path, value: 2 }], []),
            ).toThrow(failure);
    });
    it("拒绝危险键、空路径、非JSON值与未知请求属性", () => {
        for (const key of ["__proto__", "constructor", "prototype"]) {
            expect(() =>
                applyConfigurationChanges({}, [{ op: "set", path: [key], value: {} }], []),
            ).toThrow(failure);
            expect(() => projectConfiguration(JSON.parse(`{"${key}":{}}`), [])).toThrow(failure);
        }
        for (const value of [
            undefined,
            NaN,
            Infinity,
            1n,
            new Date(),
            () => 1,
            [undefined],
            Array(2),
        ])
            expect(() =>
                applyConfigurationChanges({}, [{ op: "set", path: ["a"], value }], []),
            ).toThrow(failure);
        expect(() =>
            applyConfigurationChanges({}, [{ op: "set", path: [], value: 1 }], []),
        ).toThrow(failure);
        expect(() =>
            applyConfigurationChanges(
                {},
                [{ op: "remove", path: ["a"], extra: "synthetic-secret" }],
                [],
            ),
        ).toThrow(failure);
        expect({}).not.toHaveProperty("polluted");
    });
    it("循环、getter、Proxy异常及过深输入返回固定错误，不泄露配置值", () => {
        const cycle: Record<string, unknown> = {};
        cycle.self = cycle;
        const getter = Object.defineProperty({}, "token", {
            enumerable: true,
            get() {
                throw new Error("synthetic-secret");
            },
        });
        const proxy = new Proxy(
            {},
            {
                getPrototypeOf() {
                    throw new Error("synthetic-secret");
                },
            },
        );
        let deep: unknown = {};
        for (let i = 0; i < 100; i++) deep = { next: deep };
        for (const input of [cycle, getter, proxy, deep, [], "synthetic-secret"])
            expect(() => projectConfiguration(input, [])).toThrow(failure);
    });
});
