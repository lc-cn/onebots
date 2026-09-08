import fs from "node:fs";
import { assertManagerServiceRuntime } from "./manager-service-preflight.js";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { ConfigurationFile } from "./configuration/configuration-file.js";
import { readServiceMetadata } from "./service-metadata.js";
import { getServiceFiles } from "./service-files.js";
import { acquireServiceMigrationLock } from "./service-migration-lock.js";
import { FileServiceMigrationJournal } from "./service-migration-journal.js";
import {
    FileManagerServiceJournal,
    type ManagerServicePhase,
    type ManagerServiceRecord,
} from "./manager-service-journal.js";
import { renderInstalledManagerService } from "./manager-service-definition.js";
import { SystemdServicePlatform } from "./service-platform-systemd.js";
import { LaunchdServicePlatform } from "./service-platform-launchd.js";
import { inspectMigrationManager } from "./service-migration-manager.js";
import { verifyServiceMigrationProcesses } from "./service-migration-processes.js";
import { readServiceMigrationPending } from "./service-migration-workspace.js";
import { createDefaultServiceHost, type ServiceHost } from "./service-host.js";
import type { ServiceScope } from "./service-definition.js";
import type { ManagerServiceSpec } from "./manager-service-spec.js";
import type { ServicePlatform } from "./service-platform.js";

export type ManagerControlAction = "start" | "stop" | "restart";
export interface ManagerControllerDependencies {
    platform?(spec: ManagerServiceSpec): ServicePlatform;
    inspectManager?: typeof inspectMigrationManager;
    confirmStopped?: typeof verifyServiceMigrationProcesses;
    now?(): number;
    sleep?(milliseconds: number): Promise<void>;
    readinessTimeoutMs?: number;
}

/** 系统命令只控制manager，绝不修改gateway desired或预检业务配置。 */
export async function controlManagerService(
    action: ManagerControlAction,
    scope: ServiceScope,
    host: ServiceHost = createDefaultServiceHost(),
    dependencies: ManagerControllerDependencies = {},
): Promise<ManagerServiceRecord> {
    if (
        !["start", "stop", "restart"].includes(action) ||
        !["linux", "darwin"].includes(host.platform)
    )
        throw new Error("此系统或操作尚未通过管理服务控制验收");
    if (scope === "system" && host.uid !== 0) throw new Error("系统级服务需要管理员权限");
    const timeout = dependencies.readinessTimeoutMs ?? 120_000;
    if (!Number.isFinite(timeout) || timeout < 1 || timeout > 120_000)
        throw new Error("管理服务验收期限无效");
    const files = getServiceFiles(scope, host);
    const release = acquireServiceMigrationLock(files.stateDir);
    try {
        const metadata = readServiceMetadata(files.metadata);
        if (metadata.kind === "legacy") throw new Error("旧服务须先执行 onebots migrate");
        if (metadata.kind === "missing") throw new Error("尚未安装管理服务");
        if (metadata.kind !== "control" || metadata.spec.scope !== scope)
            throw new Error("服务元数据无效，禁止覆盖或猜测运行契约");
        const spec = metadata.spec;
        const migrationDirectory = path.join(files.stateDir, "migrations");
        if (
            exists(migrationDirectory) &&
            new FileServiceMigrationJournal(migrationDirectory).health().recoveryRequired
        )
            throw new Error("系统服务迁移尚待对账，禁止新的服务操作");
        if (readServiceMigrationPending(spec.workspace))
            throw new Error("系统服务迁移尚未确认，禁止新的服务操作");
        const journal = new FileManagerServiceJournal(
            path.join(files.stateDir, "manager-operations"),
        );
        if (journal.health().recoveryRequired) throw new Error("前次系统服务操作尚待对账");
        const confirmStopped = dependencies.confirmStopped ?? verifyServiceMigrationProcesses;
        const platform =
            dependencies.platform?.(spec) ??
            (host.platform === "linux"
                ? new SystemdServicePlatform(host, scope, files.definition)
                : new LaunchdServicePlatform(host, scope, files.definition, {
                      confirmUnloadedProcesses: () => confirmStopped(spec.workspace),
                  }));
        const inspect = dependencies.inspectManager ?? inspectMigrationManager;
        const definition = renderInstalledManagerService(spec, host.platform, files.stateDir);
        function unchanged() {
            const current = readServiceMetadata(files.metadata);
            if (
                current.kind !== "control" ||
                !isDeepStrictEqual(current.spec, spec) ||
                !new ConfigurationFile(files.definition)
                    .readRaw()
                    .bytes.equals(Buffer.from(definition))
            )
                throw new Error("管理服务定义已变化，禁止继续控制");
        }
        unchanged();
        if (action !== "stop") assertManagerServiceRuntime(spec, host);
        const initial = await platform.inspect();
        if (!["running", "stopped", "failed"].includes(initial.state))
            throw new Error("系统服务仍在转换状态，请稍后查询");
        const record = journal.prepare({
            id: randomUUID(),
            action,
            spec,
            desiredEnabled: initial.enabled,
        });
        function phase(value: ManagerServicePhase) {
            record.phase = value;
            journal.save(record);
        }
        async function quiet() {
            const state = await platform.inspect();
            return !state.running && state.quiescent && (await confirmStopped(spec.workspace));
        }
        const now = dependencies.now ?? Date.now;
        const sleep =
            dependencies.sleep ??
            (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
        async function ready(previousId?: string) {
            const deadline = now() + timeout;
            do {
                unchanged();
                try {
                    const first = await platform.inspect();
                    if (
                        first.running &&
                        first.state === "running" &&
                        first.enabled === initial.enabled
                    ) {
                        const manager = await inspect(spec.workspace);
                        const second = await platform.inspect();
                        if (
                            isDeepStrictEqual(first, second) &&
                            manager.manager.pid === first.processId &&
                            (!previousId || manager.manager.id !== previousId)
                        )
                            return true;
                    }
                } catch {
                    /* 只等待OS启动与本地接口就绪，不重发启动动作。 */
                }
                if (now() >= deadline) return false;
                await sleep(Math.min(250, deadline - now()));
            } while (now() < deadline);
            return false;
        }
        try {
            let previousId: string | undefined;
            if (action === "restart" && initial.running) {
                const manager = await inspect(spec.workspace);
                if (manager.manager.pid !== initial.processId) throw new Error("管理实例身份不符");
                previousId = manager.manager.id;
            }
            if (action !== "start" || initial.state === "failed") {
                unchanged();
                phase("stopping");
                await platform.quiesce();
                if (!(await quiet())) throw new Error("管理服务子进程尚未确认退出");
                unchanged();
                phase("restoring-enablement");
                await platform.reload(initial.enabled);
            }
            if (action !== "stop" && (action === "restart" || !initial.running)) {
                if (!(await quiet())) throw new Error("不能确认旧管理服务已退出");
                unchanged();
                phase("starting");
                await platform.start();
            }
            phase("verifying");
            unchanged();
            if (action === "stop") {
                const stopped = await platform.inspect();
                if (!(await quiet()) || stopped.enabled !== initial.enabled)
                    throw new Error("系统服务停止或启用状态未确认");
            } else if (!(await ready(previousId))) throw new Error("管理服务未通过就绪验收");
            record.phase = "completed";
            record.status = "succeeded";
            journal.save(record);
        } catch {
            // 结果未知不反向启停，不改变网关意图；完整契约留给本机对账。
            record.status = "interrupted";
            record.recoveryRequired = true;
            try {
                journal.save(record);
            } catch {
                /* 原有running意图仍会在冷读时阻止新的操作。 */
            }
        }
        return { ...record };
    } finally {
        release();
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
