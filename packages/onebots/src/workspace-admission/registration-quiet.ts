import fs from "node:fs";
import path from "node:path";
import { managerUpgradeStatus } from "../service-upgrade-workspace.js";
import { verifyWorkspaceRegistrationProcessesWhileLocked } from "../service-migration-processes.js";
import { exists, physicalIdentity, readPrivate } from "./files.js";
import { readGenerationInstallOperation } from "../installation/generation-installer.js";
import { readVerifiedGeneration } from "../installation/generation-store.js";
import { parseGenerationActivationState } from "../control/generation-activation.js";
import { readConfigurationApplicationJournal } from "../configuration/configuration-application-reader.js";
import { readConfigurationRecoveryBackup } from "../configuration/configuration-recovery-store.js";
import { ConfigurationFile } from "../configuration/configuration-file.js";

/** 不构造会修复/中断历史操作的服务；未知记录不能视为已完成。 */
export async function assertRegistrationQuiet(workspace: string): Promise<void> {
    if (process.platform === "win32")
        throw new Error("旧 Windows 安装缺离线退出证明，首期不支持直接登记");
    const control = path.join(workspace, ".control");
    if (!(await verifyWorkspaceRegistrationProcessesWhileLocked(workspace)))
        throw new Error("旧管理服务/网关/worker 正常关闭证据不足");
    for (const name of ["migration-pending.json", "migration-blocked.json"]) {
        if (exists(path.join(control, name))) throw new Error("存在未决迁移，不能登记");
    }
    const upgrade = managerUpgradeStatus(workspace);
    if (upgrade.pending || upgrade.recoveryRequired)
        throw new Error("存在未决管理程序升级，不能登记");
    const activation = readPrivate(path.join(control, "active-generation.json"));
    if (activation) {
        const state = parseGenerationActivationState(JSON.parse(activation.bytes.toString("utf8")));
        if (
            state.schemaVersion !== 1 ||
            state.recoveryRequired !== false ||
            !Array.isArray(state.operations) ||
            state.operations.some(operation => operation.status === "running")
        )
            throw new Error("版本操作尚未静止");
    }
    for (const directory of ["installations", "configuration-applications"]) {
        const root = path.join(control, directory);
        if (!exists(root)) continue;
        physicalIdentity(root);
        for (const name of fs.readdirSync(root)) {
            if (directory === "configuration-applications" && name === "documents") continue;
            if (!/^[A-Za-z0-9_-]+\.json$/.test(name)) throw new Error("操作目录存在未知状态");
            // 由各owner真实reader解析结构、关联收据与文档，不复制通用status猜测。
            readPrivate(path.join(root, name));
            const id = name.slice(0, -5);
            if (directory === "installations") {
                const operation = readGenerationInstallOperation(root, id, key =>
                    readVerifiedGeneration(path.join(control, "generations"), key),
                );
                if (!["verified", "failed"].includes(operation.phase) || !operation.finishedAt)
                    throw new Error("存在未决安装操作");
            } else {
                const operation = readConfigurationApplicationJournal(root, id, {
                    source: new ConfigurationFile(path.join(workspace, "config.yaml")),
                    recovery: {
                        read: reference =>
                            readConfigurationRecoveryBackup(
                                path.join(control, "configuration/recovery"),
                                reference,
                            ),
                    },
                });
                if (
                    !["succeeded", "failed"].includes(operation.status) ||
                    operation.recoveryRequired
                )
                    throw new Error("存在未决配置操作");
            }
        }
    }
}
