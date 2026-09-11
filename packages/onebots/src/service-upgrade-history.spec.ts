import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
    prepareManagerUpgradeWorkspace,
    readManagerUpgradeHistory,
    readManagerUpgradePending,
    advanceManagerUpgrade,
    completeRolledBackManagerUpgradeWhileLocked,
    managerUpgradeStatus,
} from "./service-upgrade-workspace.js";
import { ConfigurationFile } from "./configuration/configuration-file.js";
import { verifyServiceMigrationProcessesWhileLocked } from "./service-migration-processes.js";
vi.mock("./service-migration-processes.js", () => ({
    verifyServiceMigrationProcessesWhileLocked: vi.fn(async () => true),
}));
const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(verifyServiceMigrationProcessesWhileLocked).mockResolvedValue(true);
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/ob-upg-history-"));
    roots.push(root);
    fs.mkdirSync(path.join(root, ".control"), { mode: 0o700 });
    const current = path.join(root, ".control/manager-upgrade-pending.json");
    const original = {
        schemaVersion: 1,
        operationId: "first",
        candidateDigest: "a".repeat(64),
        phase: "released",
        managerId: "10000000-0000-4000-8000-000000000001",
    };
    const bytes = Buffer.from(JSON.stringify(original));
    fs.writeFileSync(current, bytes, { mode: 0o600 });
    const next = {
        schemaVersion: 1 as const,
        operationId: "second",
        candidateDigest: "b".repeat(64),
    };
    const history = path.join(root, ".control/manager-upgrade-history");
    return { root, current, original, bytes, next, history };
}
it("完成记录精确归档后才准备新升级，配置和认证不被改动", async () => {
    const f = fixture();
    for (const file of ["config.yaml", ".control/auth.json", "id_map.db"])
        fs.writeFileSync(path.join(f.root, file), "keep", { mode: 0o600 });
    await prepareManagerUpgradeWorkspace(f.root, f.next);
    expect(fs.readFileSync(path.join(f.history, "first.json"))).toEqual(f.bytes);
    expect(readManagerUpgradeHistory(f.root, "first")).toEqual(f.original);
    expect(readManagerUpgradePending(f.root)).toEqual(f.next);
    for (const file of ["config.yaml", ".control/auth.json", "id_map.db"])
        expect(fs.readFileSync(path.join(f.root, file), "utf8")).toBe("keep");
    await expect(prepareManagerUpgradeWorkspace(f.root, f.next)).rejects.toThrow();
});
it("归档后CAS失败保留旧完成状态，重试只复用相同归档", async () => {
    const f = fixture();
    const write = vi.spyOn(ConfigurationFile.prototype, "replaceRaw").mockImplementation(() => {
        throw new Error("disk");
    });
    await expect(prepareManagerUpgradeWorkspace(f.root, f.next)).rejects.toThrow();
    expect(fs.readFileSync(f.current)).toEqual(f.bytes);
    expect(fs.readFileSync(path.join(f.history, "first.json"))).toEqual(f.bytes);
    write.mockRestore();
    await prepareManagerUpgradeWorkspace(f.root, f.next);
    expect(readManagerUpgradePending(f.root)).toEqual(f.next);
});
it("历史操作ID不能用于第三次升级", async () => {
    const f = fixture();
    await prepareManagerUpgradeWorkspace(f.root, f.next);
    advanceManagerUpgrade(f.root, f.next, "releasing", f.original.managerId);
    advanceManagerUpgrade(
        f.root,
        readManagerUpgradePending(f.root)!,
        "released",
        f.original.managerId,
    );
    await expect(
        prepareManagerUpgradeWorkspace(f.root, { ...f.next, operationId: "first" }),
    ).rejects.toThrow();
    expect(readManagerUpgradePending(f.root)?.operationId).toBe("second");
});
it.each(["prepared", "releasing"])("%s不能被下一次升级覆盖", async phase => {
    const f = fixture();
    fs.writeFileSync(
        f.current,
        JSON.stringify({
            ...f.next,
            ...(phase === "releasing" ? { phase, managerId: f.original.managerId } : {}),
        }),
    );
    await expect(
        prepareManagerUpgradeWorkspace(f.root, { ...f.next, operationId: "third" }),
    ).rejects.toThrow();
    expect(fs.existsSync(f.history)).toBe(false);
});
it("旧进程退出未确认时不归档或更换标记", async () => {
    const f = fixture();
    vi.mocked(verifyServiceMigrationProcessesWhileLocked).mockResolvedValue(false);
    await expect(prepareManagerUpgradeWorkspace(f.root, f.next)).rejects.toThrow();
    expect(fs.existsSync(f.history)).toBe(false);
    expect(fs.readFileSync(f.current)).toEqual(f.bytes);
});
it.each(["mismatch", "partial", "symlink"])("%s归档阻止替换当前完成记录", async kind => {
    const f = fixture();
    fs.mkdirSync(f.history, { mode: 0o700 });
    const file = path.join(f.history, "first.json");
    if (kind === "symlink") fs.symlinkSync(f.current, file);
    else
        fs.writeFileSync(
            file,
            kind === "partial"
                ? "{"
                : JSON.stringify({ ...f.original, candidateDigest: "c".repeat(64) }),
            { mode: 0o600 },
        );
    await expect(prepareManagerUpgradeWorkspace(f.root, f.next)).rejects.toThrow();
    expect(fs.readFileSync(f.current)).toEqual(f.bytes);
});

it("替换已发生但结果未知时保留新门禁，不重派准备", async () => {
    const f = fixture();
    const replace = ConfigurationFile.prototype.replaceRaw;
    const write = vi
        .spyOn(ConfigurationFile.prototype, "replaceRaw")
        .mockImplementation(function (revision, bytes) {
            replace.call(this, revision, bytes);
            throw new Error("write outcome unknown");
        });
    await expect(prepareManagerUpgradeWorkspace(f.root, f.next)).rejects.toThrow();
    expect(readManagerUpgradePending(f.root)).toEqual(f.next);
    expect(readManagerUpgradeHistory(f.root, "first")).toEqual(f.original);
    await expect(prepareManagerUpgradeWorkspace(f.root, f.next)).rejects.toThrow();
    expect(write).toHaveBeenCalledTimes(1);
});

it("回退提交只接受原pending并可归档，重复CAS不会重写", async () => {
    const f = fixture();
    await prepareManagerUpgradeWorkspace(f.root, f.next);
    const expected = readManagerUpgradePending(f.root)!;
    completeRolledBackManagerUpgradeWhileLocked(f.root, expected);
    expect(readManagerUpgradePending(f.root)).toEqual({
        ...f.next,
        phase: "released",
        completion: "rollback",
    });
    expect(managerUpgradeStatus(f.root)).toEqual({ pending: false, recoveryRequired: false });
    expect(() => completeRolledBackManagerUpgradeWhileLocked(f.root, expected)).toThrow();
    await prepareManagerUpgradeWorkspace(f.root, {
        ...f.next,
        operationId: "third",
        candidateDigest: "c".repeat(64),
    });
    expect(readManagerUpgradeHistory(f.root, "second")?.completion).toBe("rollback");
});
