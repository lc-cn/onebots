import { describe, expect, it } from "vitest";
import { parseExtensionFilter } from "./extension-filter.js";

describe("extension route filter", () => {
    it("opens adapter and protocol installation links in the requested category", () => {
        expect(parseExtensionFilter("adapter")).toBe("adapter");
        expect(parseExtensionFilter("protocol")).toBe("protocol");
    });

    it("falls back to the complete catalog for missing, repeated, or unknown values", () => {
        expect(parseExtensionFilter(undefined)).toBe("all");
        expect(parseExtensionFilter(["protocol"])).toBe("all");
        expect(parseExtensionFilter("unknown")).toBe("all");
    });
});
