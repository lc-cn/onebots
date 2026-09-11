import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { prepareManagerServiceInstallation } from "./manager-service-installation.js";
import { captureManagerServiceRemoval } from "./manager-service-removal.js";
import { FileManagerServiceJournal } from "./manager-service-journal.js";
import { writeManagerServiceUpgradeFiles } from "./manager-service-upgrade-files.js";
import { restorePreviousManagerServiceFiles } from "./manager-service-upgrade-rollback.js";
import { getServiceFiles } from "./service-files.js";
import type { ManagerServiceSpec } from "./manager-service-spec.js";
import type { ServiceHost } from "./service-host.js";
const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture(platform: "linux" | "darwin" = "linux") {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/ob-upgrade-files-"));
    roots.push(root);
    const host: ServiceHost = {
        platform,
        homedir: root,
        uid: process.getuid?.(),
        env: {},
        exec: vi.fn(() => {
            throw new Error("must not call OS");
        }),
        spawn: vi.fn(async () => {
            throw new Error("must not spawn");
        }),
    };
    const previous: ManagerServiceSpec = {
        schemaVersion: 1,
        runtimeKind: "control",
        scope: "user",
        workspace: path.join(root, "data"),
        workingDirectory: root,
        binPath: path.join(root, "old.js"),
        nodePath: process.execPath,
        host: "127.0.0.1",
        port: 6727,
    };
    fs.mkdirSync(previous.workspace, { mode: 0o700 });
    for (const file of ["config.yaml", "auth.json", "id_map.db"])
        fs.writeFileSync(path.join(previous.workspace, file), `original:${file}\r\n`);
    const installation = prepareManagerServiceInstallation(previous, host);
    try {
        installation.apply();
    } finally {
        installation.dispose();
    }
    const captured = captureManagerServiceRemoval(previous, host);
    const snapshot = structuredClone(captured.snapshot);
    captured.dispose();
    const journalDirectory = path.join(root, "journal");
    const journal = new FileManagerServiceJournal(journalDirectory);
    const record = journal.prepare({
        id: "upgrade",
        action: "upgrade",
        desiredEnabled: true,
        spec: { ...previous, binPath: path.join(root, "new.js") },
        upgrade: {
            previousSpec: previous,
            previousCandidateDigest: "a".repeat(64),
            candidateDigest: "b".repeat(64),
            snapshot: {
                platform,
                files: snapshot,
                initial: { enabled: true, processId: null, identity: null },
            },
        },
    });
    journal.save({ ...record, phase: "stopping" });
    journal.save({ ...record, phase: "writing" });
    return {
        host,
        root,
        previous,
        record: journal.read("upgrade"),
        journal,
        journalDirectory,
        files: getServiceFiles("user", host),
    };
}
it.each(["linux", "darwin"] as const)(
    "%s 真实文件仅切换管理契约，保留业务字节，拒绝重复派发",
    platform => {
        const f = fixture(platform);
        const snapshot = writeManagerServiceUpgradeFiles(f.record, f.host);
        expect(snapshot.definition.ino).not.toBe(f.record.upgrade!.snapshot.files.definition.ino);
        expect(JSON.parse(fs.readFileSync(f.files.metadata, "utf8"))).toEqual(f.record.managerSpec);
        for (const file of ["config.yaml", "auth.json", "id_map.db"])
            expect(fs.readFileSync(path.join(f.previous.workspace, file), "utf8")).toBe(
                `original:${file}\r\n`,
            );
        expect(() => writeManagerServiceUpgradeFiles(f.record, f.host)).toThrow();
        expect(f.host.exec).not.toHaveBeenCalled();
        expect(f.host.spawn).not.toHaveBeenCalled();
    },
);
it.each(["definition", "metadata"] as const)("原 %s 被同字节替换也拒绝切换", key => {
    const f = fixture();
    const bytes = fs.readFileSync(f.files[key]);
    const temporary = f.files[key] + ".replacement";
    fs.writeFileSync(temporary, bytes, { mode: 0o600 });
    fs.renameSync(temporary, f.files[key]);
    const before = fs.readFileSync(f.files.definition);
    expect(() => writeManagerServiceUpgradeFiles(f.record, f.host)).toThrow();
    expect(fs.readFileSync(f.files.definition)).toEqual(before);
});
it("第二文件替换失败保留半完成现场，不能以旧快照重派", () => {
    const f = fixture();
    const original = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
        if (String(to) === f.files.metadata) throw new Error("disk secret");
        original(from, to);
    });
    expect(() => writeManagerServiceUpgradeFiles(f.record, f.host)).toThrow("未确认");
    expect(fs.readFileSync(f.files.definition, "utf8")).toContain("new.js");
    expect(JSON.parse(fs.readFileSync(f.files.metadata, "utf8"))).toEqual(f.previous);
    vi.restoreAllMocks();
    expect(() => writeManagerServiceUpgradeFiles(f.record, f.host)).toThrow();
});
it("阶段间元数据身份变化阻止第二次写入", () => {
    const f = fixture();
    const original = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
        original(from, to);
        if (String(to) === f.files.definition) {
            const temporary = f.files.metadata + ".replacement";
            fs.writeFileSync(temporary, fs.readFileSync(f.files.metadata), { mode: 0o600 });
            original(temporary, f.files.metadata);
        }
    });
    expect(() => writeManagerServiceUpgradeFiles(f.record, f.host)).toThrow();
    expect(JSON.parse(fs.readFileSync(f.files.metadata, "utf8"))).toEqual(f.previous);
});

it("回退写完definition后中断，重入只补仍为target的metadata", () => {
    const f = fixture();
    writeManagerServiceUpgradeFiles(f.record, f.host);
    f.journal.save({ ...f.record, phase: "restoring-enablement" });
    const cold = new FileManagerServiceJournal(f.journalDirectory);
    let rollback = cold.read("upgrade");
    rollback = { ...rollback, phase: "rollback-stopping" };
    cold.save(rollback);
    rollback = { ...rollback, phase: "rollback-writing" };
    cold.save(rollback);
    const original = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
        if (String(to) === f.files.metadata) throw new Error("lost metadata write");
        original(from, to);
    });
    expect(() => restorePreviousManagerServiceFiles(rollback, f.host)).toThrow();
    expect(fs.readFileSync(f.files.definition, "utf8")).toContain("old.js");
    expect(fs.readFileSync(f.files.metadata, "utf8")).toContain("new.js");
    vi.restoreAllMocks();
    restorePreviousManagerServiceFiles(rollback, f.host);
    expect(JSON.parse(fs.readFileSync(f.files.metadata, "utf8"))).toEqual(f.previous);
    expect(fs.readFileSync(f.files.definition, "utf8")).toContain("old.js");
    expect(fs.statSync(f.files.definition).mode & 0o7777).toBe(
        rollback.upgrade!.snapshot.files.definition.mode,
    );
    for (const file of ["config.yaml", "auth.json", "id_map.db"])
        expect(fs.readFileSync(path.join(f.previous.workspace, file), "utf8")).toBe(
            `original:${file}\r\n`,
        );
});
