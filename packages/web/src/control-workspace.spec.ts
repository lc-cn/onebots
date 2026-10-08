import { describe, expect, it } from "vitest";
import {
    accountPageFromPath,
    accountPagePath,
    accountControlFromPath,
    accountControlPath,
    extensionCategoryFromPath,
    extensionWorkspacePath,
    protocolPageFromPath,
    protocolPagePath,
    workspaceFromPath,
    workspacePath,
    workspaceNavigation,
} from "./control-workspace.js";

describe("控制台 History 路由", () => {
    it("只接受已知工作区，导航使用真实路径", () => {
        expect(workspaceFromPath("/console/configuration")).toBe("overview");
        expect(workspaceFromPath("/console/accounts/mock/bot")).toBe("accounts");
        expect(workspaceFromPath("/console/protocols/mock/bot/onebot.v11")).toBe("protocols");
        expect(workspaceFromPath("/console/terminal")).toBe("terminal");
        expect(workspacePath("activity")).toBe("/console/activity");
        expect(workspaceNavigation.map(item => item.id)).not.toContain("configuration");
        expect(workspaceNavigation.map(item => item.id)).not.toContain("terminal");
    });
    it("扩展分类保留为查询参数", () => {
        expect(extensionCategoryFromPath("/console/extensions?type=protocol")).toBe("protocol");
        expect(extensionCategoryFromPath("/console/extensions?type=unknown")).toBe("platform");
        expect(extensionWorkspacePath("platform")).toBe("/console/extensions?type=platform");
        expect(extensionWorkspacePath("protocol")).toBe("/console/extensions?type=protocol");
    });
    it("账号列表、详情、编辑和控制页可直达并保留特殊 ID", () => {
        const route = { page: "detail" as const, platform: "mock", accountId: "user/a+b" };
        expect(accountPageFromPath(accountPagePath(route))).toEqual(route);
        expect(accountPagePath(route)).toBe("/console/accounts/mock/user%2Fa%2Bb");
        expect(accountPageFromPath(accountPagePath({ ...route, page: "edit" }))).toEqual({
            ...route,
            page: "edit",
        });
        expect(accountPageFromPath(accountPagePath({ page: "create", platform: "qq" }))).toEqual({
            page: "create",
            platform: "qq",
        });
        expect(accountControlFromPath(accountControlPath(route))).toEqual({
            platform: route.platform,
            accountId: route.accountId,
        });
        expect(accountPageFromPath("/console/accounts/mock")).toEqual({ page: "list" });
    });
    it("协议详情绑定账号与协议，且全局默认值有独立路径", () => {
        const route = {
            page: "detail" as const,
            platform: "qq",
            accountId: "a/b+1",
            protocolKey: "onebot.v11",
        };
        expect(protocolPageFromPath(protocolPagePath(route))).toEqual(route);
        expect(protocolPageFromPath(protocolPagePath({ ...route, page: "edit" }))).toEqual({
            ...route,
            page: "edit",
        });
        expect(
            protocolPageFromPath(protocolPagePath({ page: "create", protocolKey: "milky.v1" })),
        ).toEqual({
            page: "create",
            protocolKey: "milky.v1",
        });
        expect(
            protocolPageFromPath(
                protocolPagePath({ page: "create", protocolKey: "milky.v1", defaultScope: true }),
            ),
        ).toEqual({
            page: "create",
            protocolKey: "milky.v1",
            defaultScope: true,
        });
        expect(protocolPageFromPath("/console/protocols/qq/bot")).toEqual({ page: "list" });
    });
});
