import { assertNoPendingManagerUpgrade } from "./service-upgrade-workspace.js";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseManagerServiceSpec, type ManagerServiceSpec } from "./manager-service-spec.js";
import { createDefaultServiceHost, type ServiceHost } from "./service-host.js";
import { getServiceFiles } from "./service-files.js";
import { readServiceMetadata } from "./service-metadata.js";
import { assertManagerServiceRuntime } from "./manager-service-preflight.js";
import { acquireServiceMigrationLock } from "./service-migration-lock.js";
import { FileServiceMigrationJournal } from "./service-migration-journal.js";
import { FileManagerServiceJournal, type ManagerServicePhase } from "./manager-service-journal.js";
import {
    prepareManagerServiceInstallation,
    type ManagerServiceInstallation,
} from "./manager-service-installation.js";
import { assertServiceAbsent } from "./service-platform-presence.js";
import { SystemdServicePlatform } from "./service-platform-systemd.js";
import { LaunchdServicePlatform } from "./service-platform-launchd.js";
import {
    prepareServiceMigrationWorkspace,
    releaseServiceMigrationPending,
    readServiceMigrationPending,
} from "./service-migration-workspace.js";
import {
    prepareServiceProcessOwnershipSeed,
    verifyServiceMigrationProcesses,
} from "./service-migration-processes.js";
import { acquireControlWorkspace } from "./control/workspace.js";
import type { ServicePlatform } from "./service-platform.js";

/** 首次系统安装只启用托管定义，不启动manager，不写业务配置。 */
export async function installManagerService(
    input: ManagerServiceSpec,
    host: ServiceHost = createDefaultServiceHost(),
    dependencies: {
        assertAbsent?: typeof assertServiceAbsent;
        platform?: ServicePlatform;
    } = {},
) {
    const spec = parseManagerServiceSpec(input);
    if (!["linux", "darwin"].includes(host.platform))
        throw new Error("此系统尚未通过管理服务安装验收");
    if (spec.scope === "system" && host.uid !== 0) throw new Error("系统级服务需要管理员权限");
    const files = getServiceFiles(spec.scope, host);
    const release = acquireServiceMigrationLock(files.stateDir);
    let installation: ManagerServiceInstallation | undefined;
    try {
        const metadata = readServiceMetadata(files.metadata);
        if (metadata.kind === "legacy")
            throw new Error("旧服务须先执行 onebots migrate，禁止隐式覆盖");
        if (metadata.kind === "control")
            throw new Error("管理服务已安装，禁止用首次安装覆盖现有契约");
        if (metadata.kind !== "missing") throw new Error("服务元数据无效，禁止覆盖");
        const migrations = path.join(files.stateDir, "migrations");
        if (
            exists(migrations) &&
            new FileServiceMigrationJournal(migrations).health().recoveryRequired
        )
            throw new Error("旧服务迁移尚待对账，禁止新安装");
        const journal = new FileManagerServiceJournal(
            path.join(files.stateDir, "manager-operations"),
        );
        if (journal.health().recoveryRequired) throw new Error("前次系统服务操作尚待对账");
        assertNoPendingManagerUpgrade(spec.workspace);
        assertManagerServiceRuntime(spec, host);
        await (dependencies.assertAbsent ?? assertServiceAbsent)(spec.scope, host);
        const plan = prepareManagerServiceInstallation(spec, host);
        installation = plan;
        assertNoPendingManagerUpgrade(spec.workspace);
        if (readServiceMigrationPending(spec.workspace))
            throw new Error("目标工作区仍在服务迁移中，禁止首次安装");
        if (
            exists(path.join(spec.workspace, ".control")) &&
            !(await verifyServiceMigrationProcesses(spec.workspace))
        )
            throw new Error("已有工作区进程归属或退出状态未确认，禁止首次安装");
        const record = journal.prepare({
            id: randomUUID(),
            action: "install",
            desiredEnabled: true,
            spec,
        });
        const platform =
            dependencies.platform ??
            (host.platform === "linux"
                ? new SystemdServicePlatform(host, spec.scope, files.definition)
                : new LaunchdServicePlatform(host, spec.scope, files.definition, {
                      freshDefinition: true,
                  }));
        function phase(value: ManagerServicePhase) {
            record.phase = value;
            journal.save(record);
        }
        try {
            phase("writing");
            // 共用一次性工作区初始化与维护门禁；已有工作区不重置、不修改认证。
            const created = !exists(path.join(spec.workspace, ".control"));
            if (created) {
                prepareServiceMigrationWorkspace(spec.workspace, record.id, "running");
                const unlock = acquireControlWorkspace(spec.workspace);
                try {
                    prepareServiceProcessOwnershipSeed(spec.workspace);
                } finally {
                    unlock();
                }
            }
            plan.apply();
            phase("restoring-enablement");
            await plan.reload(platform, true);
            phase("verifying");
            if (!plan.verify()) throw new Error("新管理服务定义未通过验收");
            // 放开之后不可盲回退：另一个入口可能已开始使用新工作区。
            phase("releasing");
            if (created) {
                const unlock = acquireControlWorkspace(spec.workspace);
                try {
                    releaseServiceMigrationPending(spec.workspace, record.id);
                } finally {
                    unlock();
                }
            }
            record.phase = "completed";
            record.status = "succeeded";
            journal.save(record);
        } catch {
            record.status = "interrupted";
            record.recoveryRequired = true;
            try {
                journal.save(record);
            } catch {
                /* 原意图保留，冷读阻止重放；不删可能已使用的新定义/工作区。 */
            }
        }
        return { ...record };
    } finally {
        try {
            installation?.dispose();
        } finally {
            release();
        }
    }
}
function exists(file: string): boolean {
    try {
        fs.lstatSync(file);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
    }
}
