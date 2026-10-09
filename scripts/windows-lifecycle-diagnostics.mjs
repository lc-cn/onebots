import fs from "node:fs";
import path from "node:path";

const stages = new Set(["process", "inspect", "acl-build", "acl-apply", "verify"]);
const states = new Set(["starting", "running", "stopping", "stopped", "failed"]);

/** 只读取隔离验收工作区的管理状态，不发布异常正文、路径或任何凭据。 */
export function windowsGatewayEvidence(workspace) {
    try {
        const file = path.join(workspace, ".control", "gateway.json");
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024)
            return { readable: false };
        const value = JSON.parse(fs.readFileSync(file, "utf8"));
        const match =
            typeof value.error === "string"
                ? /^网关快照目录权限无法确认（阶段：([^）]+)）$/u.exec(value.error)
                : null;
        return {
            readable: true,
            actual: states.has(value.actual) ? value.actual : "unclassified",
            recoveryRequired:
                typeof value.recoveryRequired === "boolean" ? value.recoveryRequired : null,
            snapshotStage: match && stages.has(match[1]) ? match[1] : "unclassified",
        };
    } catch {
        // 诊断不可读不应改写管理状态或退化到输出未知文件正文。
        return { readable: false };
    }
}

/** 非零退出仍失败；只发布固定命令名、退出码和白名单事实。 */
export function assertWindowsCliSuccess(result, command, workspace) {
    if (result.status === 0) return;
    const known = new Set([
        "install",
        "start",
        "status",
        "stop",
        "restart",
        "auth",
        "control",
        "recover",
        "update",
        "uninstall",
    ]);
    throw new Error(
        JSON.stringify({
            code: "WINDOWS_LIFECYCLE_CLI_FAILED",
            command: known.has(command) ? command : "unclassified",
            exitCode: Number.isInteger(result.status) ? result.status : null,
            gateway: windowsGatewayEvidence(workspace),
        }),
    );
}
