import { assertManagerServiceRuntime } from "./manager-service-preflight.js";
import { randomUUID } from "node:crypto";
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

/** 实际旧服务迁移入口；不发布新依赖，不更换工作区，不代替冷中断对账。 */
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
    return migrateSystemService({
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
}
