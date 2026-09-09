import { assertNoPendingManagerUpgrade } from "./service-upgrade-workspace.js";
import fs from "node:fs";
import path from "node:path";
import { parseManagerServiceSpec, type ManagerServiceSpec } from "./manager-service-spec.js";
import { type ServiceHost } from "./service-host.js";
import { getServiceFiles } from "./service-files.js";
import { readServiceMetadata } from "./service-metadata.js";
import { assertManagerServiceRuntime } from "./manager-service-preflight.js";
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
import { assertManagerServiceTransactionsSupported } from "./windows-manager-support.js";
import { WindowsServicePlatform } from "./service-platform-windows.js";
import { secureWindowsServiceDirectory } from "./windows-service-security.js";

export interface ManagerServiceInstallDependencies {
    assertAbsent?: typeof assertServiceAbsent;
    platform?: ServicePlatform;
}

/** 内部 bootstrap 调用方须持服务锁；稳定 ID 贯穿候选准备和系统注册，绝不重派已有 ID。 */
export async function installManagerServiceWhileLocked(
    input: ManagerServiceSpec,
    operationId: string,
    host: ServiceHost,
    dependencies: ManagerServiceInstallDependencies = {},
) {
    if (typeof operationId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(operationId))
        throw new Error("管理服务安装操作 ID 无效");
    const spec = parseManagerServiceSpec(input);
    assertManagerServiceTransactionsSupported(host);
    if (!["linux", "darwin", "win32"].includes(host.platform))
        throw new Error("此系统尚未通过管理服务安装验收");
    if (
        (spec.scope !== "system" && host.platform === "win32") ||
        (spec.scope === "system" && host.platform !== "win32" && host.uid !== 0)
    )
        throw new Error("系统级服务需要管理员权限");
    const files = getServiceFiles(spec.scope, host);
    if (host.platform === "win32") secureWindowsServiceDirectory(host, files.stateDir);
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
            id: operationId,
            action: "install",
            desiredEnabled: true,
            spec,
        });
        const platform =
            dependencies.platform ??
            (host.platform === "linux"
                ? new SystemdServicePlatform(host, spec.scope, files.definition)
                : host.platform === "darwin"
                  ? new LaunchdServicePlatform(host, spec.scope, files.definition, {
                        freshDefinition: true,
                    })
                  : new WindowsServicePlatform(host, spec.scope, files.definition));
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
                    // Windows 的进程树身份由 SCM 宿主 Job Object 与受 ACL 保护的状态管道证明。
                    // 不写 POSIX PID 收据，避免把可复用 PID 当成 Windows 所有权依据。
                    if (host.platform !== "win32")
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
        installation?.dispose();
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
