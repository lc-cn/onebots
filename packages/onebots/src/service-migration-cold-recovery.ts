import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { acquireControlWorkspace } from "./control/workspace.js";
import { ServiceMigrationRollbackCoordinator } from "./service-migration-effect-proof.js";
import { FileServiceMigrationJournal } from "./service-migration-journal.js";
import { ServiceMigrationFiles } from "./service-migration-files.js";
import { createServiceMigrationFilePlan } from "./service-migration-file-plan.js";
import { verifyNeverStartedServiceMigrationProcessesWhileLocked } from "./service-migration-processes.js";
import {
    createServiceMigrationRollbackContract,
    digestServiceMigrationReloadOldReceipt,
    retainedRollbackFiles,
    verifyRetainedLegacyRuntime,
} from "./service-migration-retained-runtime.js";
import {
    blockServiceMigrationWorkspace,
    inspectServiceMigrationRollbackWorkspace,
} from "./service-migration-workspace.js";
import type { ServiceHost } from "./service-host.js";
import type { ServicePlatform, ServicePlatformState } from "./service-platform.js";
import type {
    ServiceMigrationBackup,
    ServiceMigrationPort,
    ServiceMigrationRecord,
    ServiceMigrationReloadOldReceipt,
} from "./service-migration-types.js";

const invalid = () => new Error("服务迁移冷回退状态无法核实");

export async function recoverInterruptedServiceMigrationV2(options: {
    journal: FileServiceMigrationJournal;
    record: ServiceMigrationRecord;
    backup: ServiceMigrationBackup;
    host: ServiceHost;
    platform: ServicePlatform;
}): Promise<ServiceMigrationRecord> {
    const { journal, backup, host, platform } = options;
    let record = options.record;
    if (
        record.schemaVersion !== 2 ||
        record.status !== "interrupted" ||
        !record.recoveryRequired ||
        record.rolledBack ||
        !backup.retainedRuntime
    )
        throw invalid();
    await verifyRetainedLegacyRuntime(backup.retainedRuntime);
    const files = new ServiceMigrationFiles(
        backup,
        createServiceMigrationFilePlan(backup, host).files,
        retainedRollbackFiles(backup, host),
    );
    const rollback = createServiceMigrationRollbackContract(backup, host);
    const definition = rollback.contract.files.find(
        file => file.state === "file" && file.role === "definition",
    );
    if (!definition) throw invalid();
    const loaded = host.platform === "linux";
    const workspace = backup.target.workspace;
    let reloadAuthorized = false;

    const stable = async () => {
        const first = await platform.inspect();
        const second = await platform.inspect();
        if (!isDeepStrictEqual(first, second)) throw invalid();
        return first;
    };
    const stopped = (state: ServicePlatformState, enabled?: boolean) =>
        state.state === "stopped" &&
        !state.running &&
        state.quiescent &&
        state.processId === null &&
        state.identity === null &&
        state.loaded === loaded &&
        state.definitionPath === definition.path &&
        (enabled === undefined || state.enabled === enabled);
    const desired = backup.previousRunning ? "running" : "stopped";
    const absentWorkspace = () => {
        try {
            fs.lstatSync(path.join(workspace, ".control"));
            return false;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw invalid();
            return true;
        }
    };
    const restoreTargetWhileLocked = async () => {
        const release = acquireControlWorkspace(workspace);
        try {
            let state = inspectServiceMigrationRollbackWorkspace(workspace, record.id, desired);
            if (
                !["pending", "blocked"].includes(state) ||
                !(await verifyNeverStartedServiceMigrationProcessesWhileLocked(
                    workspace,
                    record.id,
                    desired,
                )) ||
                !files.matchesTarget()
            )
                throw invalid();
            if (state === "pending") blockServiceMigrationWorkspace(workspace, record.id);
            state = inspectServiceMigrationRollbackWorkspace(workspace, record.id, desired);
            if (
                state !== "blocked" ||
                !(await verifyNeverStartedServiceMigrationProcessesWhileLocked(
                    workspace,
                    record.id,
                    desired,
                ))
            )
                throw invalid();
            const before = await stable();
            if (!stopped(before)) throw invalid();
            await platform.quiesce();
            if (!stopped(await stable(), false)) throw invalid();
            if (
                inspectServiceMigrationRollbackWorkspace(workspace, record.id, desired) !==
                    "blocked" ||
                !(await verifyNeverStartedServiceMigrationProcessesWhileLocked(
                    workspace,
                    record.id,
                    desired,
                ))
            )
                throw invalid();
            files.restore();
            if (!files.matchesRestored()) throw invalid();
        } finally {
            release();
        }
    };
    const validateReload = (receipt: ServiceMigrationReloadOldReceipt) => {
        if (
            receipt.backupDigest !== record.backupDigest ||
            receipt.rollbackContractDigest !== rollback.digest ||
            receipt.enabled !== backup.previousEnabled ||
            receipt.loaded !== loaded ||
            receipt.definitionPath !== definition.path
        )
            throw invalid();
        digestServiceMigrationReloadOldReceipt(receipt);
    };
    const effects: Pick<
        ServiceMigrationPort,
        "reloadOriginal" | "startOriginal" | "verifyRestored"
    > = {
        async reloadOriginal(_input, backupDigest) {
            if (
                !reloadAuthorized ||
                backupDigest !== record.backupDigest ||
                !files.matchesRestored()
            )
                throw invalid();
            reloadAuthorized = false;
            const before = await stable();
            if (!stopped(before, false)) throw invalid();
            const result = await platform.reload(backup.previousEnabled);
            const observed = await stable();
            if (!isDeepStrictEqual(result, observed) || !stopped(observed, backup.previousEnabled))
                throw invalid();
            return {
                schemaVersion: 1,
                backupDigest,
                rollbackContractDigest: rollback.digest,
                enabled: observed.enabled,
                loaded: observed.loaded,
                definitionPath: observed.definitionPath,
            };
        },
        async startOriginal(_input, receipt) {
            if (!receipt || !backup.previousRunning || !files.matchesRestored()) throw invalid();
            validateReload(receipt);
            const observed = await stable();
            if (!matchesRunning(observed, receipt)) throw invalid();
            return {
                schemaVersion: 1,
                reloadReceiptDigest: digestServiceMigrationReloadOldReceipt(receipt),
                processId: observed.processId!,
                identity: observed.identity!,
            };
        },
        async verifyRestored(_input, reloadReceipt, startReceipt) {
            if (!reloadReceipt || !files.matchesRestored()) return false;
            try {
                validateReload(reloadReceipt);
                const observed = await stable();
                return backup.previousRunning
                    ? Boolean(
                          startReceipt &&
                          matchesRunning(observed, reloadReceipt) &&
                          observed.processId === startReceipt.processId &&
                          observed.identity === startReceipt.identity &&
                          startReceipt.reloadReceiptDigest ===
                              digestServiceMigrationReloadOldReceipt(reloadReceipt),
                      )
                    : !startReceipt && matchesStopped(observed, reloadReceipt);
            } catch {
                return false;
            }
        },
    };
    const coordinator = new ServiceMigrationRollbackCoordinator(journal, effects, backup);

    if (["target-written", "stopping-target"].includes(record.phase)) {
        if (record.phase === "target-written")
            record = journal.transition(record, {
                type: "begin-rollback",
                origin: "target-written",
            });
        record = journal.transition(record, { type: "restoring" });
        await restoreTargetWhileLocked();
    }
    if (record.phase === "restoring") {
        if (!files.canRestore() || !stopped(await stable(), false)) throw invalid();
        if (record.rollbackOrigin === "target-written") {
            if (!files.matchesRestored()) await restoreTargetWhileLocked();
        } else if (record.rollbackOrigin !== "pre-target" || !absentWorkspace()) throw invalid();
        if (!files.matchesRestored()) files.restore();
        if (!files.matchesRestored()) throw invalid();
        record = journal.transition(record, { type: "reloading-old" });
        reloadAuthorized = true;
        record = await coordinator.reload(record);
    } else if (record.phase === "reloading-old") {
        // systemd停态不能证明daemon-reload已消费新定义；跨进程绝不重签或重派。
        throw invalid();
    }
    if (record.phase === "starting-old") record = await coordinator.start(record);
    if (record.phase !== "verifying-restored") throw invalid();
    return coordinator.complete(record);
}

function matchesRunning(
    state: ServicePlatformState,
    receipt: ServiceMigrationReloadOldReceipt,
): boolean {
    return (
        state.state === "running" &&
        state.running &&
        !state.quiescent &&
        state.loaded &&
        state.processId !== null &&
        state.identity !== null &&
        state.enabled === receipt.enabled &&
        state.definitionPath === receipt.definitionPath
    );
}
function matchesStopped(
    state: ServicePlatformState,
    receipt: ServiceMigrationReloadOldReceipt,
): boolean {
    return (
        state.state === "stopped" &&
        !state.running &&
        state.quiescent &&
        state.processId === null &&
        state.identity === null &&
        state.enabled === receipt.enabled &&
        state.loaded === receipt.loaded &&
        state.definitionPath === receipt.definitionPath
    );
}
