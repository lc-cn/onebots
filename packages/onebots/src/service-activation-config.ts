import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { inspectPersistedCredentialPermissions } from "./persisted-credential-permissions.js";

export interface ServiceActivationConfigSnapshot {
    realPath: string;
    device: number;
    inode: number;
    fingerprint: string;
}

/** 保存实际参与服务预检的配置文件身份与内容，但不公开配置或摘要。 */
export function captureServiceActivationConfig(
    configPath: string,
): ServiceActivationConfigSnapshot {
    let descriptor: number | undefined;
    try {
        descriptor = fs.openSync(configPath, "r");
        const stats = fs.fstatSync(descriptor);
        if (!stats.isFile()) throw new Error("配置路径不是文件");
        const source = fs.readFileSync(descriptor);
        return {
            realPath: fs.realpathSync(configPath),
            device: stats.dev,
            inode: stats.ino,
            fingerprint: createHash("sha256").update(source).digest("hex"),
        };
    } catch (error) {
        const code =
            error instanceof Error && "code" in error && typeof error.code === "string"
                ? error.code
                : "INVALID";
        throw new Error(`服务配置快照无法读取: ${configPath} (${code})`);
    } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor);
    }
}

/** 在进程管理器调用前证明配置仍是预检读取的同一文件、同一内容与安全权限。 */
export function assertServiceActivationConfigCurrent(
    configPath: string,
    expected: ServiceActivationConfigSnapshot,
    retryAction = "启动或重启",
): void {
    const current = captureServiceActivationConfig(configPath);
    if (
        current.realPath !== expected.realPath ||
        current.device !== expected.device ||
        current.inode !== expected.inode ||
        current.fingerprint !== expected.fingerprint
    ) {
        throw new Error(`服务配置在运行时预检后发生变化，请重新执行${retryAction}命令`);
    }
    let permissionErrors;
    try {
        permissionErrors = inspectPersistedCredentialPermissions(configPath).filter(
            check => check.level === "error",
        );
    } catch {
        throw new Error(`服务配置权限无法再次验证: ${configPath}`);
    }
    if (permissionErrors.length > 0) {
        throw new Error(
            `服务配置权限在运行时预检后变得不安全：${permissionErrors.map(check => check.message).join("；")}`,
        );
    }
}
