import { describe, expect, it } from "vitest";
import { serviceAncestorPaths } from "./service-path-ancestors.js";

describe("service path ancestor enumeration", () => {
    it("does not append a Windows drive name below its own root", () => {
        expect(serviceAncestorPaths("C:\\ProgramData\\OneBots", "win32")).toEqual([
            "C:\\ProgramData",
            "C:\\ProgramData\\OneBots",
        ]);
    });

    it("does not append a UNC server or share below the share root", () => {
        expect(serviceAncestorPaths("\\\\server\\share\\OneBots\\state", "win32")).toEqual([
            "\\\\server\\share\\OneBots",
            "\\\\server\\share\\OneBots\\state",
        ]);
    });
});
