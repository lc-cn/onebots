import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrateInstalledService } from "./service-migration.js";
import { SystemdServicePlatform } from "./service-platform-systemd.js";
import { LaunchdServicePlatform } from "./service-platform-launchd.js";
import { getServiceFiles } from "./service-files.js";
import { renderSystemdUnit, renderLaunchdPlist, type ServiceSpec } from "./service-definition.js";
import { verifyRetainedLegacyRuntime } from "./service-migration-retained-runtime.js";
import { cancelUnstartedServiceMigration } from "./service-migration-recovery.js";
import { rollbackStoppedServiceMigration } from "./service-migration-recovery.js";
import { inspectServiceMigrationRecovery } from "./service-recovery-inspection.js";
import { prepareServiceMigrationManagerCandidate } from "./service-migration-manager-candidate.js";
vi.mock("./service-migration-manager-candidate.js", () => ({
    prepareServiceMigrationManagerCandidate: vi.fn(),
}));
// 此入口套件注入候选准备/证明，真实下载与双证明由候选安装及产物套件验收。
vi.mock("./manager-service-upgrade-candidate.js", () => ({
    verifyManagerServiceCandidate: vi.fn(),
}));
import { readServiceMigrationPending } from "./service-migration-workspace.js";
import { verifyServiceMigrationProcesses } from "./service-migration-processes.js";
import { FileServiceMigrationJournal } from "./service-migration-journal.js";
import type { ServiceHost } from "./service-host.js";
import type { ServicePlatformState } from "./service-platform.js";
import type { ManagerServiceSpec } from "./manager-service-spec.js";
const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(prepareServiceMigrationManagerCandidate).mockReset();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture(previousRunning = false, stopInitiallyConfirmed = true) {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/migration-entry-"));
    roots.push(root);
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(workspace, { mode: 0o700 });
    const version = { text: "v24.0.0" };
    const osEffects: string[] = [];
    const host: ServiceHost = {
        platform: process.platform === "darwin" ? "darwin" : "linux",
        homedir: root,
        uid: process.getuid?.() ?? 1000,
        env: {},
        exec: (_file, args) => {
            if (args.length === 1 && args[0] === "--version") return version.text;
            throw new Error("unexpected OS command");
        },
        spawn: async () => {
            throw new Error("unexpected spawn");
        },
    };
    const files = getServiceFiles("user", host);
    const install = path.join(root, "install");
    const core = path.join(install, "node_modules", "@onebots", "core");
    fs.mkdirSync(core, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
        path.join(install, "package.json"),
        '{"name":"onebots","type":"module","dependencies":{"@onebots/core":"1.0.0"}}',
        { mode: 0o600 },
    );
    fs.writeFileSync(path.join(core, "package.json"), '{"name":"@onebots/core","type":"module"}', {
        mode: 0o600,
    });
    const bin = path.join(install, "bin.js");
    fs.writeFileSync(bin, "export {};\n", { mode: 0o600 });
    // 旧安装夹具拥有自己的受保护Node，不依赖CI工具缓存的可写权限约定。
    const legacyNode = path.join(root, "legacy-node");
    fs.copyFileSync(process.execPath, legacyNode, fs.constants.COPYFILE_FICLONE);
    fs.chmodSync(legacyNode, 0o700);
    const legacy: ServiceSpec = {
        scope: "user",
        configPath: path.join(workspace, "old.yaml"),
        adapters: [],
        protocols: [],
        applications: [],
        nodePath: legacyNode,
        binPath: bin,
        workingDirectory: workspace,
    };
    const definition =
        host.platform === "linux"
            ? renderSystemdUnit(legacy)
            : renderLaunchdPlist(
                  legacy,
                  path.join(files.stateDir, "onebots.log"),
                  path.join(files.stateDir, "onebots-error.log"),
              );
    const config = "general: {}\n";
    for (const [file, content] of [
        [files.definition, definition],
        [files.metadata, JSON.stringify(legacy)],
        [legacy.configPath, config],
    ]) {
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        fs.writeFileSync(file, content, { mode: 0o600 });
    }
    const unrelated = path.join(workspace, "unrelated-private.txt");
    fs.writeFileSync(unrelated, "synthetic-unrelated", { mode: 0o600 });
    const target: ManagerServiceSpec = {
        schemaVersion: 1,
        runtimeKind: "control",
        scope: "user",
        workspace,
        nodePath: process.execPath,
        binPath: bin,
        workingDirectory: workspace,
        host: "127.0.0.1",
        port: 6727,
    };
    vi.mocked(prepareServiceMigrationManagerCandidate).mockImplementation(
        async (backup, stateDirectory, id) => {
            expect(
                JSON.parse(
                    fs.readFileSync(
                        path.join(stateDirectory, "migrations", `${id}.journal.json`),
                        "utf8",
                    ),
                ).phase,
            ).toBe("preparing-manager");
            expect(osEffects).toEqual([]);
            const directory = path.join(stateDirectory, "manager-artifacts");
            fs.mkdirSync(directory, { mode: 0o700 });
            const candidateBin = path.join(directory, "candidate.js");
            fs.writeFileSync(candidateBin, "export {};", { mode: 0o600 });
            return {
                spec: { ...backup.target, binPath: candidateBin, workingDirectory: directory },
                digest: "a".repeat(64),
            };
        },
    );
    let state: ServicePlatformState = {
        state: previousRunning ? "running" : "stopped",
        running: previousRunning,
        enabled: true,
        loaded: true,
        definitionPath: files.definition,
        processId: previousRunning ? 4242 : null,
        identity: previousRunning ? "synthetic-old-instance" : null,
        quiescent: !previousRunning,
    };
    let stopConfirmed = stopInitiallyConfirmed;
    const prototype =
        host.platform === "linux"
            ? SystemdServicePlatform.prototype
            : LaunchdServicePlatform.prototype;
    const inspect = vi
        .spyOn(prototype, "inspect")
        .mockImplementation(async () => structuredClone(state));
    vi.spyOn(prototype, "quiesce").mockImplementation(async () => {
        osEffects.push("quiesce");
        state = {
            ...state,
            state: "stopped",
            running: false,
            enabled: false,
            processId: null,
            identity: null,
            quiescent: stopConfirmed,
        };
    });
    vi.spyOn(prototype, "reload").mockImplementation(async enabled => {
        osEffects.push("reload");
        state = { ...state, enabled };
    });
    const start = vi.spyOn(prototype, "start").mockImplementation(async () => {
        osEffects.push("start");
        if (!previousRunning) throw new Error("stopped service must never start");
        state = {
            ...state,
            state: "running",
            running: true,
            processId: 4343,
            identity: "synthetic-restored-instance",
            quiescent: false,
        };
    });
    return {
        root,
        target,
        host,
        files,
        legacy,
        definition,
        config,
        unrelated,
        version,
        osEffects,
        inspect,
        start,
        confirmStopped() {
            stopConfirmed = true;
            state = { ...state, quiescent: true };
        },
        setEnabled(enabled: boolean) {
            state = { ...state, enabled };
        },
    };
}
describe("installed service migration entry", () => {
    it.each(["missing-bin", "missing-node", "directory-bin", "old-node", "malformed-node"])(
        "%s fails before any platform mutation",
        async scenario => {
            const test = fixture();
            if (scenario === "missing-bin") fs.unlinkSync(test.target.binPath);
            if (scenario === "missing-node")
                test.target.nodePath = path.join(test.root, "absent-node");
            if (scenario === "directory-bin") {
                fs.unlinkSync(test.target.binPath);
                fs.mkdirSync(test.target.binPath);
            }
            if (scenario === "old-node") test.version.text = "v22.18.0";
            if (scenario === "malformed-node") test.version.text = "v24.0.0\nsynthetic-secret";
            await expect(migrateInstalledService(test.target, test.host)).rejects.toThrow(
                "目标管理程序或 Node.js 运行环境不可用",
            );
            expect(test.osEffects).toEqual([]);
            expect(test.inspect).not.toHaveBeenCalled();
            expect(test.start).not.toHaveBeenCalled();
            expect(fs.readFileSync(test.files.definition, "utf8")).toBe(test.definition);
            expect(fs.readFileSync(test.legacy.configPath, "utf8")).toBe(test.config);
            expect(fs.readFileSync(test.unrelated, "utf8")).toBe("synthetic-unrelated");
            expect(fs.existsSync(path.join(test.target.workspace, ".control"))).toBe(false);
        },
    );
    it.skipIf(process.platform === "win32")(
        "cold rollback restarts the retained legacy runtime after stop completed before target write",
        async () => {
            const test = fixture(true, false);
            const interrupted = await migrateInstalledService(test.target, test.host);
            expect(interrupted.recoveryRequired).toBe(true);
            expect(test.osEffects).toEqual(["quiesce"]);
            test.confirmStopped();
            const platform =
                test.host.platform === "linux"
                    ? new SystemdServicePlatform(test.host, "user", test.files.definition)
                    : new LaunchdServicePlatform(test.host, "user", test.files.definition);

            test.setEnabled(true);
            await expect(
                rollbackStoppedServiceMigration(interrupted.id, "user", test.host, platform),
            ).rejects.toThrow("目标尚未接管");
            expect(test.osEffects).toEqual(["quiesce"]);
            test.setEnabled(false);
            fs.mkdirSync(path.join(test.target.workspace, ".control"), { mode: 0o700 });
            await expect(
                rollbackStoppedServiceMigration(interrupted.id, "user", test.host, platform),
            ).rejects.toThrow("目标尚未接管");
            fs.rmdirSync(path.join(test.target.workspace, ".control"));

            fs.writeFileSync(test.legacy.configPath, "external-change\n");
            await expect(
                rollbackStoppedServiceMigration(interrupted.id, "user", test.host, platform),
            ).rejects.toThrow("目标尚未接管");
            expect(test.osEffects).toEqual(["quiesce"]);
            fs.writeFileSync(test.legacy.configPath, test.config);

            const restored = await rollbackStoppedServiceMigration(
                interrupted.id,
                "user",
                test.host,
                platform,
            );
            expect(restored).toMatchObject({
                phase: "completed",
                status: "failed",
                recoveryRequired: false,
                rolledBack: true,
            });
            expect(test.osEffects).toEqual(["quiesce", "reload", "start"]);
            expect(fs.readFileSync(test.legacy.configPath, "utf8")).toBe(test.config);
            expect(JSON.parse(fs.readFileSync(test.files.metadata, "utf8")).binPath).not.toBe(
                test.legacy.binPath,
            );
            expect(
                await rollbackStoppedServiceMigration(interrupted.id, "user", test.host, platform),
            ).toEqual(restored);
            expect(test.osEffects).toEqual(["quiesce", "reload", "start"]);
        },
        120_000,
    );
    it.skipIf(process.platform === "win32")(
        "migrates stopped legacy service through real capture/journal/file/ownership proof without starting it",
        async () => {
            const test = fixture();
            const result = await migrateInstalledService(test.target, test.host);
            expect(result).toMatchObject({
                status: "succeeded",
                phase: "completed",
                recoveryRequired: false,
            });
            expect(test.osEffects).toEqual(["quiesce", "reload"]);
            expect(test.start).not.toHaveBeenCalled();
            expect(readServiceMigrationPending(test.target.workspace)).toBeNull();
            const gateway = JSON.parse(
                fs.readFileSync(path.join(test.target.workspace, ".control/gateway.json"), "utf8"),
            );
            expect(gateway).toMatchObject({ desired: "stopped", actual: "stopped" });
            expect(await verifyServiceMigrationProcesses(test.target.workspace)).toBe(true);
            const journal = new FileServiceMigrationJournal(
                path.join(test.files.stateDir, "migrations"),
            );
            expect(journal.read(result.id)).toEqual(result);
            expect(journal.backup(result).previousRunning).toBe(false);
            const retained = journal.backup(result).retainedRuntime!;
            expect(journal.backup(result).targetCandidateDigest).toBe("a".repeat(64));
            expect(journal.backup(result).target.workingDirectory).not.toBe(
                test.legacy.workingDirectory,
            );
            expect(retained.schemaVersion).toBe(2);
            expect(retained.original).toEqual(test.legacy);
            expect(retained.rollback.configPath).toBe(test.legacy.configPath);
            await verifyRetainedLegacyRuntime(retained);
            expect(JSON.parse(fs.readFileSync(test.files.metadata, "utf8")).runtimeKind).toBe(
                "control",
            );
            expect(fs.readFileSync(test.legacy.configPath, "utf8")).toBe(test.config);
            expect(fs.readFileSync(test.unrelated, "utf8")).toBe("synthetic-unrelated");
        },
        120_000,
    );
    it.skipIf(process.platform === "win32")(
        "rejects candidate changes to the requested service contract before stopping",
        async () => {
            const test = fixture();
            const prepare = vi
                .mocked(prepareServiceMigrationManagerCandidate)
                .getMockImplementation()!;
            vi.mocked(prepareServiceMigrationManagerCandidate).mockImplementation(
                async (...args) => {
                    const candidate = await prepare(...args);
                    return { ...candidate, spec: { ...candidate.spec, port: 7001 } };
                },
            );
            const result = await migrateInstalledService(test.target, test.host);
            expect(result).toMatchObject({
                phase: "preparing-manager",
                status: "interrupted",
                recoveryRequired: true,
            });
            expect(test.osEffects).toEqual([]);
            const journal = new FileServiceMigrationJournal(
                path.join(test.files.stateDir, "migrations"),
            );
            expect(journal.backup(result).target).toEqual(test.target);
            expect(journal.backup(result).targetCandidateDigest).toBeUndefined();
            expect(journal.backup(result).retainedRuntime).toBeDefined();
            const cancelled = await cancelUnstartedServiceMigration(result.id, "user", test.host);
            expect(cancelled.phase).toBe("cancelled");
            expect(test.osEffects).toEqual([]);
        },
        120_000,
    );
    it("cannot stop or rewrite a service when its old runtime cannot be retained", async () => {
        const test = fixture();
        fs.rmSync(path.join(path.dirname(test.legacy.binPath), "node_modules"), {
            recursive: true,
        });
        const result = await migrateInstalledService(test.target, test.host);
        expect(result).toMatchObject({
            phase: "capturing-runtime",
            status: "interrupted",
            recoveryRequired: true,
            rolledBack: false,
        });
        expect(test.osEffects).toEqual([]);
        expect(fs.readFileSync(test.files.definition, "utf8")).toBe(test.definition);
        expect(fs.readFileSync(test.legacy.configPath, "utf8")).toBe(test.config);
        const journal = new FileServiceMigrationJournal(
            path.join(test.files.stateDir, "migrations"),
        );
        expect(journal.backup(result).retainedRuntime).toBeUndefined();
        await expect(migrateInstalledService(test.target, test.host)).rejects.toThrow();
        expect(test.osEffects).toEqual([]);
        expect(inspectServiceMigrationRecovery(test.files.stateDir)).toBe(true);
        const cancelled = await cancelUnstartedServiceMigration(result.id, "user", test.host);
        expect(cancelled).toMatchObject({
            phase: "cancelled",
            status: "failed",
            recoveryRequired: false,
            rolledBack: false,
        });
        expect(inspectServiceMigrationRecovery(test.files.stateDir)).toBe(false);
        expect(await cancelUnstartedServiceMigration(result.id, "user", test.host)).toEqual(
            cancelled,
        );
        expect(test.osEffects).toEqual([]);
        const next = await migrateInstalledService(test.target, test.host);
        expect(next.id).not.toBe(result.id);
        expect(next.phase).toBe("capturing-runtime");
        expect(journal.backup(cancelled)).toEqual(journal.backup(result));
    });
    it.each(["stopping-old", "configuration-drift"])(
        "rejects early cancellation after %s",
        async scenario => {
            const test = fixture(false, scenario !== "stopping-old");
            if (scenario === "configuration-drift") {
                fs.rmSync(path.join(path.dirname(test.legacy.binPath), "node_modules"), {
                    recursive: true,
                });
            }
            const record = await migrateInstalledService(test.target, test.host);
            const journal = new FileServiceMigrationJournal(
                path.join(test.files.stateDir, "migrations"),
            );
            expect(record.phase).toBe(
                scenario === "stopping-old" ? "stopping-old" : "capturing-runtime",
            );
            if (scenario === "configuration-drift")
                fs.appendFileSync(test.legacy.configPath, "# external edit\n");
            await expect(
                cancelUnstartedServiceMigration(record.id, "user", test.host),
            ).rejects.toThrow();
            expect(journal.read(record.id).recoveryRequired).toBe(true);
            expect(test.osEffects).toEqual(scenario === "stopping-old" ? ["quiesce"] : []);
        },
    );
    it("invalid existing definition refuses capture and leaves every non-target file unchanged", async () => {
        const test = fixture();
        fs.writeFileSync(test.files.definition, "foreign-service");
        await expect(migrateInstalledService(test.target, test.host)).rejects.toThrow(
            "旧系统服务无法安全捕获",
        );
        expect(test.osEffects).toEqual([]);
        expect(test.start).not.toHaveBeenCalled();
        expect(fs.readFileSync(test.files.definition, "utf8")).toBe("foreign-service");
        expect(fs.readFileSync(test.unrelated, "utf8")).toBe("synthetic-unrelated");
    });
});
