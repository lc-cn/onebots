import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { parseManagerServiceRecord, type ManagerServiceRecord } from "./manager-service-journal.js";
import { acquireControlWorkspace } from "./control/workspace.js";
import { captureManagerServiceRemoval } from "./manager-service-removal.js";
import { getServiceFiles } from "./service-files.js";
import { readServiceMigrationPending } from "./service-migration-workspace.js";
import { verifyServiceMigrationProcessesWhileLocked } from "./service-migration-processes.js";
import { completeStoppedManagerUpgradeWhileLocked, readManagerUpgradePending } from "./service-upgrade-workspace.js";
import { readRunningManagerCandidate, managerCandidateDigest } from "./manager-runtime/identity.js";
import { SystemdServicePlatform } from "./service-platform-systemd.js";
import { LaunchdServicePlatform } from "./service-platform-launchd.js";
import type { ServiceHost } from "./service-host.js";
import type { ServicePlatform } from "./service-platform.js";

const failure = () => new Error("原停止服务的升级尚不能离线确认，未启动任何进程");

/** 调用方持服务和候选存储锁；只读 OS/工件，唯一写入是工作区完成回执。 */
export async function releaseStoppedManagerServiceUpgrade(
    input: ManagerServiceRecord,
    host: ServiceHost,
    platform?: ServicePlatform,
): Promise<void> {
    const record = parseManagerServiceRecord(input);
    if (record.action !== "upgrade" || !record.upgrade || record.phase !== "releasing" ||
        record.upgrade.snapshot.initial.processId !== null ||
        record.upgrade.snapshot.platform !== host.platform ||
        !["running", "interrupted"].includes(record.status)) throw failure();
    const spec = record.managerSpec;
    if (spec.scope === "system" && host.uid !== 0) throw failure();
    for (const directory of [spec.workspace, path.join(spec.workspace, ".control")]) {
        const stat = fs.lstatSync(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() ||
            (stat.mode & (directory === spec.workspace ? 0o022 : 0o077)) !== 0) throw failure();
    }
    const files = getServiceFiles(spec.scope, host);
    if (record.upgrade.snapshot.files.definition.path !== files.definition ||
        record.upgrade.snapshot.files.metadata.path !== files.metadata ||
        fs.realpathSync(spec.workspace) !== spec.workspace) throw failure();
    const unlock = acquireControlWorkspace(spec.workspace);
    try {
        const inspectCandidate = () => {
            const candidate = readRunningManagerCandidate(pathToFileURL(
                path.join(path.dirname(spec.binPath), "control/host.js"),
            ).href);
            if (managerCandidateDigest(candidate) !== record.upgrade!.candidateDigest ||
                candidate.management.checks.authenticationV2 !== true ||
                fs.realpathSync(spec.workingDirectory) !== candidate.directory ||
                fs.realpathSync(spec.binPath) !== fs.realpathSync(path.join(candidate.directory, "node_modules/onebots/lib/bin.js")) ||
                fs.realpathSync(spec.nodePath) !== fs.realpathSync(process.execPath)) throw failure();
        };
        inspectCandidate();
        const captured = captureManagerServiceRemoval(spec, host);
        try {
            const driver = platform ?? (host.platform === "linux"
                ? new SystemdServicePlatform(host, spec.scope, files.definition)
                : new LaunchdServicePlatform(host, spec.scope, files.definition, {
                    confirmUnloadedProcesses: () => verifyServiceMigrationProcessesWhileLocked(spec.workspace),
                }));
            const first = await driver.inspect();
            if (first.state !== "stopped" || first.running || !first.quiescent ||
                first.processId !== null ||
                first.enabled !== record.desiredEnabled || first.definitionPath !== files.definition ||
                !(await verifyServiceMigrationProcessesWhileLocked(spec.workspace))) throw failure();
            const marker = readManagerUpgradePending(spec.workspace);
            if (!marker || marker.operationId !== record.id ||
                marker.candidateDigest !== record.upgrade.candidateDigest ||
                (marker.phase && !(marker.phase === "released" && marker.completion === "offline")) ||
                readServiceMigrationPending(spec.workspace)) throw failure();
            inspectCandidate();
            if (!isDeepStrictEqual(first, await driver.inspect()) || !captured.verifyRemaining()) throw failure();
            if (!marker.phase) completeStoppedManagerUpgradeWhileLocked(spec.workspace, marker);
        } finally { captured.dispose(); }
    } finally { unlock(); }
}
