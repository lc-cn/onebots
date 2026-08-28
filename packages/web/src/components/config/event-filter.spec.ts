import { describe, expect, test } from "vitest";
import { Protocol } from "@onebots/core";
import { editorToFilters, filtersToEditor } from "./event-filter.js";

describe("event filter editor", () => {
    test("serializes readable rules to the core filter language", () => {
        const filters = editorToFilters({
            match: "all",
            rules: [
                { path: "type", operator: "eq", value: "message" },
                { path: "message_type", operator: "in", value: ["group", "channel"] },
                { path: "raw_message", operator: "contains", value: "告警" },
                { path: "sender.id.string", operator: "neq", value: "blocked-user" },
            ],
        });

        const filter = Protocol.createFilter(filters);
        expect(filter({
            type: "message",
            message_type: "group",
            raw_message: "服务告警",
            sender: { id: { string: "allowed-user" } },
        })).toBe(true);
        expect(filter({
            type: "message",
            message_type: "private",
            raw_message: "服务告警",
            sender: { id: { string: "allowed-user" } },
        })).toBe(false);
    });

    test("round-trips visual rules and rejects unsupported advanced expressions", () => {
        const source = {
            $or: [
                { type: "request" },
                { platform: { $regex: "^(qq|kook)$" } },
            ],
        };
        expect(editorToFilters(filtersToEditor(source)!)).toEqual(source);
        expect(filtersToEditor({ $nor: [{ type: "meta" }] })).toBeNull();
    });
});
