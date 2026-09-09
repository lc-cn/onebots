import { isDeepStrictEqual } from "node:util";
import { parseManagerServiceRecord, type ManagerServiceRecord, type ManagerServicePhase } from "./manager-service-journal.js";
import { canonicalServiceJson } from "./service-operation-storage.js";
import { verifyManagerServiceCandidate } from "./manager-service-upgrade-candidate.js";
import { captureManagerServiceRemoval } from "./manager-service-removal.js";
import { writeManagerServiceUpgradeFiles } from "./manager-service-upgrade-files.js";
import { releaseStoppedManagerServiceUpgrade } from "./manager-service-upgrade-offline.js";
import { getServiceFiles } from "./service-files.js";
import { assertNoPendingManagerUpgrade, prepareManagerUpgradeWorkspace, readManagerUpgradePending } from "./service-upgrade-workspace.js";
import { readServiceMigrationPending } from "./service-migration-workspace.js";
import { verifyServiceMigrationProcesses } from "./service-migration-processes.js";
import { inspectMigrationManager, inspectPrivateControlSocket, type MigrationManagerState } from "./service-migration-manager.js";
import { createLocalControlTransport } from "./client/local-control.js";
import { SystemdServicePlatform } from "./service-platform-systemd.js";
import { LaunchdServicePlatform } from "./service-platform-launchd.js";
import type { ServiceHost } from "./service-host.js";
import type { ServicePlatform } from "./service-platform.js";
import type { PersistedOperationObserver } from "./persisted-operation-observer.js";
import type { ManagerServiceRemovalSnapshot } from "./manager-service-removal-snapshot.js";
import type { ManagerServiceUpgradePort } from "./manager-service-upgrade-transaction.js";

export interface ManagerUpgradeNativeDependencies {
    platform?: ServicePlatform;
    readinessTimeoutMs?: number;
    inspectManager?: typeof inspectMigrationManager;
    confirmStopped?: typeof verifyServiceMigrationProcesses;
    /** 只观察 journal 已成功持久化的固定操作投影，不参与原生效果。 */
    onOperation?: PersistedOperationObserver;
}
const failure = () => new Error("管理程序升级现场与持久意图不符，禁止继续派发系统动作");

/**
 * 仅新事务使用。调用者须持服务锁和两份候选的存储锁，不能在 manager 自身进程执行。
 * 此对象绑定一个操作；冷启动只能走专用对账，不能从任意阶段重新构造后继续派发。
 */
export function createManagerServiceUpgradeNativePort(
    host: ServiceHost,
    dependencies: ManagerUpgradeNativeDependencies = {},
): ManagerServiceUpgradePort {
    const readinessTimeoutMs = dependencies.readinessTimeoutMs ?? 120_000;
    if (!Number.isSafeInteger(readinessTimeoutMs) || readinessTimeoutMs < 1 || readinessTimeoutMs > 120_000)
        throw failure();
    let running = true;
    let binding: string | undefined;
    let driver: ServicePlatform | undefined;
    let previousManagerId: string | undefined;
    let candidateManagerId: string | undefined;
    let written: ManagerServiceRemovalSnapshot | undefined;
    const inspect = dependencies.inspectManager ?? inspectMigrationManager;
    const confirm = dependencies.confirmStopped ?? verifyServiceMigrationProcesses;
    function record(input: ManagerServiceRecord, phase: ManagerServicePhase) {
        const value = parseManagerServiceRecord(input);
        if (value.action !== "upgrade" || !value.upgrade || value.phase !== phase ||
            value.status !== "running" || value.recoveryRequired ||
            value.upgrade.snapshot.platform !== host.platform ||
            (value.managerSpec.scope === "system" && host.uid !== 0)) throw failure();
        const identity = canonicalServiceJson({ id: value.id, spec: value.managerSpec,
            desiredEnabled: value.desiredEnabled, upgrade: value.upgrade });
        if (phase === "prepared" && binding === undefined) binding = identity;
        else if (binding !== identity) throw failure();
        return value as ManagerServiceRecord & { upgrade: NonNullable<ManagerServiceRecord["upgrade"]> };
    }
    function filesUnchanged(value: ManagerServiceRecord, target: boolean) {
        const upgrade = value.upgrade!;
        const captured = captureManagerServiceRemoval(target ? value.managerSpec : upgrade.previousSpec, host);
        try {
            if (!isDeepStrictEqual(captured.snapshot, target ? written : upgrade.snapshot.files) ||
                !captured.verifyRemaining()) throw failure();
        } finally { captured.dispose(); }
    }
    function candidate(value: ManagerServiceRecord, previous = false) {
        verifyManagerServiceCandidate(previous ? value.upgrade!.previousSpec : value.managerSpec,
            previous ? value.upgrade!.previousCandidateDigest : value.upgrade!.candidateDigest);
    }
    function maintenance(value: ManagerServiceRecord, released = false) {
        const marker = readManagerUpgradePending(value.managerSpec.workspace);
        if (!marker || marker.operationId !== value.id || marker.candidateDigest !== value.upgrade!.candidateDigest ||
            (released ? marker.phase !== "released" : marker.phase !== undefined) ||
            readServiceMigrationPending(value.managerSpec.workspace)) throw failure();
        return marker;
    }
    async function quiet(value: ManagerServiceRecord, enabled: boolean) {
        if (!driver) throw failure();
        const state = await driver.inspect();
        const files = getServiceFiles(value.managerSpec.scope, host);
        if (state.state !== "stopped" || state.running || !state.quiescent || state.processId !== null ||
            state.enabled !== enabled || state.definitionPath !== files.definition ||
            !(await confirm(value.managerSpec.workspace)) ||
            !isDeepStrictEqual(state, await driver.inspect())) throw failure();
    }
    async function currentManager(value: ManagerServiceRecord, released: boolean): Promise<MigrationManagerState> {
        if (!driver) throw failure();
        candidate(value); filesUnchanged(value, true);
        const before = await driver.inspect();
        const manager = await inspect(value.managerSpec.workspace);
        if (before.state !== "running" || !before.running || !before.identity || before.processId !== manager.manager.pid ||
            before.enabled !== value.desiredEnabled || !isDeepStrictEqual(before, await driver.inspect()) ||
            before.definitionPath !== getServiceFiles(value.managerSpec.scope, host).definition ||
            manager.manager.id === previousManagerId ||
            (candidateManagerId && manager.manager.id !== candidateManagerId) ||
            manager.serviceMigration.pending !== !released || manager.serviceMigration.recoveryRequired ||
            manager.gateway.recoveryRequired ||
            (!released && (manager.gateway.actual !== "stopped" || manager.gateway.instance)) ||
            (released && manager.gateway.actual !== manager.gateway.desired)) throw failure();
        return manager;
    }
    const port: ManagerServiceUpgradePort = {
        async verifyPrepared(input) {
            const value = record(input, "prepared"), spec = value.managerSpec;
            running = value.upgrade.snapshot.initial.processId !== null;
            candidate(value, true); candidate(value);
            const files = getServiceFiles(spec.scope, host);
            if (value.upgrade.snapshot.files.definition.path !== files.definition ||
                value.upgrade.snapshot.files.metadata.path !== files.metadata) throw failure();
            filesUnchanged(value, false);
            assertNoPendingManagerUpgrade(spec.workspace);
            if (readServiceMigrationPending(spec.workspace)) throw failure();
            driver = dependencies.platform ?? (host.platform === "linux"
                ? new SystemdServicePlatform(host, spec.scope, files.definition)
                : new LaunchdServicePlatform(host, spec.scope, files.definition, {
                    confirmUnloadedProcesses: () => confirm(spec.workspace),
                }));
            const before = await driver.inspect(), initial = value.upgrade.snapshot.initial;
            if (before.enabled !== initial.enabled || before.processId !== initial.processId ||
                before.identity !== initial.identity || before.definitionPath !== files.definition ||
                before.state !== (initial.processId === null ? "stopped" : "running") ||
                before.running !== (initial.processId !== null)) throw failure();
            if (before.running) {
                const manager = await inspect(spec.workspace);
                if (manager.manager.pid !== before.processId || manager.manager.pid === process.pid ||
                    manager.serviceMigration.pending || manager.serviceMigration.recoveryRequired) throw failure();
                previousManagerId = manager.manager.id;
            } else if (!before.quiescent || !(await confirm(spec.workspace))) throw failure();
            if (!isDeepStrictEqual(before, await driver.inspect())) throw failure();
            filesUnchanged(value, false);
        },
        async quiescePrevious(input) {
            const value = record(input, "stopping");
            if (!driver) throw failure();
            filesUnchanged(value, false); candidate(value, true); candidate(value);
            const before = await driver.inspect(), initial = value.upgrade.snapshot.initial;
            if (before.processId !== initial.processId || before.identity !== initial.identity ||
                before.enabled !== initial.enabled ||
                before.state !== (initial.processId === null ? "stopped" : "running") ||
                before.running !== (initial.processId !== null) ||
                before.definitionPath !== getServiceFiles(value.managerSpec.scope, host).definition) throw failure();
            await driver.quiesce();
            await quiet(value, false);
        },
        async prepareMaintenance(input) {
            const value = record(input, "writing");
            filesUnchanged(value, false); await quiet(value, false);
            await prepareManagerUpgradeWorkspace(value.managerSpec.workspace, {
                schemaVersion: 1, operationId: value.id, candidateDigest: value.upgrade.candidateDigest,
            });
        },
        async writeCandidate(input) {
            const value = record(input, "writing");
            maintenance(value); await quiet(value, false); candidate(value);
            written = writeManagerServiceUpgradeFiles(value, host);
        },
        async restoreEnablement(input) {
            const value = record(input, "restoring-enablement");
            maintenance(value); filesUnchanged(value, true); await quiet(value, false);
            await driver!.reload(value.desiredEnabled);
            await quiet(value, value.desiredEnabled);
        },
        async startCandidate(input) {
            const value = record(input, "starting");
            if (value.upgrade.snapshot.initial.processId === null) throw failure();
            maintenance(value); candidate(value); filesUnchanged(value, true);
            await quiet(value, value.desiredEnabled);
            await driver!.start();
        },
        async verifyCandidate(input) {
            const value = record(input, "verifying");
            maintenance(value);
            if (value.upgrade.snapshot.initial.processId === null) {
                candidate(value); filesUnchanged(value, true); await quiet(value, value.desiredEnabled); return;
            }
            const deadline = Date.now() + readinessTimeoutMs;
            do {
                try { candidateManagerId = (await currentManager(value, false)).manager.id; return; }
                catch { /* 只等待新实例就绪，不重发启动。 */ }
                if (Date.now() >= deadline) throw failure();
                await new Promise(resolve => setTimeout(resolve, 250));
            } while (true);
        },
        async releaseCandidate(input) {
            const value = record(input, "releasing");
            if (value.upgrade.snapshot.initial.processId === null) {
                filesUnchanged(value, true);
                await releaseStoppedManagerServiceUpgrade(value, host, driver); return;
            }
            if (!candidateManagerId) throw failure();
            await currentManager(value, false); maintenance(value);
            const socket = inspectPrivateControlSocket(value.managerSpec.workspace);
            const result: unknown = await createLocalControlTransport(value.managerSpec.workspace).request(
                "POST", "/api/control/service-upgrade/release", {
                    operationId: value.id, candidateDigest: value.upgrade.candidateDigest, managerId: candidateManagerId,
                });
            if (!isDeepStrictEqual(result, { released: true }) ||
                inspectPrivateControlSocket(value.managerSpec.workspace) !== socket) throw failure();
        },
        async verifyReleased(input) {
            const value = record(input, "releasing");
            const marker = maintenance(value, true);
            filesUnchanged(value, true);
            if (value.upgrade.snapshot.initial.processId === null) {
                await releaseStoppedManagerServiceUpgrade(value, host, driver); return;
            }
            if (!candidateManagerId || marker.managerId !== candidateManagerId || marker.completion) throw failure();
            await currentManager(value, true);
        },
    };
    const sequence: (keyof ManagerServiceUpgradePort)[] = [
        "verifyPrepared", "quiescePrevious", "prepareMaintenance", "writeCandidate",
        "restoreEnablement", "startCandidate", "verifyCandidate", "releaseCandidate", "verifyReleased",
    ];
    let next = 0;
    let failed = false;
    const call = async (name: keyof ManagerServiceUpgradePort, input: ManagerServiceRecord) => {
        if (!running && sequence[next] === "startCandidate") next++;
        if (failed || sequence[next] !== name) { failed = true; throw failure(); }
        next++; // 先消费步骤；即便外部效果未完成，也不能通过同一对象重派。
        try {
            await port[name](input);
        } catch (error) { failed = true; throw error; }
    };
    return {
        verifyPrepared: input => call("verifyPrepared", input),
        quiescePrevious: input => call("quiescePrevious", input),
        prepareMaintenance: input => call("prepareMaintenance", input),
        writeCandidate: input => call("writeCandidate", input),
        restoreEnablement: input => call("restoreEnablement", input),
        startCandidate: input => call("startCandidate", input),
        verifyCandidate: input => call("verifyCandidate", input),
        releaseCandidate: input => call("releaseCandidate", input),
        verifyReleased: input => call("verifyReleased", input),
    };
}
