import { isDeepStrictEqual } from "node:util";
import { parseManagerServiceRecord, type ManagerServiceRecord } from "./manager-service-journal.js";
import { verifyCompletedStoppedManagerServiceUpgrade } from "./manager-service-upgrade-offline.js";
import { verifyManagerServiceCandidate } from "./manager-service-upgrade-candidate.js";
import { captureManagerServiceRemoval } from "./manager-service-removal.js";
import { getServiceFiles } from "./service-files.js";
import { readManagerUpgradePending } from "./service-upgrade-workspace.js";
import { readServiceMigrationPending } from "./service-migration-workspace.js";
import { inspectMigrationManager, inspectPrivateControlSocket } from "./service-migration-manager.js";
import { createLocalControlTransport } from "./client/local-control.js";
import { closedServiceObject } from "./service-operation-storage.js";
import { SystemdServicePlatform } from "./service-platform-systemd.js";
import { LaunchdServicePlatform } from "./service-platform-launchd.js";
import type { ServiceHost } from "./service-host.js";
import type { ServicePlatform } from "./service-platform.js";
const failure = () => new Error("升级完成证据不足，保留恢复门禁；未重放系统动作");

/** 调用方持服务锁；只接受已释放的精确操作，不能把 prepared/releasing 门禁补成完成。 */
export async function verifyReleasedManagerServiceUpgrade(
    input: ManagerServiceRecord,
    host: ServiceHost,
    platform?: ServicePlatform,
): Promise<void> {
    const record = parseManagerServiceRecord(input);
    if (record.action !== "upgrade" || !record.upgrade ||
        !["releasing", "completed"].includes(record.phase) ||
        record.upgrade.snapshot.platform !== host.platform) throw failure();
    const spec = record.managerSpec;
    const files = getServiceFiles(spec.scope, host);
    if (record.upgrade.snapshot.files.definition.path !== files.definition ||
        record.upgrade.snapshot.files.metadata.path !== files.metadata ||
        readServiceMigrationPending(spec.workspace)) throw failure();
    const marker = readManagerUpgradePending(spec.workspace);
    if (!marker || marker.phase !== "released" || marker.operationId !== record.id ||
        marker.candidateDigest !== record.upgrade.candidateDigest) throw failure();
    if (record.upgrade.snapshot.initial.processId === null) {
        if (marker.completion !== "offline") throw failure();
        await verifyCompletedStoppedManagerServiceUpgrade(record, host, platform);
        return;
    }
    if (marker.completion || !marker.managerId) throw failure();
    verifyManagerServiceCandidate(spec, record.upgrade.candidateDigest);
    const captured = captureManagerServiceRemoval(spec, host);
    try {
        const driver = platform ?? (host.platform === "linux"
            ? new SystemdServicePlatform(host, spec.scope, files.definition)
            : new LaunchdServicePlatform(host, spec.scope, files.definition));
        const before = await driver.inspect();
        const socket = inspectPrivateControlSocket(spec.workspace);
        const manager = await inspectMigrationManager(spec.workspace);
        const identity = closedServiceObject(await createLocalControlTransport(spec.workspace).request<unknown>(
            "GET", "/api/control/service-upgrade/identity",
        ), ["managerId", "candidateDigest"]);
        if (before.state !== "running" || !before.running || !before.identity || before.processId !== manager.manager.pid ||
            before.enabled !== record.desiredEnabled || before.definitionPath !== files.definition ||
            manager.serviceMigration.pending || manager.serviceMigration.recoveryRequired ||
            manager.gateway.recoveryRequired || manager.gateway.actual !== manager.gateway.desired ||
            identity.managerId !== manager.manager.id || identity.candidateDigest !== record.upgrade.candidateDigest ||
            inspectPrivateControlSocket(spec.workspace) !== socket ||
            !isDeepStrictEqual(before, await driver.inspect()) || !captured.verifyRemaining() ||
            !isDeepStrictEqual(marker, readManagerUpgradePending(spec.workspace))) throw failure();
        verifyManagerServiceCandidate(spec, record.upgrade.candidateDigest);
    } finally { captured.dispose(); }
}
