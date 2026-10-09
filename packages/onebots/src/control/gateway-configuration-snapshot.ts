import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import yaml from "js-yaml";
import {
    assertGatewaySnapshotFileSecurity,
    secureGatewaySnapshotDirectory,
} from "./gateway-snapshot-security.js";

/** 管理服务唯一写入：热应用与冷启动消费相同的去管理凭据、摘要绑定快照。 */
export function createGatewayConfigurationSnapshot(
    workspace: string,
    document: Record<string, unknown>,
): { configPath: string; configVersion: string } {
    const runtime = { ...document };
    delete runtime.username;
    delete runtime.password;
    delete runtime.access_token;
    const content = yaml.dump(runtime);
    if (Buffer.byteLength(content) > 8 * 1024 * 1024) throw new Error("网关快照超过大小限制");
    const configVersion = createHash("sha256").update(content).digest("hex");
    const directory = path.join(fs.realpathSync(workspace), ".control", "configurations");
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (fs.realpathSync(directory) !== directory) throw new Error("网关快照目录无效");
    if (process.platform === "win32") secureGatewaySnapshotDirectory(directory);
    else if ((fs.statSync(directory).mode & 0o077) !== 0) throw new Error("网关快照目录权限无效");
    const configPath = path.join(directory, `${configVersion}.yaml`);
    if (!fs.existsSync(configPath)) {
        // 崩溃可能绕过 finally；私有单写者目录中的未发布 staging 不属于任何运行版本。
        for (const entry of fs.readdirSync(directory)) {
            if (!entry.startsWith(".snapshot-")) continue;
            const staging = path.join(directory, entry);
            const stat = fs.lstatSync(staging);
            if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("网关快照存储无效");
            fs.unlinkSync(staging);
        }
        // 不淘汰可能仍被子进程或恢复事务引用的快照；显式容量边界代替无界留存。
        const entries = fs.readdirSync(directory);
        let bytes = Buffer.byteLength(content);
        for (const entry of entries) {
            const stat = fs.lstatSync(path.join(directory, entry));
            if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("网关快照存储无效");
            bytes += stat.size;
        }
        if (entries.length >= 512 || bytes > 64 * 1024 * 1024)
            throw new Error("网关快照存储已达容量限制，请先完成对账再停服清理历史快照");
        const temporary = path.join(directory, `.snapshot-${randomUUID()}`);
        const descriptor = fs.openSync(temporary, "wx", 0o600);
        try {
            try {
                fs.writeFileSync(descriptor, content);
                fs.fsyncSync(descriptor);
            } finally {
                fs.closeSync(descriptor);
            }
            // 工作区唯一管理写者发布完整文件；rename 不会遗留崩溃时的双硬链接。
            fs.renameSync(temporary, configPath);
            if (process.platform !== "win32") {
                const directoryDescriptor = fs.openSync(directory, "r");
                try {
                    fs.fsyncSync(directoryDescriptor);
                } finally {
                    fs.closeSync(directoryDescriptor);
                }
            }
        } catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
                throw error;
        } finally {
            if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        }
    }
    const stat = fs.lstatSync(configPath);
    assertGatewaySnapshotFileSecurity(configPath);
    if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        (process.platform !== "win32" && (stat.mode & 0o077) !== 0) ||
        createHash("sha256").update(fs.readFileSync(configPath)).digest("hex") !== configVersion
    )
        throw new Error("网关快照校验失败");
    return { configPath, configVersion };
}
