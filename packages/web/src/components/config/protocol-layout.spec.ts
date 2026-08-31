import { describe, expect, test } from "vitest";
import { buildProtocolFieldLayout } from "./protocol-layout.js";
import type { SchemaGroup } from "./types.js";

describe("protocol form layout", () => {
    test("uses schema sections instead of field-name conventions", () => {
        const group: SchemaGroup = {
            key: "custom.v1",
            title: "Custom",
            fields: [
                {
                    key: "custom::listener",
                    path: ["custom.v1", "listener"],
                    label: "自定义入口名",
                    placeholder: "",
                    rule: { type: "boolean", ui: { section: "transport" } },
                },
                {
                    key: "custom::rules",
                    path: ["custom.v1", "rules"],
                    label: "自定义过滤名",
                    placeholder: "",
                    rule: { type: "object", ui: { section: "filter" } },
                },
                {
                    key: "custom::timeout",
                    path: ["custom.v1", "timeout"],
                    label: "超时",
                    placeholder: "",
                    rule: { type: "number" },
                },
            ],
        };

        const layout = buildProtocolFieldLayout(group);

        expect(layout.sections.map(section => [section.key, section.fields[0]?.key])).toEqual([
            ["transport", "custom::listener"],
            ["filter", "custom::rules"],
        ]);
        expect(layout.advanced.map(field => field.key)).toEqual(["custom::timeout"]);
    });
});
