import path from "node:path";
import { fileURLToPath } from "node:url";
import { ServiceController } from "../service-manager.js";
import { createDefaultServiceHost } from "../service-host.js";
import { migrateInstalledService } from "../service-migration.js";
import { parseManagerServiceSpec } from "../manager-service-spec.js";
import type { CommandResult } from "./command-application.js";

export interface ServiceMigrationCommandOptions {
    system: boolean;
    host?: string;
    port?: number;
}

/** 只把旧服务位置与当前CLI工件交给统一迁移事务，不在命令层实现停机或恢复。 */
export async function migrateServiceCommand(
    options: ServiceMigrationCommandOptions,
): Promise<CommandResult> {
    const host = createDefaultServiceHost();
    const scope = options.system ? "system" : "user";
    let target;
    try {
        const spec = new ServiceController(scope, host).readSpec();
        if (!spec) return { output: "未找到已安装的旧服务，未执行迁移。", exitCode: 1 };
        target = parseManagerServiceSpec({
            schemaVersion: 1,
            runtimeKind: "control",
            scope,
            workspace: path.dirname(spec.configPath),
            workingDirectory: spec.workingDirectory,
            nodePath: process.execPath,
            binPath: fileURLToPath(new URL("../bin.js", import.meta.url)),
            host: options.host ?? "127.0.0.1",
            port: options.port ?? 6727,
        });
    } catch {
        return { output: "旧服务元数据或迁移选项无效，未执行迁移。", exitCode: 1 };
    }
    try {
        const operation = await migrateInstalledService(target, host);
        const identity = `操作 ${operation.id}：${operation.status}（${operation.phase}）`;
        if (operation.status === "succeeded" && !operation.recoveryRequired) {
            return {
                output: `${identity}\n迁移完成，保留原服务启停状态。首次配对请在管理服务运行时执行：\nonebots auth bootstrap --data-dir ${quote(target.workspace)}`,
                exitCode: 0,
            };
        }
        return {
            output: `${identity}\n${
                operation.recoveryRequired || operation.status === "interrupted"
                    ? "迁移结果尚未确认，已保留恢复记录；请在本机对账，勿重复迁移。"
                    : operation.rolledBack
                      ? "迁移失败，已确认恢复旧服务。"
                      : "迁移失败，未确认恢复旧服务；请检查迁移记录。"
            }${
                operation.recoveryRequired &&
                ["prepared", "capturing-runtime"].includes(operation.phase)
                    ? `\n可核验并取消尚未切换的迁移：onebots recover --operation ${operation.id} --cancel-migration${options.system ? " --system" : ""}。此操作保留备份，不会自动重试迁移。`
                    : ""
            }`,
            exitCode: 1,
        };
    } catch {
        // 底层可能包含OS输出及路径，固定诊断不泄漏配置；不猜测是否已派发。
        return {
            output: "迁移未完成，操作标识暂不可用；请检查本机迁移记录，勿重复执行。",
            exitCode: 1,
        };
    }
}
function quote(value: string): string {
    return `'${value.replaceAll("'", "'\\''")}'`;
}
