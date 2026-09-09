import { assertManagerServiceRuntime } from "./manager-service-preflight.js";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { bundledRuntimeArtifacts } from "./installation/bundled-runtime-artifacts.js";
import { prepareServiceMigrationManagerCandidate } from "./service-migration-manager-candidate.js";
import { acquireControlWorkspace } from "./control/workspace.js";
import { createDefaultServiceHost, type ServiceHost } from "./service-host.js";
import { getServiceFiles } from "./service-files.js";
import { parseManagerServiceSpec, type ManagerServiceSpec } from "./manager-service-spec.js";
import { captureServiceMigration } from "./service-migration-capture.js";
import { migrateSystemService } from "./service-migration-coordinator.js";
import { createServiceMigrationPort } from "./service-migration-port.js";
import { retainServiceMigrationRuntime } from "./service-migration-retention.js";
import { SystemdServicePlatform } from "./service-platform-systemd.js";
import { LaunchdServicePlatform } from "./service-platform-launchd.js";
import type { ServicePlatformState } from "./service-platform.js";

/** 实际旧服务迁移入口；保留旧工件、准备独立管理候选后切换，不更换业务工作区。 */
export async function migrateInstalledService(
    input: ManagerServiceSpec,
    host: ServiceHost = createDefaultServiceHost(),
) {
    const target = parseManagerServiceSpec(input);
    if (!["linux", "darwin"].includes(host.platform)) throw new Error("此系统尚未通过服务迁移验收");
    const paths = getServiceFiles(target.scope, host);
    const platform =
        host.platform === "linux"
            ? new SystemdServicePlatform(host, target.scope, paths.definition)
            : new LaunchdServicePlatform(host, target.scope, paths.definition);
    const id = randomUUID();
    let original: ServicePlatformState | undefined;
    let releaseArtifacts: (() => void) | undefined;
    try {
        return await migrateSystemService({
            stateDirectory: paths.stateDir,
            id,
            capture: async () => {
                // 新运行文件与Node版本先检查，不能等停掉旧服务后才发现缺失。
                assertManagerServiceRuntime(target, host);
                return captureServiceMigration(target, host, {
                    inspect: async () => {
                        const state = await platform.inspect();
                        original ??= structuredClone(state);
                        return state;
                    },
                });
            },
            retain: backup => retainServiceMigrationRuntime(backup, paths.stateDir, id),
            prepareManager: async backup => {
                const candidate = await prepareServiceMigrationManagerCandidate(
                    backup,
                    paths.stateDir,
                    id,
                    { artifacts: bundledRuntimeArtifacts() },
                );
                // 准备器已关闭安装进程；重新取得仓库锁后由协调器核验收据，保持到系统事务结束。
                releaseArtifacts = acquireControlWorkspace(
                    path.join(paths.stateDir, "manager-artifacts"),
                );
                return candidate;
            },
            port: backup => {
                if (!original) throw new Error("旧服务捕获未完成，禁止迁移");
                return createServiceMigrationPort({
                    backup,
                    host,
                    platform,
                    operationId: id,
                    originalState: original,
                });
            },
        });
    } finally {
        releaseArtifacts?.();
    }
}
