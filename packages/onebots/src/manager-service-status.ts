import { managerUpgradeStatus } from "./service-upgrade-workspace.js";
import { ConfigurationFile } from "./configuration/configuration-file.js";
import { renderInstalledManagerService } from "./manager-service-definition.js";
import { isDeepStrictEqual } from "node:util";
import { readServiceMetadata } from "./service-metadata.js";
import { getServiceFiles } from "./service-files.js";
import { createDefaultServiceHost, type ServiceHost } from "./service-host.js";
import { SystemdServicePlatform } from "./service-platform-systemd.js";
import { LaunchdServicePlatform } from "./service-platform-launchd.js";
import { inspectMigrationManager } from "./service-migration-manager.js";
import {
    inspectServiceRecoveryDetails,
    type ServiceRecoveryDetails,
} from "./service-recovery-inspection.js";
import type { ServiceScope } from "./service-definition.js";
import type { ManagerServiceSpec } from "./manager-service-spec.js";
import type { ServicePlatform, ServicePlatformState } from "./service-platform.js";

export interface ManagerServiceStatus {
    schemaVersion: 1;
    scope: ServiceScope;
    installation: "missing" | "legacy" | "invalid" | "control";
    serviceRecoveryRequired: boolean;
    recovery: ServiceRecoveryDetails;
    manager: {
        state: ServicePlatformState["state"] | "unknown";
        enabled: boolean | null;
        loaded: boolean | null;
        pid: number | null;
        ipc: "not-queried" | "available" | "unavailable" | "mismatch";
    };
    gateway: {
        actual: "starting" | "running" | "stopping" | "stopped" | "failed" | "unknown";
        desired: "running" | "stopped" | "unknown";
        recoveryRequired: boolean | null;
        knownConfigurationFailure: boolean | null;
    };
    diagnostic:
        | "not-installed"
        | "migration-required"
        | "invalid-metadata"
        | "os-unavailable"
        | "ipc-unavailable"
        | "identity-mismatch"
        | "baseline-changed"
        | "definition-mismatch"
        | null;
}
export interface ManagerServiceStatusDependencies {
    platform?(spec: ManagerServiceSpec, definitionPath: string): Pick<ServicePlatform, "inspect">;
    inspectManager?: typeof inspectMigrationManager;
}

/** 纯观测：不读业务配置，不初始化操作日志/工作区，不调用服务控制或冷恢复。 */
export async function inspectManagerServiceStatus(
    scope: ServiceScope,
    host: ServiceHost = createDefaultServiceHost(),
    dependencies: ManagerServiceStatusDependencies = {},
): Promise<ManagerServiceStatus> {
    const result = await inspectManagerServiceStatusSnapshot(scope, host, dependencies);
    try {
        result.recovery = inspectServiceRecoveryDetails(getServiceFiles(scope, host).stateDir);
        result.serviceRecoveryRequired ||= result.recovery.serviceRecoveryRequired;
    } catch {
        result.serviceRecoveryRequired = true;
    }
    return result;
}
async function inspectManagerServiceStatusSnapshot(
    scope: ServiceScope,
    host: ServiceHost = createDefaultServiceHost(),
    dependencies: ManagerServiceStatusDependencies = {},
): Promise<ManagerServiceStatus> {
    const result: ManagerServiceStatus = {
        schemaVersion: 1,
        scope,
        installation: "invalid",
        serviceRecoveryRequired: false,
        recovery: {
            serviceRecoveryRequired: true,
            readable: false,
            truncated: false,
            operations: [],
        },
        manager: { state: "unknown", enabled: null, loaded: null, pid: null, ipc: "not-queried" },
        gateway: {
            actual: "unknown",
            desired: "unknown",
            recoveryRequired: null,
            knownConfigurationFailure: null,
        },
        diagnostic: "invalid-metadata",
    };
    if (!["user", "system"].includes(scope)) return result;
    let files: ReturnType<typeof getServiceFiles>;
    try {
        files = getServiceFiles(scope, host);
    } catch {
        return result;
    }
    const metadata = readServiceMetadata(files.metadata);
    result.installation = metadata.kind;
    if (metadata.kind !== "control") {
        result.diagnostic =
            metadata.kind === "missing"
                ? "not-installed"
                : metadata.kind === "legacy"
                  ? "migration-required"
                  : "invalid-metadata";
        return result;
    }
    if (metadata.spec.scope !== scope) {
        result.installation = "invalid";
        return result;
    }
    const spec = metadata.spec;
    const upgrade = managerUpgradeStatus(spec.workspace);
    result.serviceRecoveryRequired = upgrade.pending || upgrade.recoveryRequired;
    function definitionCurrent(): boolean {
        try {
            return new ConfigurationFile(files.definition)
                .readRaw()
                .bytes.equals(
                    Buffer.from(renderInstalledManagerService(spec, host.platform, files.stateDir)),
                );
        } catch {
            return false;
        }
    }
    if (!definitionCurrent()) {
        result.diagnostic = "definition-mismatch";
        return result;
    }
    let platform: Pick<ServicePlatform, "inspect">;
    let before: ServicePlatformState;
    try {
        platform =
            dependencies.platform?.(spec, files.definition) ??
            (host.platform === "linux"
                ? new SystemdServicePlatform(host, scope, files.definition)
                : host.platform === "darwin"
                  ? new LaunchdServicePlatform(host, scope, files.definition)
                  : (() => {
                        throw new Error();
                    })());
        before = await platform.inspect();
        if (before.definitionPath !== files.definition) throw new Error();
        result.manager = {
            state: before.state,
            enabled: before.enabled,
            loaded: before.loaded,
            pid: before.processId,
            ipc: "not-queried",
        };
        result.diagnostic = null;
    } catch {
        result.diagnostic = "os-unavailable";
        return result;
    }
    // 管理服务离线时不读旧gateway.json把历史状态伪装成实时状态。
    if (!before.running || before.state !== "running") {
        let stable = false;
        try {
            stable = isDeepStrictEqual(before, await platform.inspect());
        } catch {
            /* 无法确认二次OS观测时，返回未知而不是复用停止状态。 */
        }
        const current = readServiceMetadata(files.metadata);
        if (
            !stable ||
            !definitionCurrent() ||
            current.kind !== "control" ||
            !isDeepStrictEqual(current.spec, spec)
        ) {
            result.diagnostic = "baseline-changed";
            result.manager = {
                state: "unknown",
                enabled: null,
                loaded: null,
                pid: null,
                ipc: "not-queried",
            };
        }
        return result;
    }
    try {
        const manager = await (dependencies.inspectManager ?? inspectMigrationManager)(
            spec.workspace,
        );
        const after = await platform.inspect();
        const current = readServiceMetadata(files.metadata);
        if (
            !definitionCurrent() ||
            current.kind !== "control" ||
            !isDeepStrictEqual(current.spec, spec) ||
            !isDeepStrictEqual(before, after)
        ) {
            result.diagnostic = "baseline-changed";
            result.manager = {
                state: "unknown",
                enabled: null,
                loaded: null,
                pid: null,
                ipc: "mismatch",
            };
            return result;
        }
        if (before.processId === null || manager.manager.pid !== before.processId) {
            result.manager.ipc = "mismatch";
            result.diagnostic = "identity-mismatch";
            return result;
        }
        result.manager.ipc = "available";
        result.serviceRecoveryRequired =
            result.serviceRecoveryRequired ||
            manager.serviceMigration.pending ||
            manager.serviceMigration.recoveryRequired;
        result.gateway = {
            actual: manager.gateway.actual,
            desired: manager.gateway.desired,
            recoveryRequired: manager.gateway.recoveryRequired,
            knownConfigurationFailure: manager.knownConfigurationFailure,
        };
    } catch {
        result.manager.ipc = "unavailable";
        result.diagnostic = "ipc-unavailable";
    }
    return result;
}
