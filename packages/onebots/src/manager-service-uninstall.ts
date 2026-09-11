import { assertNoPendingManagerUpgrade } from "./service-upgrade-workspace.js";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readServiceMetadata } from "./service-metadata.js";
import { getServiceFiles } from "./service-files.js";
import { acquireServiceMigrationLock } from "./service-migration-lock.js";
import {
    FileManagerServiceJournal,
    type ManagerServicePhase,
    type ManagerServiceRecord,
} from "./manager-service-journal.js";
import { inspectServiceRecovery } from "./service-recovery-inspection.js";
import {
    captureManagerServiceRemoval,
    type ManagerServiceRemoval,
} from "./manager-service-removal.js";
import { createDefaultServiceHost, type ServiceHost } from "./service-host.js";
import { SystemdServicePlatform } from "./service-platform-systemd.js";
import { LaunchdServicePlatform } from "./service-platform-launchd.js";
import { assertServiceAbsent } from "./service-platform-presence.js";
import {
    verifyServiceMigrationProcesses,
    verifyServiceMigrationProcessesWhileLocked,
} from "./service-migration-processes.js";
import { readServiceMigrationPending } from "./service-migration-workspace.js";
import { acquireControlWorkspace } from "./control/workspace.js";
import type { ServiceScope } from "./service-definition.js";
import type { ServicePlatform } from "./service-platform.js";
import { assertManagerServiceTransactionsSupported } from "./windows-manager-support.js";
import {
    WindowsServicePlatform,
    unregisterWindowsManagerService,
    type WindowsServiceDefinition,
} from "./service-platform-windows.js";
import { ConfigurationFile } from "./configuration/configuration-file.js";
import { createControlOperationObserver } from "./control/gateway-log.js";
import type { PersistedOperationObserver } from "./persisted-operation-observer.js";

export interface ManagerServiceUninstallDependencies {
    platform?: ServicePlatform;
    unregister?(scope: ServiceScope, host: ServiceHost): Promise<void> | void;
    confirmStopped?: typeof verifyServiceMigrationProcessesWhileLocked;
    onOperation?: PersistedOperationObserver;
}

/** Windows 定义仍在时核验稳定停态；定义按事务删除后改由固定 SCM 身份证明缺失。 */
export async function confirmWindowsManagerStopped(
    platform: ServicePlatform,
    scope: ServiceScope,
    host: ServiceHost,
    definitionPath: string,
    assertAbsent: typeof assertServiceAbsent = assertServiceAbsent,
): Promise<boolean> {
    if (fsExists(definitionPath)) {
        const state = await platform.inspect();
        return (
            state.state === "stopped" &&
            !state.running &&
            state.quiescent &&
            state.processId === null &&
            state.definitionPath === definitionPath
        );
    }
    assertAbsent(scope, host);
    return true;
}

/** 定义已删除且完整进程树已退出后使用；不复用要求定义仍loaded的reload。 */
export function unregisterManagerService(scope: ServiceScope, host: ServiceHost): void {
    if (host.platform === "linux") {
        host.exec(
            "systemctl",
            [
                "--no-pager",
                "--no-ask-password",
                ...(scope === "user" ? ["--user"] : []),
                "daemon-reload",
            ],
            { timeoutMs: 5000 },
        );
    } else if (host.platform === "win32") {
        const files = getServiceFiles(scope, host);
        const definition = JSON.parse(
            new ConfigurationFile(files.definition).readRaw().bytes.toString("utf8"),
        ) as WindowsServiceDefinition;
        unregisterWindowsManagerService(host, definition);
        return;
    } else if (host.platform !== "darwin") throw new Error("此系统尚未通过管理服务卸载验收");
    assertServiceAbsent(scope, host);
}

/** 只卸载系统托管；不删除工作区，不恢复自动启动，不重建或回退未知文件。 */
export async function uninstallManagerService(
    scope: ServiceScope,
    host: ServiceHost = createDefaultServiceHost(),
    dependencies: ManagerServiceUninstallDependencies = {},
) {
    return uninstallManagerServiceImpl(scope, host, dependencies, false);
}

/** 迁移回退专用：调用方须持有对应 stateDir 的 service migration lock。 */
export async function uninstallManagerServiceWhileLocked(
    scope: ServiceScope,
    host: ServiceHost,
    operationId: string,
    dependencies: ManagerServiceUninstallDependencies = {},
): Promise<ManagerServiceRecord> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(operationId)) throw new Error("管理服务卸载操作 ID 无效");
    return uninstallManagerServiceImpl(scope, host, dependencies, true, operationId);
}

async function uninstallManagerServiceImpl(
    scope: ServiceScope,
    host: ServiceHost,
    dependencies: ManagerServiceUninstallDependencies,
    lockHeld: boolean,
    operationId?: string,
): Promise<ManagerServiceRecord> {
    assertManagerServiceTransactionsSupported(host);
    if (
        !["user", "system"].includes(scope) ||
        !["linux", "darwin", "win32"].includes(host.platform)
    )
        throw new Error("此系统或范围尚未通过管理服务卸载验收");
    if (
        (host.platform === "win32" && scope !== "system") ||
        (host.platform !== "win32" && scope === "system" && host.uid !== 0)
    )
        throw new Error("系统级服务需要管理员权限");
    const files = getServiceFiles(scope, host);
    const release = lockHeld ? () => undefined : acquireServiceMigrationLock(files.stateDir, host);
    let removal: ManagerServiceRemoval | undefined;
    let releaseWorkspace: (() => void) | undefined;
    try {
        if (inspectServiceRecovery(files.stateDir).serviceRecoveryRequired)
            throw new Error("前次系统服务操作尚待对账，禁止卸载");
        const metadata = readServiceMetadata(files.metadata);
        if (metadata.kind === "legacy") throw new Error("旧服务须先执行 onebots migrate");
        if (metadata.kind === "missing")
            throw new Error("未找到管理服务契约，不能仅凭文件缺失确认卸载");
        if (metadata.kind !== "control" || metadata.spec.scope !== scope)
            throw new Error("服务元数据无效，禁止卸载");
        const spec = metadata.spec;
        assertNoPendingManagerUpgrade(spec.workspace);
        if (readServiceMigrationPending(spec.workspace))
            throw new Error("工作区仍在迁移中，禁止卸载");
        const journal = new FileManagerServiceJournal(
            path.join(files.stateDir, "manager-operations"),
            dependencies.onOperation ?? createControlOperationObserver(spec.workspace),
        );
        if (journal.health().recoveryRequired) throw new Error("前次系统服务操作尚待对账");
        removal = captureManagerServiceRemoval(spec, host);
        const platform =
            dependencies.platform ??
            (host.platform === "linux"
                ? new SystemdServicePlatform(host, scope, files.definition)
                : host.platform === "darwin"
                  ? new LaunchdServicePlatform(host, scope, files.definition, {
                        confirmUnloadedProcesses: () =>
                            verifyServiceMigrationProcesses(spec.workspace),
                    })
                  : new WindowsServicePlatform(host, scope, files.definition));
        const initial = await platform.inspect();
        if (
            !["running", "stopped", "failed"].includes(initial.state) ||
            initial.definitionPath !== files.definition ||
            !removal.verifyRemaining()
        )
            throw new Error("系统服务状态或文件身份未确认，禁止卸载");
        const record = journal.prepare({
            id: operationId ?? randomUUID(),
            action: "uninstall",
            desiredEnabled: false,
            spec,
            removal: {
                platform:
                    host.platform === "linux"
                        ? "linux"
                        : host.platform === "darwin"
                          ? "darwin"
                          : "win32",
                files: removal.snapshot,
                initial: {
                    enabled: initial.enabled,
                    processId: initial.processId,
                    identity: initial.identity,
                },
            },
        });
        const confirmStopped =
            dependencies.confirmStopped ??
            (host.platform === "win32"
                ? async () =>
                      // 删除定义前由原生宿主核验 stopped；注销后定义已不存在，
                      // 只能从固定 SCM 身份证明 absent，不能再读取已删除定义。
                      confirmWindowsManagerStopped(platform, scope, host, files.definition)
                : verifyServiceMigrationProcessesWhileLocked);
        const definition =
            host.platform === "win32"
                ? (JSON.parse(
                      new ConfigurationFile(files.definition).readRaw().bytes.toString("utf8"),
                  ) as WindowsServiceDefinition)
                : undefined;
        const unregister =
            dependencies.unregister ??
            (host.platform === "win32"
                ? () => unregisterWindowsManagerService(host, definition!)
                : unregisterManagerService);
        const phase = (value: ManagerServicePhase) => {
            record.phase = value;
            journal.save(record);
        };
        try {
            phase("stopping");
            if (!removal.verifyRemaining()) throw new Error("服务文件已变化，禁止停机");
            await platform.quiesce();
            const stopped = await platform.inspect();
            if (
                stopped.state !== "stopped" ||
                stopped.running ||
                !stopped.quiescent ||
                stopped.enabled ||
                stopped.definitionPath !== files.definition
            )
                throw new Error("服务停机或自动启动禁用状态未确认");
            releaseWorkspace = acquireControlWorkspace(spec.workspace, host);
            if (!(await confirmStopped(spec.workspace)))
                throw new Error("工作区仍存在未确认退出的进程");
            phase("removing-definition");
            removal.removeDefinition();
            phase("unregistering");
            await unregister(scope, host);
            if (!(await confirmStopped(spec.workspace)) || !removal.verifyRemaining())
                throw new Error("注销后工作区或服务文件未确认");
            phase("removing-metadata");
            removal.removeMetadata();
            phase("verifying");
            assertServiceAbsent(scope, host);
            if (!removal.verifyRemaining() || !(await confirmStopped(spec.workspace)))
                throw new Error("卸载最终状态未确认");
            // 关闭身份锚点也必须在成功记录之前完成，异常仍归入本次操作的恢复门禁。
            removal.dispose();
            record.phase = "completed";
            record.status = "succeeded";
            journal.save(record);
        } catch {
            record.status = "interrupted";
            record.recoveryRequired = true;
            try {
                journal.save(record);
            } catch {
                /* 原意图保留；不反向安装或恢复自动启动。 */
            }
        }
        return { ...record };
    } finally {
        try {
            removal?.dispose();
        } finally {
            try {
                releaseWorkspace?.();
            } finally {
                release();
            }
        }
    }
}

function fsExists(file: string): boolean {
    try {
        fs.lstatSync(file);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
    }
}
