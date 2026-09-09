import path from "node:path";
import type { ServiceHost } from "./service-host.js";
import type { LegacyWindowsScmInspection } from "./service-migration-windows-scm-snapshot.js";

export type WindowsLegacyRebootOperation =
    | "prepare"
    | "inspect"
    | "restart"
    | "rollback"
    | "commit"
    | "cleanup";

export interface WindowsLegacyRebootBinding {
    operationId: string;
    stateDirectory: string;
    snapshotDigest: string;
    nonce: string;
    expected: LegacyWindowsScmInspection;
}

export interface WindowsLegacyRebootResult {
    schemaVersion: 1;
    operationId: string;
    phase:
        | "awaiting-restart"
        | "restoration-ready"
        | "restart-requested"
        | "rolled-back"
        | "legacy-removed"
        | "cleaned";
    restorationReady: boolean;
}

const phases = new Set<WindowsLegacyRebootResult["phase"]>([
    "awaiting-restart",
    "restoration-ready",
    "restart-requested",
    "rolled-back",
    "legacy-removed",
    "cleaned",
]);

export function windowsMigrationHostExecutable(binPath: string): string {
    if (process.arch !== "x64" && process.arch !== "arm64")
        throw new Error("当前 Windows 架构尚无管理服务宿主");
    return path.win32.join(
        path.win32.dirname(binPath),
        "native",
        `win32-${process.arch}`,
        "onebots-windows-host.exe",
    );
}

export function inspectLegacyWindowsScm(host: ServiceHost, executable: string): unknown {
    return singleJson(host.exec(executable, ["legacy-scm-inspect"], { timeoutMs: 10_000 }));
}

export function requestWindowsLegacyReboot(
    host: ServiceHost,
    executable: string,
    binding: WindowsLegacyRebootBinding,
    operation: WindowsLegacyRebootOperation,
): WindowsLegacyRebootResult {
    if (host.platform !== "win32" || host.isElevated !== true)
        throw new Error("Windows 旧服务迁移需要管理员权限");
    const request = Buffer.from(
        JSON.stringify({ schemaVersion: 1, operation, ...binding }),
    ).toString("base64url");
    const value = singleJson(
        host.exec(executable, ["legacy-reboot-control", "--request", request], {
            timeoutMs: operation === "restart" ? 30_000 : 125_000,
        }),
    );
    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Reflect.ownKeys(value).length !== 4
    )
        throw new Error("Windows 重启迁移收据无效");
    const result = value as Record<string, unknown>;
    if (
        result.schemaVersion !== 1 ||
        result.operationId !== binding.operationId ||
        typeof result.phase !== "string" ||
        !phases.has(result.phase as WindowsLegacyRebootResult["phase"]) ||
        typeof result.restorationReady !== "boolean" ||
        (result.restorationReady !==
            ["restoration-ready", "cleaned"].includes(String(result.phase)))
    )
        throw new Error("Windows 重启迁移收据无效");
    return result as unknown as WindowsLegacyRebootResult;
}

function singleJson(output: string): unknown {
    if (typeof output !== "string" || Buffer.byteLength(output) > 256 * 1024)
        throw new Error("Windows 原生迁移响应无效");
    const lines = output.split(/\r?\n/u).filter(Boolean);
    if (lines.length !== 1) throw new Error("Windows 原生迁移响应无效");
    try {
        return JSON.parse(lines[0]);
    } catch {
        throw new Error("Windows 原生迁移响应无效");
    }
}
