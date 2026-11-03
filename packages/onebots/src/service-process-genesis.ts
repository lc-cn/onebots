import os from "node:os";

/** 仅正规登记计划的全新目录使用；不是缺失收据的恢复入口。 */
export function planWorkspaceProcessGenesis(
    desired: "running" | "stopped",
): Record<string, string> {
    const gateway = JSON.stringify({
        schemaVersion: 1,
        desired,
        actual: "stopped",
        recoveryRequired: false,
        operations: [],
    });
    if (process.platform === "win32") return { "gateway.json": gateway };
    return {
        "gateway.json": gateway,
        "process-ownership.json": JSON.stringify({
            schemaVersion: 1,
            hostname: os.hostname(),
            phase: "never-started",
            managerId: null,
            pid: null,
        }),
    };
}
