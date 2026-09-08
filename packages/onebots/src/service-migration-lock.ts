import fs from "node:fs";
import path from "node:path";
import { acquireExclusiveFileLock } from "./exclusive-file-lock.js";

/** 服务迁移操作独占锁，独立于任何目标工作区的运行锁。 */
export function acquireServiceMigrationLock(stateDirectory: string): () => void {
    const directory = path.resolve(stateDirectory);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(directory);
    if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (stat.mode & 0o077) !== 0 ||
        (process.getuid && stat.uid !== process.getuid())
    )
        throw new Error("服务迁移状态目录必须是当前用户的私有目录");
    return acquireExclusiveFileLock(path.join(directory, "service-migration-lock.sqlite"), {
        busyMessage: "已有服务迁移操作正在进行，禁止重复执行",
        invalidMessage: "服务迁移锁必须是当前用户的私有独立常规文件",
        unavailableMessage: "服务迁移锁数据库无法使用，请检查本地卷与文件状态",
    });
}
