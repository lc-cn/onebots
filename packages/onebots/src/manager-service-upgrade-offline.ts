import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parseManagerServiceRecord, type ManagerServiceRecord } from "./manager-service-journal.js";
import { acquireControlWorkspace } from "./control/workspace.js";
import { captureManagerServiceRemoval } from "./manager-service-removal.js";
import { getServiceFiles } from "./service-files.js";
import { readServiceMigrationPending } from "./service-migration-workspace.js";
import { verifyServiceMigrationProcessesWhileLocked } from "./service-migration-processes.js";
import {
    completeStoppedManagerUpgradeWhileLocked,
    readManagerUpgradePending,
} from "./service-upgrade-workspace.js";
import { verifyManagerServiceCandidate } from "./manager-service-upgrade-candidate.js";
import { SystemdServicePlatform } from "./service-platform-systemd.js";
import { LaunchdServicePlatform } from "./service-platform-launchd.js";
import { WindowsServicePlatform } from "./service-platform-windows.js";
import type { ServiceHost } from "./service-host.js";
import type { ServicePlatform } from "./service-platform.js";
import { inspectWindowsServiceDirectorySecurity } from "./windows-service-security.js";

const failure = () => new Error("原停止服务的升级尚不能离线确认，未启动任何进程");

/** 调用方持服务和候选存储锁；只读 OS/工件，唯一写入是工作区完成回执。 */
async function inspectStoppedManagerServiceUpgrade(
    input: ManagerServiceRecord,
    host: ServiceHost,
    platform: ServicePlatform | undefined,
    complete: boolean,
): Promise<void> {
    const record = parseManagerServiceRecord(input);
    if (
        record.action !== "upgrade" ||
        !record.upgrade ||
        (complete
            ? record.phase !== "releasing"
            : !["releasing", "completed"].includes(record.phase)) ||
        record.upgrade.snapshot.initial.processId !== null ||
        record.upgrade.snapshot.platform !== host.platform ||
        !(complete ? ["running", "interrupted"] : ["running", "interrupted", "succeeded"]).includes(
            record.status,
        )
    )
        throw failure();
    const spec = record.managerSpec;
    if (
        host.platform === "win32"
            ? spec.scope !== "system" || host.isElevated !== true
            : spec.scope === "system" && host.uid !== 0
    )
        throw failure();
    for (const directory of [spec.workspace, path.join(spec.workspace, ".control")]) {
        const stat = fs.lstatSync(directory);
        if (
            !stat.isDirectory() ||
            stat.isSymbolicLink() ||
            (host.platform !== "win32" && stat.uid !== process.getuid?.()) ||
            (host.platform !== "win32" &&
                (stat.mode & (directory === spec.workspace ? 0o022 : 0o077)) !== 0)
        )
            throw failure();
        if (host.platform === "win32") inspectWindowsServiceDirectorySecurity(host, directory);
    }
    const files = getServiceFiles(spec.scope, host);
    if (
        record.upgrade.snapshot.files.definition.path !== files.definition ||
        record.upgrade.snapshot.files.metadata.path !== files.metadata ||
        fs.realpathSync(spec.workspace) !== spec.workspace
    )
        throw failure();
    const unlock = acquireControlWorkspace(spec.workspace, host);
    try {
        const inspectCandidate = () =>
            verifyManagerServiceCandidate(spec, record.upgrade!.candidateDigest);
        inspectCandidate();
        const captured = captureManagerServiceRemoval(spec, host);
        try {
            const driver =
                platform ??
                (host.platform === "linux"
                    ? new SystemdServicePlatform(host, spec.scope, files.definition)
                    : host.platform === "darwin"
                      ? new LaunchdServicePlatform(host, spec.scope, files.definition, {
                            confirmUnloadedProcesses: () =>
                                verifyServiceMigrationProcessesWhileLocked(spec.workspace),
                        })
                      : new WindowsServicePlatform(host, spec.scope, files.definition));
            const first = await driver.inspect();
            if (
                first.state !== "stopped" ||
                first.running ||
                !first.quiescent ||
                first.processId !== null ||
                first.enabled !== record.desiredEnabled ||
                first.definitionPath !== files.definition ||
                (host.platform !== "win32" &&
                    !(await verifyServiceMigrationProcessesWhileLocked(spec.workspace)))
            )
                throw failure();
            const marker = readManagerUpgradePending(spec.workspace);
            if (
                !marker ||
                (!complete && marker.phase !== "released") ||
                marker.operationId !== record.id ||
                marker.candidateDigest !== record.upgrade.candidateDigest ||
                (marker.phase &&
                    !(marker.phase === "released" && marker.completion === "offline")) ||
                readServiceMigrationPending(spec.workspace)
            )
                throw failure();
            inspectCandidate();
            if (!isDeepStrictEqual(first, await driver.inspect()) || !captured.verifyRemaining())
                throw failure();
            if (!marker.phase) completeStoppedManagerUpgradeWhileLocked(spec.workspace, marker);
        } finally {
            captured.dispose();
        }
    } finally {
        unlock();
    }
}

/** 仅新升级派发阶段可写入离线完成回执。 */
export function releaseStoppedManagerServiceUpgrade(
    record: ManagerServiceRecord,
    host: ServiceHost,
    platform?: ServicePlatform,
): Promise<void> {
    return inspectStoppedManagerServiceUpgrade(record, host, platform, true);
}

/** 冷对账只验证已存在的离线完成证据，绝不补写释放回执。 */
export function verifyCompletedStoppedManagerServiceUpgrade(
    record: ManagerServiceRecord,
    host: ServiceHost,
    platform?: ServicePlatform,
): Promise<void> {
    return inspectStoppedManagerServiceUpgrade(record, host, platform, false);
}
