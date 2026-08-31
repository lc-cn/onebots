import { describe, expect, it } from "vitest";
import type { Schema, ValidationRule } from "onebots";
import { matrixSchema } from "./index.js";

describe("Matrix 配置 Schema", () => {
    it("提供 sync、appservice、manual 且按模式隐藏无关字段", () => {
        expect(ruleAt("receive_mode").choices?.map(choice => choice.value)).toEqual([
            "sync",
            "appservice",
            "manual",
        ]);
        expect(ruleAt("hs_token").ui?.visibleWhen).toEqual({
            path: "receive_mode",
            oneOf: ["appservice"],
        });
        expect(ruleAt("event_types").ui?.visibleWhen).toEqual({
            path: "receive_mode",
            oneOf: ["sync"],
        });
    });

    it("事件类型与 Direct Room 都可动态增减而非手填 JSON", () => {
        expect(ruleAt("event_types")).toMatchObject({
            type: "array",
            allowCustomValues: true,
            ui: { widget: "choice-list", section: "filter" },
        });
        expect(ruleAt("event_types").choices).toContainEqual({
            value: "m.room.message",
            label: "m.room.message",
        });
        expect(ruleAt("direct_room_ids")).toMatchObject({
            type: "array",
            allowCustomValues: true,
            ui: { widget: "choice-list" },
        });
    });

    it("全部凭据均标记为敏感字段", () => {
        for (const field of ["access_token", "as_token", "hs_token"]) {
            expect(ruleAt(field).sensitive).toBe(true);
        }
    });
});

function ruleAt(path: string): ValidationRule {
    let node: Schema | ValidationRule = matrixSchema;
    for (const part of path.split(".")) node = (node as Schema)[part]!;
    if (!("type" in node)) throw new Error(`Matrix Schema 字段不存在: ${path}`);
    return node;
}
