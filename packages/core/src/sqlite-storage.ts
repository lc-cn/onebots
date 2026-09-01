import * as fs from "node:fs";
import * as path from "node:path";

/** 在 SQLite 打开前建立仅当前用户可访问的存储边界。 */
export function prepareSqliteStorage(filePath: string): void {
    const directory = path.dirname(filePath);
    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    }
    if (process.platform === "win32") return;

    // Node SQLite 按进程 umask 创建文件，常见默认值会产生公开可读的 0644。
    fs.closeSync(fs.openSync(filePath, "a", 0o600));
    fs.chmodSync(filePath, 0o600);
}
