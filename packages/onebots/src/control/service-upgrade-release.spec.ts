import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import type { ConfigurationTransactionPort } from "./generation-activation.js";
import type { GatewayOperation } from "./gateway-controller.js";
import { releaseManagerUpgrade } from "./service-upgrade-release.js";
import { managerUpgradeStatus, readManagerUpgradePending } from "../service-upgrade-workspace.js";
import { ConfigurationFile } from "../configuration/configuration-file.js";
const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture(desired: "running" | "stopped" = "running") {
    const workspace = fs.realpathSync(fs.mkdtempSync("/tmp/ob-release-"));
    roots.push(workspace);
    fs.mkdirSync(path.join(workspace, ".control"), { mode: 0o700 });
    const marker = {
        schemaVersion: 1 as const,
        operationId: "release",
        candidateDigest: "a".repeat(64),
    };
    const file = path.join(workspace, ".control/manager-upgrade-pending.json");
    fs.writeFileSync(file, JSON.stringify(marker), { mode: 0o600 });
    const managerId = randomUUID();
    const start = vi.fn(async () => {
        expect(readManagerUpgradePending(workspace)).toMatchObject({
            phase: "releasing",
            managerId,
        });
        expect(managerUpgradeStatus(workspace).pending).toBe(true);
        return { status: "succeeded" } as GatewayOperation;
    });
    const port: ConfigurationTransactionPort = {
        activeGenerationId: () => null,
        hasLiveChildren: () => false,
        gatewayStatus: () => ({ desired, recoveryRequired: false }),
        start,
        suspend: async () => {
            throw new Error("不得停止或回滚");
        },
    };
    const input = {
        workspace,
        managerId,
        body: {
            operationId: marker.operationId,
            candidateDigest: marker.candidateDigest,
            managerId,
        },
        lifecycle: {
            runConfigurationTransaction: async <T>(
                task: (port: ConfigurationTransactionPort) => Promise<T>,
            ) => task(port),
        },
        verifyCandidate: vi.fn(() => true),
        isAvailable: vi.fn(() => true),
    };
    return { input, start, file, marker, port };
}
it.each(["running", "stopped"] as const)(
    "确认%s意图前持久化释放决定，重复确认不重派",
    async desired => {
        const f = fixture(desired);
        await releaseManagerUpgrade(f.input);
        expect(managerUpgradeStatus(f.input.workspace)).toEqual({
            pending: false,
            recoveryRequired: false,
        });
        await releaseManagerUpgrade(f.input);
        expect(f.start).toHaveBeenCalledTimes(desired === "running" ? 1 : 0);
    },
);
it.each(["manager", "candidate", "operation", "live"])("%s不匹配在写入及启动前拒绝", async kind => {
    const f = fixture();
    if (kind === "manager") f.input.body.managerId = randomUUID();
    if (kind === "candidate") f.input.verifyCandidate.mockReturnValue(false);
    if (kind === "operation") f.input.body.operationId = "other";
    if (kind === "live") f.port.hasLiveChildren = () => true;
    await expect(releaseManagerUpgrade(f.input)).rejects.toThrow();
    expect(readManagerUpgradePending(f.input.workspace)).toEqual(f.marker);
    expect(f.start).not.toHaveBeenCalled();
});
it.each(["failure", "lost-result", "final-write"])(
    "%s保留releasing，冷打开也不重复启动",
    async kind => {
        const f = fixture();
        if (kind === "failure") f.start.mockResolvedValue({ status: "failed" } as GatewayOperation);
        if (kind === "lost-result") f.start.mockRejectedValue(new Error("unknown"));
        if (kind === "final-write") {
            const replace = ConfigurationFile.prototype.replaceRaw;
            vi.spyOn(ConfigurationFile.prototype, "replaceRaw").mockImplementation(
                function (revision, bytes) {
                    if (JSON.parse(Buffer.from(bytes).toString()).phase === "released")
                        throw new Error("disk");
                    return replace.call(this, revision, bytes);
                },
            );
        }
        await expect(releaseManagerUpgrade(f.input)).rejects.toThrow();
        expect(managerUpgradeStatus(f.input.workspace)).toEqual({
            pending: true,
            recoveryRequired: true,
        });
        await expect(releaseManagerUpgrade({ ...f.input })).rejects.toThrow("禁止重派");
        expect(f.start).toHaveBeenCalledTimes(1);
    },
);
it("写入释放意图失败时不启动", async () => {
    const f = fixture();
    vi.spyOn(ConfigurationFile.prototype, "replaceRaw").mockImplementation(() => {
        throw new Error("disk");
    });
    await expect(releaseManagerUpgrade(f.input)).rejects.toThrow();
    expect(f.start).not.toHaveBeenCalled();
});

it("关闭后才轮到确认的请求不能写入或重新启动", async () => {
    const f = fixture();
    const original = f.input.lifecycle.runConfigurationTransaction;
    f.input.lifecycle.runConfigurationTransaction = task => {
        f.input.isAvailable.mockReturnValue(false);
        return original(task);
    };
    await expect(releaseManagerUpgrade(f.input)).rejects.toThrow("正在关闭");
    expect(readManagerUpgradePending(f.input.workspace)).toEqual(f.marker);
    expect(f.start).not.toHaveBeenCalled();
});
it("已完成请求不因后来网关需要恢复而重入可写事务", async () => {
    const f = fixture();
    await releaseManagerUpgrade(f.input);
    f.input.lifecycle.runConfigurationTransaction = vi.fn(async () => {
        throw new Error("new recovery");
    });
    await releaseManagerUpgrade(f.input);
    expect(f.input.lifecycle.runConfigurationTransaction).not.toHaveBeenCalled();
    expect(f.start).toHaveBeenCalledTimes(1);
});
