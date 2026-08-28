import { describe, expect, it } from "vitest";
import { requireNonEmptyStringParam, requirePositiveIntegerParam } from "./protocol-params.js";

describe("requirePositiveIntegerParam", () => {
    it("accepts positive safe integers and numeric strings", () => {
        expect(requirePositiveIntegerParam({ group_id: 123 }, "group_id")).toBe(123);
        expect(requirePositiveIntegerParam({ user_id: "456" }, "user_id")).toBe(456);
    });

    it.each([0, -1, 1.5, "", "abc", Number.MAX_SAFE_INTEGER + 1])(
        "rejects invalid IDs: %s",
        value => {
            expect(() => requirePositiveIntegerParam({ id: value }, "id")).toThrow(
                "id 必须是正整数",
            );
        },
    );
});

describe("requireNonEmptyStringParam", () => {
    it("accepts opaque request flags without changing them", () => {
        expect(requireNonEmptyStringParam({ flag: "opaque-request-flag" }, "flag")).toBe(
            "opaque-request-flag",
        );
    });

    it.each([undefined, null, "", "   ", 123])("rejects invalid flags: %s", value => {
        expect(() => requireNonEmptyStringParam({ flag: value }, "flag")).toThrow(
            "flag 必须是非空字符串",
        );
    });
});
