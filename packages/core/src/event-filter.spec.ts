import { describe, expect, test } from "vitest";
import { compileEventFilter, editorToEventFilters, eventFiltersToEditor } from "./event-filter.js";

describe("event filter", () => {
    test("evaluates nested fields and logical operators", () => {
        const predicate = compileEventFilter({
            $and: [
                { type: "message" },
                { message_type: ["group", "channel"] },
                { raw_message: { $like: "告警" } },
                { $not: { sender: { id: { string: "blocked" } } } },
            ],
        });

        expect(
            predicate({
                type: "message",
                message_type: "group",
                raw_message: "服务告警",
                sender: { id: { string: "allowed" } },
            }),
        ).toBe(true);
        expect(
            predicate({
                type: "message",
                message_type: "private",
                raw_message: "服务告警",
                sender: { id: { string: "allowed" } },
            }),
        ).toBe(false);
    });

    test("round-trips the visual editor state through the same language", () => {
        const filters = editorToEventFilters({
            match: "any",
            rules: [
                { path: "type", operator: "eq", value: "request" },
                { path: "platform", operator: "regex", value: "^(qq|kook)$" },
            ],
        });

        expect(eventFiltersToEditor(filters)).toEqual({
            match: "any",
            rules: [
                { path: "type", operator: "eq", value: "request" },
                { path: "platform", operator: "regex", value: "^(qq|kook)$" },
            ],
        });
    });

    test("treats empty filters as match-all and rejects unsupported editor expressions", () => {
        expect(compileEventFilter({})({})).toBe(true);
        expect(eventFiltersToEditor({ $nor: [{ type: "meta" }] })).toBeNull();
    });
});
