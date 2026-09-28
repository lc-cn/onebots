import { describe, expect, it } from "vitest";
import {
    accountControlFromHash,
    accountControlHash,
    extensionCategoryFromHash,
    extensionWorkspaceHash,
    workspaceFromHash,
    workspaceHash,
    workspaceNavigation,
} from "./control-workspace.js";

describe("控制台工作区导航", () => {
    it("只接受已知hash并为未知地址回到概览", () => {
        expect(workspaceFromHash("#configuration")).toBe("overview");
        expect(workspaceFromHash("#accounts")).toBe("accounts");
        expect(workspaceFromHash("#protocols")).toBe("protocols");
        expect(workspaceFromHash("#terminal")).toBe("terminal");
        expect(workspaceFromHash("#unknown")).toBe("overview");
        expect(workspaceHash("activity")).toBe("#activity");
        expect(workspaceHash("terminal")).toBe("#terminal");
        expect(workspaceNavigation.map(item => item.id)).toContain("accounts");
        expect(workspaceNavigation.map(item => item.id)).toContain("protocols");
        expect(workspaceNavigation.map(item => item.id)).not.toContain("configuration");
        expect(workspaceNavigation.map(item => item.id)).not.toContain("terminal");
    });
    it("从 URL 读取扩展分类，并为平台和协议生成可分享入口", () => {
        expect(workspaceFromHash("#extensions?type=protocol")).toBe("extensions");
        expect(extensionCategoryFromHash("#extensions?type=protocol")).toBe("protocol");
        expect(extensionCategoryFromHash("#extensions?type=platform")).toBe("platform");
        expect(extensionCategoryFromHash("#extensions?type=unknown")).toBe("platform");
        expect(extensionWorkspaceHash("platform")).toBe("#extensions?type=platform");
        expect(extensionWorkspaceHash("protocol")).toBe("#extensions?type=protocol");
    });
    it("账号控制页可用 URL 直达并保留特殊账号 ID", () => {
        const hash = accountControlHash({ platform: "mock", accountId: "user/a+b" });
        expect(workspaceFromHash(hash)).toBe("accounts");
        expect(accountControlFromHash(hash)).toEqual({ platform: "mock", accountId: "user/a+b" });
        expect(accountControlFromHash("#accounts")).toBeUndefined();
    });
});
