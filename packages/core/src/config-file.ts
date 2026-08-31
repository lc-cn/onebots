import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

export interface ConfigFileWriteOptions {
    /** 在替换目标前，将上一版本原子写入 `<path>.bak`。 */
    backup?: boolean;
    /** 新文件权限；已有文件默认保留原权限。 */
    mode?: number;
}

export interface ConfigFileWriteResult {
    path: string;
    backupPath?: string;
}

/**
 * 在目标目录内写入临时文件后原子替换配置，避免进程退出留下截断文件。
 * 已有目标为符号链接时写入其真实路径，保留部署侧的链接结构。
 */
export function writeConfigFileAtomic(
    filePath: string,
    content: string,
    options: ConfigFileWriteOptions = {},
): ConfigFileWriteResult {
    const targetPath = fs.existsSync(filePath) ? fs.realpathSync(filePath) : path.resolve(filePath);
    const directory = path.dirname(targetPath);
    fs.mkdirSync(directory, { recursive: true });

    const existingMode = fs.existsSync(targetPath)
        ? fs.statSync(targetPath).mode & 0o777
        : undefined;
    const mode = options.mode ?? existingMode ?? 0o600;
    const temporaryPath = path.join(
        directory,
        `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`,
    );

    try {
        writeSyncedFile(temporaryPath, content, mode);
        let backupPath: string | undefined;
        if (options.backup && fs.existsSync(targetPath)) {
            backupPath = writeConfigFileAtomic(
                `${targetPath}.bak`,
                fs.readFileSync(targetPath, "utf8"),
                { mode },
            ).path;
        }
        fs.renameSync(temporaryPath, targetPath);
        return { path: targetPath, backupPath };
    } catch (error) {
        if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
        throw error;
    }
}

function writeSyncedFile(filePath: string, content: string, mode: number): void {
    const descriptor = fs.openSync(filePath, "wx", mode);
    try {
        fs.writeFileSync(descriptor, content, "utf8");
        fs.fchmodSync(descriptor, mode);
        fs.fsyncSync(descriptor);
    } finally {
        fs.closeSync(descriptor);
    }
}
