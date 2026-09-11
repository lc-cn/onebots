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
it.each([
    [true, "GET", true, 200],
    [false, "GET", true, 403],
    [true, "POST", true, 405],
    [true, "GET", false, 423],
] as const)(
    "候选身份通道 local=%s method=%s ownership=%s",
    async (local, method, ownershipAvailable, status) => {
        const identity = { managerId: "instance", candidateDigest: "a".repeat(64) };
        const upgradeIdentity = vi.fn(() => identity);
        const body = vi.fn();
        const result = await handleServiceMigrationRequest({
            workspace: "/nonexistent",
            pathname: "/api/control/service-upgrade/identity",
            ownershipAvailable,
            method,
            local,
            body,
            upgradeIdentity,
        });
        expect(result?.status).toBe(status);
        expect(upgradeIdentity).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
        expect(body).not.toHaveBeenCalled();
        if (status === 200) expect(result?.body).toEqual(identity);
    },
);
it("升级身份提供者失败不暴露底层错误", async () => {
    const result = await handleServiceMigrationRequest({
        workspace: "/nonexistent",
        pathname: "/api/control/service-upgrade/identity",
        ownershipAvailable: true,
        method: "GET",
        local: true,
        body: vi.fn(),
        upgradeIdentity: () => {
            throw new Error("private runtime path");
        },
    });
    expect(result?.status).toBe(409);
    expect(JSON.stringify(result)).not.toContain("private runtime path");
});
