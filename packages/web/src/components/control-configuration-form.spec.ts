import { describe, expect, it } from "vitest";
import {
    configurationGroups,
    configurationEdits,
    configurationSecret,
    fieldKey,
    valueAt,
} from "./control-configuration-form.js";
import { isSchemaFieldVisible } from "./config/utils.js";

describe("control configuration schema projection", () => {
    it("未知字段仅阻止列表结构变更，声明字段仍可编辑", () => {
        const groups = configurationGroups(
            {
                base: {
                    rows: {
                        type: "array",
                        items: { type: "object", properties: { host: { type: "string" } } },
                    },
                },
            },
            {
                document: { rows: [{ host: "localhost" }] },
                secretStates: [],
                unknownPaths: [["rows", "0", "unknown"]],
            },
        );
        expect(groups[0].lists[0].readonlyReason).toBeTruthy();
        expect(groups[0].fields[0].path).toEqual(["rows", "0", "host"]);
    });
    it("普通字符串数组保持已有选项列表编辑，不退化为逐行只读", () => {
        const groups = configurationGroups(
            {
                base: {
                    names: {
                        type: "array",
                        items: { type: "string" },
                        ui: { widget: "choice-list" },
                        allowCustomValues: true,
                    },
                },
            },
            { document: { names: [] }, secretStates: [], unknownPaths: [] },
        );
        expect(groups[0].lists).toEqual([]);
        expect(groups[0].fields[0].rule.ui?.widget).toBe("choice-list");
    });
    it("展开properties和普通嵌套对象，未出现的secret仍走专用修改", () => {
        const groups = configurationGroups(
            {
                base: {
                    connection: {
                        type: "object",
                        properties: {
                            nested: {
                                host: { type: "string" },
                                token: { type: "string", sensitive: true },
                            },
                        },
                    },
                },
            },
            { document: {}, secretStates: [], unknownPaths: [] },
        );
        const fields = groups[0].fields;
        expect(fields.map(field => field.path)).toEqual([
            ["connection", "nested", "host"],
            ["connection", "nested", "token"],
        ]);
        expect(configurationSecret(fields[1], [])).toEqual({
            path: fields[1].path,
            configured: false,
        });
        const key = fields[1].key;
        expect(
            configurationEdits(
                fields,
                [],
                { [key]: "synthetic-secret" },
                { [key]: "set" },
                new Set([key]),
            ),
        ).toEqual({
            changes: [],
            secrets: [{ op: "set", path: fields[1].path, value: "synthetic-secret" }],
        });
    });
    it("空record列表也显示专用添加操作，不提供整体秘密列表编辑", () => {
        const groups = configurationGroups(
            {
                base: {
                    rows: {
                        type: "array",
                        ui: { fields: [{ key: "token", label: "授权", sensitive: true }] },
                    },
                },
            },
            { document: {}, secretStates: [], unknownPaths: [] },
        );
        expect(groups[0].fields).toEqual([]);
        expect(groups[0].lists).toEqual([
            { path: ["rows"], key: fieldKey(["rows"]), label: "rows", count: 0 },
        ]);
    });
    it("items对象Schema递归展开嵌套结构，保存只提交选中的叶字段", () => {
        const projection = {
            document: { rows: [{ credentials: {} }] },
            secretStates: [{ path: ["rows", "0", "credentials", "token"], configured: true }],
            unknownPaths: [],
        };
        const groups = configurationGroups(
            {
                base: {
                    rows: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                credentials: {
                                    type: "object",
                                    properties: {
                                        token: { type: "string", sensitive: true },
                                        region: { type: "string" },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            projection,
        );
        const fields = groups[0].fields;
        expect(fields.map(field => field.path)).toEqual([
            ["rows", "0", "credentials", "token"],
            ["rows", "0", "credentials", "region"],
        ]);
        const key = fields[1].key;
        expect(
            configurationEdits(
                fields,
                projection.secretStates,
                { [key]: "cn" },
                {},
                new Set([key]),
            ),
        ).toEqual({ changes: [{ op: "set", path: fields[1].path, value: "cn" }], secrets: [] });
    });
    it("整个列表敏感时只显示秘密字段，不开放结构操作", () => {
        const groups = configurationGroups(
            {
                base: {
                    rows: {
                        type: "array",
                        sensitive: true,
                        items: { type: "object", properties: { token: { type: "string" } } },
                    },
                },
            },
            {
                document: {},
                secretStates: [{ path: ["rows"], configured: true }],
                unknownPaths: [],
            },
        );
        expect(groups[0].lists).toEqual([]);
        expect(groups[0].fields.map(field => field.path)).toEqual([["rows"]]);
    });
    it("结构化秘密新值按字段类型解析，保留或清除不发送输入值", () => {
        const fields = configurationGroups(
            { base: { credentials: { type: "object", sensitive: true } } },
            { document: {}, secretStates: [], unknownPaths: [] },
        )[0].fields;
        const key = fields[0].key;
        expect(
            configurationEdits(
                fields,
                [],
                { [key]: '{"token":"new"}' },
                { [key]: "set" },
                new Set([key]),
            ).secrets[0],
        ).toEqual({ op: "set", path: ["credentials"], value: { token: "new" } });
        expect(
            configurationEdits(
                fields,
                [],
                { [key]: "synthetic-secret" },
                { [key]: "clear" },
                new Set([key]),
            ).secrets[0],
        ).toEqual({ op: "clear", path: ["credentials"] });
        expect(() =>
            configurationEdits(
                fields,
                [],
                { [key]: "synthetic-secret" },
                { [key]: "set" },
                new Set([key]),
            ),
        ).toThrow("格式无效");
    });
    it("同一列表项的条件字段使用新路径key正确显示", () => {
        const fields = configurationGroups(
            {
                base: {
                    rows: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                mode: { type: "string" },
                                token: {
                                    type: "string",
                                    sensitive: true,
                                    ui: { visibleWhen: { path: "mode", oneOf: ["auth"] } },
                                },
                            },
                        },
                    },
                },
            },
            { document: { rows: [{ mode: "auth" }] }, secretStates: [], unknownPaths: [] },
        )[0].fields;
        const token = fields.find(field => field.path.at(-1) === "token")!;
        expect(isSchemaFieldVisible(token, { [fieldKey(["rows", "0", "mode"])]: "auth" })).toBe(
            true,
        );
        expect(isSchemaFieldVisible(token, { [fieldKey(["rows", "0", "mode"])]: "none" })).toBe(
            false,
        );
    });
    it("未知受保护对象不展示整体编辑器，保留可见提示", () => {
        const groups = configurationGroups(
            { base: { data: { type: "object" } } },
            { document: {}, secretStates: [], unknownPaths: [["data"]] },
        );
        expect(groups[0].fields).toEqual([]);
        expect(groups[0].notices).toHaveLength(1);
    });
    it("空白配置展示基础Schema，不自动创建账号或协议", () => {
        const groups = configurationGroups(
            {
                base: { port: { type: "number" } },
                adapters: { qq: { token: { type: "string", sensitive: true } } },
                protocols: { "onebot.v11": { port: { type: "number" } } },
            },
            { document: {}, secretStates: [], unknownPaths: [] },
        );
        expect(groups.map(group => group.title)).toEqual(["基础设置"]);
    });
    it("账号ID带点时字段路径仍保持账号键整体，身份字段不可改", () => {
        const groups = configurationGroups(
            { adapters: { qq: { account_id: { type: "string" }, name: { type: "string" } } } },
            { document: { "qq.001.02": { name: "test" } }, secretStates: [], unknownPaths: [] },
        );
        expect(groups[0].fields.map(field => field.path)).toEqual([["qq.001.02", "name"]]);
        expect(valueAt({ "qq.001.02": { id: "001.02" } }, ["qq.001.02", "id"])).toBe("001.02");
        expect(fieldKey(["a.b", "c"])).not.toBe(fieldKey(["a", "b.c"]));
    });
    it("已存在协议容器才出现表单", () => {
        const groups = configurationGroups(
            { protocols: { "onebot.v11": { port: { type: "number" } } }, adapters: { qq: {} } },
            {
                document: { general: { "onebot.v11": {} }, "qq.1": {} },
                secretStates: [],
                unknownPaths: [],
            },
        );
        expect(groups.map(group => group.title)).toEqual(["协议默认值 · onebot.v11"]);
    });
    it("含秘密的列表展开已存在项，不能作为普通父对象整段覆盖", () => {
        const groups = configurationGroups(
            {
                base: {
                    servers: {
                        type: "array",
                        ui: {
                            widget: "record-list",
                            fields: [
                                { key: "token", label: "授权", sensitive: true },
                                { key: "host", label: "地址" },
                            ],
                        },
                    },
                },
            },
            {
                document: { servers: [{ host: "localhost" }] },
                secretStates: [{ path: ["servers", "0", "token"], configured: true }],
                unknownPaths: [],
            },
        );
        expect(groups[0].fields.map(field => field.path)).toEqual([
            ["servers", "0", "token"],
            ["servers", "0", "host"],
        ]);
        expect(groups[0].fields[0].rule.sensitive).toBe(true);
    });
});
