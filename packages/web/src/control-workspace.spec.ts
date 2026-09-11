import { describe, expect, it } from "vitest";
import { workspaceFromHash, workspaceHash } from "./control-workspace.js";

describe("控制台工作区导航", () => {
    it("只接受已知hash并为未知地址回到概览", () => {
        expect(workspaceFromHash("#configuration")).toBe("configuration");
        expect(workspaceFromHash("#terminal")).toBe("terminal");
        expect(workspaceFromHash("#unknown")).toBe("overview");
        expect(workspaceHash("activity")).toBe("#activity");
        expect(workspaceHash("terminal")).toBe("#terminal");
    });
});
