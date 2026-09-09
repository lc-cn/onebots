import fs from "node:fs";
import { parseManagerServiceSpec } from "./manager-service-spec.js";
import path from "node:path";
import { ServiceOperationStorage, closedServiceObject } from "./service-operation-storage.js";

/** 服务锁内定位安装周期；初始绑定保留原路径，后续操作独立存储，不搬迁或覆盖历史。 */
export function managerBootstrapBindingDirectory(home: string, id: string): string {
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id))
        throw new Error("安装周期标识无效");
    const initial = path.join(home, "bootstrap");
    try {
        const stat = fs.lstatSync(initial);
        if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o7777) !== 0o700 ||
            (process.getuid && stat.uid !== process.getuid())) throw new Error("初始安装绑定目录无效");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            if (fs.existsSync(path.join(home, "operations")) || fs.existsSync(path.join(home, "bootstrap-cycles")))
                throw new Error("已有安装历史但初始绑定缺失，禁止创建替代记录");
            return initial;
        }
        throw error;
    }
    const storage = new ServiceOperationStorage(initial);
    const intent = closedServiceObject(storage.read("intent.json"), ["schemaVersion", "id", "service", "planDigest"]);
    if (intent.schemaVersion !== 1 || typeof intent.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(intent.id))
        throw new Error("初始安装绑定记录无效");
    parseManagerServiceSpec(intent.service);
    if (typeof intent.planDigest !== "string" || !/^[a-f0-9]{64}$/.test(intent.planDigest))
        throw new Error("初始安装计划绑定无效");
    if (intent.id === id) return initial;
    const cycles = path.join(home, "bootstrap-cycles");
    try {
        const stat = fs.lstatSync(cycles);
        if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(cycles) !== cycles ||
            (stat.mode & 0o7777) !== 0o700 || (process.getuid && stat.uid !== process.getuid()))
            throw new Error("安装周期目录无效");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return path.join(cycles, id);
}
