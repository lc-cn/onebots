import { describe, expect, it } from "vitest";
import { configurationGroups, fieldKey, valueAt } from "./control-configuration-form.js";

describe("control configuration schema projection", () => {
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
