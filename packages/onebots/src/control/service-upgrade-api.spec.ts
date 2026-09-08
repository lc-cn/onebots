import { expect, it, vi } from "vitest";
import { handleServiceMigrationRequest } from "./service-migration-api.js";
it.each([false, true])("升级确认仅允许本机，local=%s", async local => {
    const releaseUpgrade = vi.fn(async () => undefined);
    const result = await handleServiceMigrationRequest({
        workspace: "/nonexistent",
        ownershipAvailable: true,
        pathname: "/api/control/service-upgrade/release",
        method: "POST",
        local,
        body: async () => ({ managerId: "test" }),
        releaseUpgrade,
    });
    expect(result?.status).toBe(local ? 200 : 403);
    expect(releaseUpgrade).toHaveBeenCalledTimes(local ? 1 : 0);
});
it("历史所有权未知时，即使本机也不能确认", async () => {
    const releaseUpgrade = vi.fn();
    const result = await handleServiceMigrationRequest({
        workspace: "/nonexistent",
        ownershipAvailable: false,
        pathname: "/api/control/service-upgrade/release",
        method: "POST",
        local: true,
        body: async () => ({}),
        releaseUpgrade,
    });
    expect(result?.status).toBe(423);
    expect(releaseUpgrade).not.toHaveBeenCalled();
});
it("确认失败只返回固定对账错误", async () => {
    const result = await handleServiceMigrationRequest({
        workspace: "/nonexistent",
        ownershipAvailable: true,
        pathname: "/api/control/service-upgrade/release",
        method: "POST",
        local: true,
        body: async () => ({}),
        releaseUpgrade: async () => {
            throw new Error("private evidence");
        },
    });
    expect(result?.status).toBe(409);
    expect(JSON.stringify(result)).not.toContain("private evidence");
});
