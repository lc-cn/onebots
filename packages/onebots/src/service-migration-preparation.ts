import fs from "node:fs";
import path from "node:path";
import type { ServiceSpec } from "./service-definition.js";
import { parseManagerServiceSpec, type ManagerServiceSpec } from "./manager-service-spec.js";
import { ConfigurationFile } from "./configuration/configuration-file.js";
import { createServiceMigrationConfig } from "./service-migration-config.js";

/** 私有迁移准备结果含配置秘密，禁止直接输出到日志、CLI或HTTP。尚未授权停机或写入。 */
export function prepareServiceMigration(legacy: ServiceSpec, input: ManagerServiceSpec) {
    const target = parseManagerServiceSpec(input);
    if (legacy.scope !== target.scope) throw new Error("迁移不能同时改变系统托管范围");
    const workspace = fs.realpathSync(target.workspace);
    const sourcePath = fs.realpathSync(legacy.configPath);
    if (
        workspace !== path.resolve(target.workspace) ||
        sourcePath !== path.resolve(legacy.configPath) ||
        path.dirname(sourcePath) !== workspace
    )
        throw new Error("迁移要求真实同目录工作区，不支持符号链接或数据目录搬迁");
    if (entryExists(path.join(workspace, ".control")))
        throw new Error("目标已有管理工作区，不能覆盖其认证或启停意图");
    const targetPath = path.join(workspace, "config.yaml");
    if (targetPath !== sourcePath && entryExists(targetPath))
        throw new Error("目标配置已经存在，不能覆盖");
    const source = new ConfigurationFile(sourcePath);
    const inspection = source.inspect();
    const original = source.readRaw();
    if (original.revision !== inspection.revision) throw new Error("旧配置已变化，请重新准备迁移");
    const configuration =
        inspection.state === "ready"
            ? createServiceMigrationConfig({ document: inspection.document, legacy, workspace })
            : null;
    return {
        target,
        sourceConfigPath: sourcePath,
        targetConfigPath: targetPath,
        sourceRevision: original.revision,
        originalBytes: original.bytes,
        sourceState: inspection.state,
        // 损坏来源仍保留原始字节，绝不能推断为空；只允许管理服务启动后显式修复。
        configuration,
    };
}

function entryExists(file: string): boolean {
    try {
        fs.lstatSync(file);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
    }
}
