import fs from "node:fs";
import { ConfigurationFile } from "./configuration/configuration-file.js";
import { LegacyServiceInspection } from "./legacy-service-inspection.js";
import { parseLegacyServiceSpec } from "./service-metadata.js";
import { getServiceFiles } from "./service-files.js";
import { parseManagerServiceSpec, type ManagerServiceSpec } from "./manager-service-spec.js";
import { prepareServiceMigration } from "./service-migration-preparation.js";
import { createServiceMigrationFilePlan } from "./service-migration-file-plan.js";
import type { ServiceHost } from "./service-host.js";
import type { ServicePlatform, ServicePlatformState } from "./service-platform.js";
import type { ServiceMigrationBackup, ServiceMigrationFile } from "./service-migration-types.js";

/** 服务锁内只读捕获；返回值含旧凭据，仅可交给私有日志，不得直接输出给客户端。 */
export async function captureServiceMigration(
    input: ManagerServiceSpec,
    host: ServiceHost,
    platform: Pick<ServicePlatform, "inspect">,
): Promise<ServiceMigrationBackup> {
    try {
        if (!["linux", "darwin"].includes(host.platform)) throw new Error();
        const target = parseManagerServiceSpec(input);
        const paths = getServiceFiles(target.scope, host);
        // 在任何异步平台观测之前绑定旧元数据和定义，避免稍后捕获另一套配置。
        const baseline = [
            snapshot("definition", paths.definition),
            snapshot("metadata", paths.metadata),
        ];
        const controller = new LegacyServiceInspection(target.scope, host);
        const legacy = controller.readSpec();
        if (!legacy || !controller.definitionIsCurrent(legacy)) throw new Error();
        if (
            JSON.stringify(legacy) !==
            JSON.stringify(
                parseLegacyServiceSpec(
                    JSON.parse(Buffer.from(baseline[1].contentBase64, "base64").toString("utf8")),
                ),
            )
        )
            throw new Error();
        for (const file of baseline)
            if (JSON.stringify(snapshot(file.role, file.path)) !== JSON.stringify(file))
                throw new Error();
        const prepared = prepareServiceMigration(legacy, target);
        const files = [...baseline, snapshot("configuration", prepared.sourceConfigPath)];
        if (!Buffer.from(files[2].contentBase64, "base64").equals(prepared.originalBytes))
            throw new Error();
        const first = await platform.inspect();
        if (!stable(first) || first.definitionPath !== paths.definition) throw new Error();
        const second = await platform.inspect();
        if (!stable(second) || JSON.stringify(first) !== JSON.stringify(second)) throw new Error();
        // 观测期间文件也必须保持同一份内容/权限；不混用旧服务状态与新文件版本。
        for (const file of files)
            if (JSON.stringify(snapshot(file.role, file.path)) !== JSON.stringify(file))
                throw new Error();
        const backup: ServiceMigrationBackup = {
            schemaVersion: 1,
            target,
            previousRunning: first.state === "running",
            previousEnabled: first.enabled,
            files,
        };
        createServiceMigrationFilePlan(backup, host);
        return backup;
    } catch {
        throw new Error("旧系统服务无法安全捕获，请检查定义、配置与实际进程状态");
    }
}
function stable(state: ServicePlatformState): boolean {
    return state.state === "running"
        ? state.running && state.loaded && state.processId !== null && state.identity !== null
        : state.state === "stopped" && !state.running && state.quiescent;
}
function snapshot(role: ServiceMigrationFile["role"], file: string): ServiceMigrationFile {
    const before = fs.lstatSync(file);
    const raw = new ConfigurationFile(file).readRaw();
    const after = fs.lstatSync(file);
    if (
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.mode !== after.mode ||
        (after.mode & 0o7000) !== 0
    )
        throw new Error();
    return {
        role,
        path: file,
        mode: after.mode & 0o777,
        contentBase64: raw.bytes.toString("base64"),
    };
}
