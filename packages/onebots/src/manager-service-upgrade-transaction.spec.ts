import fs from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { FileManagerServiceJournal, type ManagerServicePreparation } from "./manager-service-journal.js";
import { runManagerServiceUpgrade, type ManagerServiceUpgradePort } from "./manager-service-upgrade-transaction.js";
const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const steps = ["verifyPrepared", "quiescePrevious", "prepareMaintenance", "writeCandidate",
    "restoreEnablement", "startCandidate", "verifyCandidate", "releaseCandidate", "verifyReleased"] as const;
function fixture(running = true) {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/ob-os-upgrade-")); roots.push(root);
    const spec = { schemaVersion: 1 as const, runtimeKind: "control" as const, scope: "user" as const,
        workspace: "/tmp/workspace", workingDirectory: "/tmp/new", nodePath: "/usr/local/bin/node",
        binPath: "/tmp/new/bin.js", host: "127.0.0.1", port: 6727 };
    const file = { sha256: "a".repeat(64), dev: "1", ino: "2", uid: 501, mode: 0o600,
        size: 10, ctimeNs: "1", mtimeNs: "1" };
    const preparation: ManagerServicePreparation = {
        id: "upgrade", action: "upgrade", desiredEnabled: true, spec,
        upgrade: { previousSpec: { ...spec, workingDirectory: "/tmp/old", binPath: "/tmp/old/bin.js" },
            previousCandidateDigest: "a".repeat(64), candidateDigest: "b".repeat(64),
            snapshot: { platform: "linux", files: {
                definition: { ...file, path: "/tmp/onebots.service" },
                metadata: { ...file, path: "/tmp/service.json", ino: "3" },
            }, initial: { enabled: true, processId: running ? 123 : null, identity: running ? "old-instance" : null } },
        },
    };
    const journal = new FileManagerServiceJournal(root);
    const calls: string[] = [];
    const phases: string[] = [];
    const invoke = async (name: string) => { calls.push(name); phases.push(journal.read("upgrade").phase); };
    const port: ManagerServiceUpgradePort = {
        verifyPrepared: () => invoke("verifyPrepared"), quiescePrevious: () => invoke("quiescePrevious"),
        prepareMaintenance: () => invoke("prepareMaintenance"), writeCandidate: () => invoke("writeCandidate"),
        restoreEnablement: () => invoke("restoreEnablement"), startCandidate: () => invoke("startCandidate"),
        verifyCandidate: () => invoke("verifyCandidate"), releaseCandidate: () => invoke("releaseCandidate"),
        verifyReleased: () => invoke("verifyReleased"),
    };
    return { root, preparation, journal, port, calls, phases };
}
it("每个外部效果前都有持久阶段，只有释放回执核验后才完成", async () => {
    const f = fixture();
    const result = await runManagerServiceUpgrade(f.preparation, f.journal, f.port);
    expect(f.calls).toEqual(steps);
    expect(f.phases).toEqual(["prepared", "stopping", "writing", "writing", "restoring-enablement",
        "starting", "verifying", "releasing", "releasing"]);
    expect(result).toMatchObject({ phase: "completed", status: "succeeded", recoveryRequired: false });
});
it("原停止意图不派发启动，仍要求维护门禁与离线释放证明", async () => {
    const f = fixture(false);
    await runManagerServiceUpgrade(f.preparation, f.journal, f.port);
    expect(f.calls).toEqual(steps.filter(step => step !== "startCandidate"));
});
it.each(steps)("%s 结果未知时停止派发，冷启动和原 ID 重试均不重放", async failed => {
    const f = fixture();
    f.port[failed] = async () => { f.calls.push(failed); throw new Error("unknown-effect secret"); };
    await expect(runManagerServiceUpgrade(f.preparation, f.journal, f.port)).rejects.toThrow("尚未确认");
    expect(f.calls).toEqual(steps.slice(0, steps.indexOf(failed) + 1));
    const cold = new FileManagerServiceJournal(f.root);
    expect(cold.recoverable("upgrade")).toMatchObject({ status: "interrupted", recoveryRequired: true });
    await expect(runManagerServiceUpgrade(f.preparation, cold, f.port)).rejects.toThrow();
    expect(f.calls).toHaveLength(steps.indexOf(failed) + 1);
});
it("阶段写入失败不派发对应效果，最后完成写入未知也不重派释放", async () => {
    for (const phase of ["stopping", "writing", "starting", "releasing", "completed"]) {
        const f = fixture();
        const original = f.journal.save.bind(f.journal);
        const spy = vi.spyOn(f.journal, "save").mockImplementation(record => {
            if (record.phase === phase && record.status !== "interrupted") throw new Error("disk");
            original(record);
        });
        await expect(runManagerServiceUpgrade(f.preparation, f.journal, f.port)).rejects.toThrow();
        expect(f.calls.filter(step => step === "releaseCandidate")).toHaveLength(phase === "completed" ? 1 : 0);
        expect(f.journal.health().recoveryRequired).toBe(true);
        spy.mockRestore();
    }
});
it("完成记录已写但回执丢失时保留完成阶段的中断证据，不释放第二次", async () => {
    const f = fixture();
    const original = f.journal.save.bind(f.journal);
    vi.spyOn(f.journal, "save").mockImplementation(record => {
        original(record);
        if (record.status === "succeeded") throw new Error("lost completion acknowledgement");
    });
    await expect(runManagerServiceUpgrade(f.preparation, f.journal, f.port)).rejects.toThrow();
    const cold = new FileManagerServiceJournal(f.root);
    expect(cold.read("upgrade")).toMatchObject({ phase: "completed", status: "interrupted", recoveryRequired: true });
    await expect(runManagerServiceUpgrade(f.preparation, cold, f.port)).rejects.toThrow();
    expect(f.calls.filter(step => step === "releaseCandidate")).toHaveLength(1);
});
